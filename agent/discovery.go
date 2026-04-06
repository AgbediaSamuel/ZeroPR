package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/brutella/dnssd"
)

var (
	ctx    context.Context
	cancel context.CancelFunc
)

var register = NewRegister()

func errorhandler(err error) {
	if err != nil {
		fmt.Println(err)
		return
	}
}

func startDiscovery() {
	setup := dnssd.Config{
		Name: "ZeroPR",
		Type: "_zeropr._tcp",
		Port: 9080,
	}

	service, err := dnssd.NewService(setup)
	errorhandler(err)

	responder, err := dnssd.NewResponder()
	errorhandler(err)

	_, err = responder.Add(service)
	errorhandler(err)

	ctx, cancel = context.WithCancel(context.Background())
	go responder.Respond(ctx)
	host, _ := os.Hostname()
	addFn := func(entry dnssd.BrowseEntry) {
		if strings.HasPrefix(host, entry.Host) {
			return
		}
		var peerIP string
		for _, ip := range entry.IPs {
			if ip.To4() != nil {
				peerIP = ip.String()
				break
			}
		}
		register.Add(&Peer{
			Name: entry.Host,
			Host: peerIP,
			LastSeen: time.Now().Format(time.Kitchen),
		})
	}

	rmFn := func(entry dnssd.BrowseEntry) {
		for _, ip := range entry.IPs {
			if ip.To4() != nil {
				peerIP := ip.String()
				// don't remove peers that are in an active session
				for _, s := range sessionregister.GetAll() {
					if s.Host == peerIP || s.Guest == peerIP || s.RelayHost == peerIP {
						return
					}
				}
				register.Remove(peerIP)
				return
			}
		}
	}

	serviceName := setup.Type + "." + service.Domain + "."
	go dnssd.LookupType(ctx, serviceName, addFn, rmFn)

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(60 * time.Second):
				go dnssd.LookupType(ctx, serviceName, addFn, rmFn)
			}
		}
	}()
}
