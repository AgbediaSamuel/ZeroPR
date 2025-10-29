package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/zeropr/agent/internal/discovery"
	"github.com/zeropr/agent/internal/peers"
	"github.com/zeropr/agent/internal/server"
)

const (
	version = "0.1.0"
)

var (
	httpPort   = flag.Int("http-port", 8080, "HTTP API port")
	wsPort     = flag.Int("ws-port", 9000, "WebSocket port")
	deviceName = flag.String("name", "zeropr-agent", "Device name for mDNS")
)

func main() {
	flag.Parse()

	deviceLabel := resolveDeviceName(*deviceName)

	log.Printf("ZeroPR Agent v%s starting...\n", version)
	log.Printf("Device name: %s\n", deviceLabel)
	log.Printf("HTTP port: %d, WebSocket port: %d\n", *httpPort, *wsPort)

	// Initialize peer registry
	peerRegistry := peers.NewRegistry()

	// Initialize mDNS discovery
	discoveryService, err := discovery.NewService(deviceLabel, *httpPort, peerRegistry)
	if err != nil {
		log.Fatalf("Failed to initialize discovery service: %v", err)
	}

	// Initialize HTTP/WebSocket server
	srv := server.NewServer(*httpPort, *wsPort, peerRegistry, discoveryService)

	// Start server in background
	go func() {
		log.Printf("HTTP API listening on :%d\n", *httpPort)
		log.Printf("WebSocket listening on :%d\n", *wsPort)
		if err := srv.Start(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down...")

	// Stop discovery
	discoveryService.Stop()

	// Stop server with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	log.Println("Agent stopped")
}

func resolveDeviceName(name string) string {
	const defaultName = "zeropr-agent"

	base := strings.TrimSpace(name)
	if base == "" {
		base = defaultName
	}

	// If user provided a non-default custom name, honor it as-is.
	if name != "" && name != defaultName {
		return base
	}

	host, err := os.Hostname()
	if err != nil {
		return fmt.Sprintf("%s-%d", base, time.Now().UnixNano())
	}

	sanitized := sanitizeHostname(host)
	if sanitized == "" {
		return fmt.Sprintf("%s-%d", base, time.Now().UnixNano())
	}

	return fmt.Sprintf("%s-%s", base, sanitized)
}

func sanitizeHostname(host string) string {
	host = strings.ToLower(host)

	var builder strings.Builder
	lastDash := false

	for _, r := range host {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
			lastDash = false
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
			lastDash = false
		case r == '-' || r == '_' || r == ' ':
			if !lastDash {
				builder.WriteRune('-')
				lastDash = true
			}
		default:
			// Skip other characters
		}
	}

	result := strings.Trim(builder.String(), "-")
	return result
}
