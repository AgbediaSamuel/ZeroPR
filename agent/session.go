package main

import (
	"maps"
	"slices"
	"sync"

	"github.com/gorilla/websocket"
)

// TODO: figure out a way to isolate what websocket connection gets sent
// to a user

type Session struct {
	ID string `json:"id"`
	Host string `json:"host"`
	Guest string `json:"guest"`
	FilePath string `json:"filepath"`
	CreatedAt string `json:"createdat"`
	Active bool `json:"active"`
	Sender *websocket.Conn `json:"-"`
	Receiver *websocket.Conn `json:"-"`
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

func (sr *SessionRegistry) Update(session *Session) {
	sr.Key.Lock()
	sr.sessions[session.ID] = *session
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
	defer sr.Key.RUnlock()
	iterator := maps.Values(sr.sessions)
	values := slices.Collect(iterator)
	return values
}