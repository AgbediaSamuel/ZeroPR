package main

import (
	"encoding/json"
	"fmt"
	_ "io"
	_ "log"
	"net"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// later on, write a function that decodes requests
// instead of repeating json.NewDecoder everytime
// ID parameter in UserRequest might be useless (can't remember why I added it anymore lol)

var (
	started bool
)

type UserRequest struct {
	Host string `json:"host"`
	FilePath string `json:"filepath"`
	ID string `json:"id"`
	Role string `json:"role"`
}

type SessionInvite struct {
	ID        string `json:"id"`
	Host      string `json:"host"`
	Guest     string `json:"guest"`
	FilePath  string `json:"filepath"`
	CreatedAt string `json:"created_at"`
}

var sessionregister = NewSessionRegister()

func relayHostFromRemoteAddr(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err == nil {
		return host
	}
	return remoteAddr
}

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
	response, _ := json.Marshal(started)
	w.Header().Set("content-Type", "application/json")
	w.Write(response)
}

func stopBroadcast(w http.ResponseWriter, req *http.Request) {
	if cancel != nil {
		cancel()
	}
	register = NewRegister()
	started = false
	response, _ := json.Marshal(started)
	w.Write(response)
}

func startSession(w http.ResponseWriter, req *http.Request) {
	var ur UserRequest
	err := json.NewDecoder(req.Body).Decode(&ur)
	errorhandler(err)
	session := Session{
		ID:        uuid.NewString(),
		Host:      ur.Host,
		FilePath:  ur.FilePath,
		CreatedAt: time.Now().Format(time.Kitchen),
		Active:    true,
	}
	sessionregister.Add(&session)
	resp, err := json.Marshal(session)
	errorhandler(err)
	w.Header().Set("Content-Type", "application/json")
	w.Write(resp)
	
}

func joinSession(w http.ResponseWriter, req *http.Request) {
	var si SessionInvite
	err := json.NewDecoder(req.Body).Decode(&si)
	errorhandler(err)
	sessionregister.Add(&Session{
		ID:        si.ID,
		Host:      si.Host,
		RelayHost: relayHostFromRemoteAddr(req.RemoteAddr),
		Guest:     si.Guest,
		FilePath:  si.FilePath,
		CreatedAt: si.CreatedAt,
		Active:    true,
	})
	resp, _ := json.Marshal("Joined Session")
	w.Write(resp)
}

func leaveSession(w http.ResponseWriter, req *http.Request) {
	var ur UserRequest
	err := json.NewDecoder(req.Body).Decode(&ur)
	errorhandler(err)
	current := sessionregister.Get(ur.ID)
	if ur.Role == "Guest" {
		current.Guest = ""
		if current.Receiver != nil {
			current.Receiver.Close()
			current.Receiver = nil
		}
		sessionregister.Update(&current)
		w.Header().Set("Content-Type", "application/json")
		resp, _ := json.Marshal("Left session")
		w.Write(resp)
	} else {
		// host leaving = end session
		if current.Sender != nil {
			current.Sender.Close()
		}
		if current.Receiver != nil {
			current.Receiver.Close()
		}
		sessionregister.Remove(ur.ID)
		w.Header().Set("Content-Type", "application/json")
		resp, _ := json.Marshal("Session ended")
		w.Write(resp)
	}
}

func endSession(w http.ResponseWriter, req *http.Request) {
	var ur UserRequest
	err := json.NewDecoder(req.Body).Decode(&ur)
	errorhandler(err)
	current := sessionregister.Get(ur.ID)
	if current.Sender != nil {
		current.Sender.Close()
	}
	if current.Receiver != nil {
		current.Receiver.Close()
	}
	sessionregister.Remove(ur.ID)
	w.Header().Set("Content-Type", "application/json")
	resp, _ := json.Marshal("Session ended")
	w.Write(resp)
}

func getAllSessions(w http.ResponseWriter, req *http.Request) {
	sessions := sessionregister.GetAll()
	resp, err := json.Marshal(sessions)
	errorhandler(err)
	w.Header().Set("Content-Type", "application/json")
	w.Write(resp)
}


// func status(w http.ResponseWriter, req *http.Request) {
// 	if started {
// 		w.Write([]byte{1})
// 	}
// }

func main() {
	test()
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
	http.HandleFunc("/api/sessions", getAllSessions)
	// http.HandleFunc("api/broadcast/status")

	err := http.ListenAndServe(":9080", nil)
	errorhandler(err)

}
