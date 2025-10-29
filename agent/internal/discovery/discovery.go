package discovery

import (
	"context"
	"fmt"
	"log"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/grandcat/zeroconf"
	"github.com/zeropr/agent/internal/peers"
)

const (
	serviceType = "_zeropr._tcp"
	domain      = "local."
)

// Service handles mDNS discovery
type Service struct {
	deviceName   string
	port         int
	registry     *peers.Registry
	server       *zeroconf.Server
	resolver     *zeroconf.Resolver
	ctx          context.Context
	cancel       context.CancelFunc
	broadcasting bool
	localIPv4    map[string]struct{}
	localIPv6    map[string]struct{}
	mu           sync.RWMutex
}

// NewService creates a new discovery service
func NewService(deviceName string, port int, registry *peers.Registry) (*Service, error) {
	ctx, cancel := context.WithCancel(context.Background())

	return &Service{
		deviceName: deviceName,
		port:       port,
		registry:   registry,
		ctx:        ctx,
		cancel:     cancel,
		localIPv4:  make(map[string]struct{}),
		localIPv6:  make(map[string]struct{}),
	}, nil
}

// StartBroadcast starts broadcasting this device
func (s *Service) StartBroadcast() error {
	if s.broadcasting {
		return fmt.Errorf("already broadcasting")
	}

	server, err := zeroconf.Register(
		s.deviceName,
		serviceType,
		domain,
		s.port,
		[]string{"version=0.1.0"},
		nil,
	)
	if err != nil {
		return fmt.Errorf("failed to register service: %w", err)
	}

	s.server = server
	s.broadcasting = true
	s.updateLocalAddrs()

	log.Printf("Broadcasting as '%s' on port %d", s.deviceName, s.port)

	// Start listening for other peers
	go s.startDiscovery()

	return nil
}

// StopBroadcast stops broadcasting
func (s *Service) StopBroadcast() {
	if s.server != nil {
		s.server.Shutdown()
		s.broadcasting = false
		log.Println("Broadcast stopped")
	}
}

// startDiscovery listens for other peers
func (s *Service) startDiscovery() {
	resolver, err := zeroconf.NewResolver(nil)
	if err != nil {
		log.Printf("Failed to create resolver: %v", err)
		return
	}
	s.resolver = resolver

	log.Println("Starting peer discovery loop...")

	// Browse for services continuously
	go func() {
		for {
			select {
			case <-s.ctx.Done():
				log.Println("Discovery loop stopped")
				return
			default:
				s.updateLocalAddrs()
				log.Printf("Browsing for peers...")

				// Create new channel for each browse session
				entries := make(chan *zeroconf.ServiceEntry, 100)

				ctx, cancel := context.WithTimeout(s.ctx, 5*time.Second)
				done := make(chan struct{})

				// Start listening for entries in this goroutine
				go func() {
					defer close(done)
					for entry := range entries {
						if s.isSelf(entry) {
							log.Printf("Skipping self: %s", entry.Instance)
							continue
						}

						// Add discovered peer to registry
						if peer := s.buildPeer(entry); peer != nil {
							s.registry.Add(peer)
							log.Printf("Discovered peer: %s at %s:%d", peer.Name, peer.Address, peer.Port)
						}
					}
					log.Println("Entry channel closed")
				}()

				go func() {
					<-ctx.Done()
					for range entries {
					}
				}()

				err := resolver.Browse(ctx, serviceType, domain, entries)
				if err != nil && err != context.Canceled && err != context.DeadlineExceeded {
					log.Printf("Browse error: %v", err)
				}

				<-done
				cancel()

				log.Printf("Browse cycle complete, found %d peers", s.registry.Count())

				// Cleanup stale peers (5 minutes)
				s.registry.Cleanup(5 * time.Minute)

				time.Sleep(5 * time.Second)
			}
		}
	}()
}

// Stop stops the discovery service
func (s *Service) Stop() {
	s.StopBroadcast()
	s.cancel()
}

// IsBroadcasting returns whether we're currently broadcasting
func (s *Service) IsBroadcasting() bool {
	return s.broadcasting
}

// updateLocalAddrs refreshes the set of local IP addresses for self-identification.
func (s *Service) updateLocalAddrs() {
	ipv4 := make(map[string]struct{})
	ipv6 := make(map[string]struct{})

	ifaces, err := net.Interfaces()
	if err != nil {
		log.Printf("Failed to list network interfaces: %v", err)
		return
	}

	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			default:
				continue
			}

			if ip == nil || ip.IsLoopback() || ip.IsUnspecified() {
				continue
			}

			if ipv4Addr := ip.To4(); ipv4Addr != nil {
				ipv4[ipv4Addr.String()] = struct{}{}
				continue
			}

			if ipv6Addr := ip.To16(); ipv6Addr != nil {
				ipv6[ipv6Addr.String()] = struct{}{}
			}
		}
	}

	s.mu.Lock()
	s.localIPv4 = ipv4
	s.localIPv6 = ipv6
	s.mu.Unlock()
}

// isSelf returns true if the given service entry refers to this agent.
func (s *Service) isSelf(entry *zeroconf.ServiceEntry) bool {
	if entry == nil {
		return false
	}

	if entry.Port != s.port || entry.Instance != s.deviceName {
		return false
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, addr := range entry.AddrIPv4 {
		if _, ok := s.localIPv4[addr.String()]; ok {
			return true
		}
	}

	for _, addr := range entry.AddrIPv6 {
		if _, ok := s.localIPv6[addr.String()]; ok {
			return true
		}
	}

	return false
}

// buildPeer constructs a peers.Peer from a zeroconf entry.
func (s *Service) buildPeer(entry *zeroconf.ServiceEntry) *peers.Peer {
	if entry == nil {
		return nil
	}

	var address string
	switch {
	case len(entry.AddrIPv4) > 0:
		address = entry.AddrIPv4[0].String()
	case len(entry.AddrIPv6) > 0:
		address = entry.AddrIPv6[0].String()
	default:
		log.Printf("Discovered entry without address: %s", entry.Instance)
		return nil
	}

	id := fmt.Sprintf("%s@%s:%d", entry.Instance, address, entry.Port)

	status := "idle"
	txt := parseTXT(entry.Text)
	if v, ok := txt["status"]; ok && v != "" {
		status = v
	}

	peer := &peers.Peer{
		ID:         id,
		Name:       entry.Instance,
		Address:    address,
		Port:       entry.Port,
		RepoHash:   txt["repoHash"],
		Branch:     txt["branch"],
		ActiveFile: txt["activeFile"],
		Status:     status,
		LastSeen:   time.Now(),
		Trusted:    txt["trusted"] == "true",
	}

	return peer
}

// parseTXT converts zeroconf TXT records into a key/value map.
func parseTXT(records []string) map[string]string {
	values := make(map[string]string, len(records))
	for _, record := range records {
		if record == "" {
			continue
		}

		if eq := strings.IndexByte(record, '='); eq >= 0 {
			key := strings.TrimSpace(record[:eq])
			value := strings.TrimSpace(record[eq+1:])
			if key != "" {
				values[key] = value
			}
			continue
		}

		values[strings.TrimSpace(record)] = ""
	}
	return values
}
