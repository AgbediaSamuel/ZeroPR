package main

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(req *http.Request) bool {
		return true
	},
}


func wsServer(w http.ResponseWriter, req *http.Request) {
	var ur UserRequest
	conn, err := upgrader.Upgrade(w, req, nil)
	errorhandler(err)
	_, msg, merr := conn.ReadMessage()
	errorhandler(merr)
	rerr := json.Unmarshal(msg, &ur)
	errorhandler(rerr)
	current := sessionregister.Get(ur.ID)
	// add a check here to make sure 
	// Host and Guest fields match hostnames for clients
	// sending requests to create websocket connections
	if ur.Role == "Host" {
		current.Sender = conn
	} else {
		current.Receiver = conn
		current.Guest = ur.Host
	}
	sessionregister.Update(&current)
	// register a write mutex for this connection
	connMu.Store(conn, &sync.Mutex{})

	// waiting for both to be satisfied before entering websocket relay loop
	for {
		current = sessionregister.Get(current.ID)
		if current.Sender != nil && current.Receiver != nil {
			break 
		}
		time.Sleep(time.Millisecond * 200)
	}

	for {
		msgtype, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		// re-read session each time to get fresh connection pointers after reconnects
		latest := sessionregister.Get(current.ID)
		var other *websocket.Conn
		if ur.Role == "Host" {
			other = latest.Receiver
		} else {
			other = latest.Sender
		}
		if other == nil {
			break
		}
		// protect against concurrent writes to the same websocket connection
		mu, ok := connMu.Load(other)
		if !ok {
			break
		}
		mu.(*sync.Mutex).Lock()
		writeErr := other.WriteMessage(msgtype, msg)
		mu.(*sync.Mutex).Unlock()
		if writeErr != nil {
			break
		}
	}

	// only clear our connection if it's still ours (not replaced by a reconnect)
	current = sessionregister.Get(current.ID)
	if ur.Role == "Host" && current.Sender == conn {
		current.Sender = nil
		sessionregister.Update(&current)
	} else if ur.Role == "Guest" && current.Receiver == conn {
		current.Receiver = nil
		sessionregister.Update(&current)
	}
	connMu.Delete(conn)
	conn.Close()
}