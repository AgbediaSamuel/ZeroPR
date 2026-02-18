package main

import (
	"encoding/json"
	"fmt"
	_ "io"
	_ "log"
	"net/http"
)

var (
	started bool
)

func server(w http.ResponseWriter, req *http.Request) {
	fmt.Fprintf(w, "Server running")
}

func readPeers(w http.ResponseWriter, req *http.Request) {
	peersJSON, err := json.Marshal(register.GetAll())
	errorhandler(err)
	w.Header().Set("Content-Type", "application/json")
	w.Write(peersJSON)
}

func startBroadcast(w http.ResponseWriter, req *http.Request) {
	if !started {
		startDiscovery()
	}
	started = true
}

func stopBroadcast(w http.ResponseWriter, req *http.Request) {
	cancel()
	register = NewRegister()
	started = false
}

// func status(w http.ResponseWriter, req *http.Request) {
// 	if started {
// 		w.Write([]byte{1})
// 	}
// }

func main() {
	fmt.Println("This is the entry point for the Go Agent")
	http.HandleFunc("/api", server)
	http.HandleFunc("/api/peers", readPeers)
	http.HandleFunc("/api/broadcast/start", startBroadcast)
	http.HandleFunc("/api/broadcast/stop", stopBroadcast)
	// http.HandleFunc("api/broadcast/status")

	http.ListenAndServe(":8080", nil)

}
