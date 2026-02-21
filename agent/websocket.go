package main

import (
	"encoding/json"
	"net/http"
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
	if current.Sender == nil || current.Receiver == nil {
		if ur.Role == "Host" {
			current.Sender = conn
		} else {
			current.Receiver = conn
		}
		// replace these with update method on registry struct later
		sessionregister.Remove(current.ID)
		sessionregister.Add(&current)
	}

	// waiting for both to be satisfied before entering websocket relay loop
	for {
		current = sessionregister.Get(current.ID)
		if current.Sender != nil && current.Receiver != nil {
			break
		}
		time.Sleep(time.Millisecond * 200)
	}

	for {
		msgtype, msg, _ := conn.ReadMessage()
		// errorhandler(err)
		var other *websocket.Conn
		if ur.Role == "Host" {
			other = current.Receiver
		} else {
			other = current.Sender
		}
		other.WriteMessage(msgtype, msg)
	}
}