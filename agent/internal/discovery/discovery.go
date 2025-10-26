package discovery

import (
	"context"
	"fmt"
	"log"
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
				log.Printf("Browsing for peers...")
				
				// Create new channel for each browse session
				entries := make(chan *zeroconf.ServiceEntry, 100)
				
				ctx, cancel := context.WithTimeout(s.ctx, 5*time.Second)
				
				// Start listening for entries in this goroutine
				go func() {
					for entry := range entries {
						// Skip ourselves
						if entry.Instance == s.deviceName {
							log.Printf("Skipping self: %s", entry.Instance)
							continue
						}
						
						// Add discovered peer to registry
						if len(entry.AddrIPv4) > 0 {
							peer := &peers.Peer{
								ID:       entry.Instance,
								Name:     entry.Instance,
								Address:  entry.AddrIPv4[0].String(),
								Port:     entry.Port,
								Status:   "idle",
								LastSeen: time.Now(),
							}
							
							s.registry.Add(peer)
							log.Printf("Discovered peer: %s at %s:%d", peer.Name, peer.Address, peer.Port)
						}
					}
					log.Println("Entry channel closed")
				}()
				
				err := resolver.Browse(ctx, serviceType, domain, entries)
				cancel()
				
				if err != nil && err != context.DeadlineExceeded {
					log.Printf("Browse error: %v", err)
				}
				
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

