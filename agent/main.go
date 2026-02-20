package main

import (
	"encoding/json"
	"fmt"
	_ "io"
	_ "log"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// later on, write a function that decodes requests
// instead of repeating json.NewDecoder everytime

var (
	started bool
)

type UserRequest struct {
	Host string `json:"host"`
	FilePath string `json:"filepath"`
	ID string `json:"id"`
	Role string `json:"role"`
}

var sessionregister = NewSessionRegister()

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

func startSession(w http.ResponseWriter, req *http.Request) {
	var ur UserRequest
	err := json.NewDecoder(req.Body).Decode(&ur)
	errorhandler(err)
	sessionID := uuid.NewString()
	idJson, err := json.Marshal(sessionID)
	sessionregister.Add(&Session{
		ID : sessionID,
		Host: ur.Host,
		FilePath: ur.FilePath,
		CreatedAt: time.Now().Format(time.Kitchen),
		Active: true,

	})
	errorhandler(err)
	// resp := fmt.Sprintf()
	w.Write(idJson)

	// add websocket stuff here
	// make an http request to wsServer
	
}

func joinSession(w http.ResponseWriter, req *http.Request) {
	var ur UserRequest
	err := json.NewDecoder(req.Body).Decode(&ur)
	errorhandler(err)
	current := sessionregister.Get(ur.ID)
	current.Guest = ur.Host
	sessionregister.Remove(current.ID)
	sessionregister.Add(&current)
	resp, err := json.Marshal("Joined Session")
	errorhandler(err)
	w.Write(resp)

	// add websocket stuff here
	// before writing a response back actually

}

func leaveSession(w http.ResponseWriter, req *http.Request) {
	var ur UserRequest
	err := json.NewDecoder(req.Body).Decode(&ur)
	errorhandler(err)
	current := sessionregister.Get(ur.ID)
	if ur.Role == "Host" {
		current.Host = ""
	} else {
		current.Guest = ""
	}
	sessionregister.Remove(current.ID)
	sessionregister.Add(&current)
	
}

func endSession(w http.ResponseWriter, req *http.Request) {
	var ur UserRequest
	err := json.NewDecoder(req.Body).Decode(&ur)
	errorhandler(err)
	sessionregister.Key.Lock()
	delete(sessionregister.sessions, ur.ID)
	resp, err := json.Marshal(time.Now().Format(time.Kitchen))
	errorhandler((err))
	sessionregister.Key.Unlock()
	w.Write(resp)
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
	http.HandleFunc("/ws/session/", wsServer)
	http.HandleFunc("/api/session/create", startSession)
	http.HandleFunc("/api/session/join", joinSession)
	http.HandleFunc("/api/session/leave", leaveSession)
	http.HandleFunc("/api/session/end", endSession)
	// http.HandleFunc("api/broadcast/status")

	err := http.ListenAndServe(":9080", nil)
	errorhandler(err)

}
