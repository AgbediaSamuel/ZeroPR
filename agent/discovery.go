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
	ctx context.Context
	cancel context.CancelFunc

)

// shared register instance for all operations to access
var register = NewRegister()

func errorhandler(err error) {
	if err != nil {
		fmt.Println(err)
		return
	}
}

func startDiscovery() {

	setup := dnssd.Config{
		Name:   "ZeroPR",
		Type:   "_zeropr._tcp",
		Port:   9080,
	}

	service, err := dnssd.NewService(setup)
	errorhandler(err)

	responder, err := dnssd.NewResponder()
	errorhandler(err)

	_, err = responder.Add(service)
	errorhandler(err)

	ctx, cancel = context.WithCancel(context.Background())
	//  go routine for broadcasting in background
	go responder.Respond(ctx)
	host, _ := os.Hostname()
	addFn := func(entry dnssd.BrowseEntry) {
		if strings.HasPrefix(host, entry.Host) {
			return
		}
		register.Add(&Peer{
			Name: entry.Name,
			Host: entry.Host,
			LastSeen: time.Now().Format(time.Kitchen),
		})
	}

	rmFn := func(entry dnssd.BrowseEntry) {
		register.Remove(entry.Host)
	}

	serviceName := setup.Type+"."+service.Domain+"."

	go dnssd.LookupType(ctx, serviceName, addFn, rmFn)


}
