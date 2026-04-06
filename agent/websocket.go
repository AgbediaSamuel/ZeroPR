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
	if ur.Role == "Host" {
		current.Sender = conn
	} else {
		current.Receiver = conn
		current.Guest = ur.Host
	}
	sessionregister.Update(&current)
	connMu.Store(conn, &sync.Mutex{})

	// wait for both host and guest before starting relay
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