package main

import (
	"maps"
	"slices"
	"sync"

	"github.com/gorilla/websocket"
)

type Session struct {
	ID string
	Host string
	Guest string
	FilePath string
	CreatedAt string
	Active bool
	Sender *websocket.Conn
	Receiver *websocket.Conn
}

type SessionRegistry struct {
	sessions map[string]Session
	Key sync.RWMutex
}

func NewSessionRegister() *SessionRegistry {
	return &SessionRegistry{
		sessions: make(map[string]Session),
	}
}

func (sr *SessionRegistry) exists (ID string) bool {
	_, ok := sr.sessions[ID]
	return ok
}

func (sr *SessionRegistry) Add(session *Session) {
	sr.Key.Lock()
	if !sr.exists(session.ID) {
		sr.sessions[session.ID] = *session
	}
	sr.Key.Unlock()
}

func (sr *SessionRegistry) Remove(ID string) {
	sr.Key.Lock()
	if sr.exists(ID) {
		delete(sr.sessions, ID)
	}
	sr.Key.Unlock()
}

func (sr *SessionRegistry) Get(ID string) Session {
	sr.Key.RLock()
	defer sr.Key.RUnlock()
	if sr.exists(ID) {
		return sr.sessions[ID]
	}
	return Session{}
} 

func (sr *SessionRegistry) GetAll() []Session {
	sr.Key.RLock()
	iterator := maps.Values(sr.sessions)
	values := slices.Collect(iterator)
	return values
}