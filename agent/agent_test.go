package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestRegistryAddAndGet(t *testing.T) {
	r := NewRegister()
	r.Add(&Peer{Name: "Alice", Host: "192.168.1.1", LastSeen: "now"})

	p := r.Get("192.168.1.1")
	if p.Name != "Alice" {
		t.Errorf("expected Alice, got %s", p.Name)
	}
}

func TestRegistryAddDuplicate(t *testing.T) {
	r := NewRegister()
	r.Add(&Peer{Name: "Alice", Host: "192.168.1.1", LastSeen: "now"})
	r.Add(&Peer{Name: "Alice", Host: "192.168.1.1", LastSeen: "later"})

	p := r.Get("192.168.1.1")
	if p.LastSeen != "later" {
		t.Errorf("expected LastSeen updated to 'later', got %s", p.LastSeen)
	}
}

func TestRegistryRemove(t *testing.T) {
	r := NewRegister()
	r.Add(&Peer{Name: "Alice", Host: "192.168.1.1", LastSeen: "now"})
	r.Remove("192.168.1.1")

	p := r.Get("192.168.1.1")
	if p.Name != "" {
		t.Errorf("expected empty peer after remove, got %s", p.Name)
	}
}

func TestRegistryRemoveNonexistent(t *testing.T) {
	r := NewRegister()
	r.Remove("does-not-exist")
}

func TestRegistryGetAll(t *testing.T) {
	r := NewRegister()
	r.Add(&Peer{Name: "A", Host: "1.1.1.1"})
	r.Add(&Peer{Name: "B", Host: "2.2.2.2"})
	r.Add(&Peer{Name: "C", Host: "3.3.3.3"})

	all := r.GetAll()
	if len(all) != 3 {
		t.Errorf("expected 3 peers, got %d", len(all))
	}
}

func TestRegistryConcurrent(t *testing.T) {
	r := NewRegister()
	var wg sync.WaitGroup

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			host := string(rune('A'+i%26)) + ".host"
			r.Add(&Peer{Name: "peer", Host: host})
			r.Get(host)
			r.GetAll()
		}(i)
	}
	wg.Wait()
}

func TestSessionAddAndGet(t *testing.T) {
	sr := NewSessionRegister()
	sr.Add(&Session{ID: "s1", Host: "h1", FilePath: "main.go", Active: true})

	s := sr.Get("s1")
	if s.Host != "h1" {
		t.Errorf("expected h1, got %s", s.Host)
	}
}

func TestSessionAddDuplicate(t *testing.T) {
	sr := NewSessionRegister()
	sr.Add(&Session{ID: "s1", Host: "h1"})
	sr.Add(&Session{ID: "s1", Host: "h2"})

	s := sr.Get("s1")
	if s.Host != "h1" {
		t.Errorf("duplicate add should be no-op, got %s", s.Host)
	}
}

func TestSessionUpdate(t *testing.T) {
	sr := NewSessionRegister()
	sr.Add(&Session{ID: "s1", Host: "h1"})
	sr.Update(&Session{ID: "s1", Host: "h1", Guest: "g1"})

	s := sr.Get("s1")
	if s.Guest != "g1" {
		t.Errorf("expected guest g1, got %s", s.Guest)
	}
}

func TestSessionRemove(t *testing.T) {
	sr := NewSessionRegister()
	sr.Add(&Session{ID: "s1", Host: "h1"})
	sr.Remove("s1")

	s := sr.Get("s1")
	if s.ID != "" {
		t.Errorf("expected empty session, got %s", s.ID)
	}
}

func TestSessionGetNonexistent(t *testing.T) {
	sr := NewSessionRegister()
	s := sr.Get("nope")
	if s.ID != "" {
		t.Errorf("expected empty session for nonexistent ID")
	}
}

func TestSessionGetAll(t *testing.T) {
	sr := NewSessionRegister()
	sr.Add(&Session{ID: "s1", Host: "h1"})
	sr.Add(&Session{ID: "s2", Host: "h2"})
	sr.Add(&Session{ID: "s3", Host: "h3"})

	all := sr.GetAll()
	if len(all) != 3 {
		t.Errorf("expected 3 sessions, got %d", len(all))
	}
}

func TestSessionConcurrent(t *testing.T) {
	sr := NewSessionRegister()
	var wg sync.WaitGroup

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := string(rune('A' + i%26))
			sr.Add(&Session{ID: id, Host: "h"})
			sr.Get(id)
			sr.Update(&Session{ID: id, Host: "h", Guest: "g"})
			sr.GetAll()
			if i%3 == 0 {
				sr.Remove(id)
			}
		}(i)
	}
	wg.Wait()
}

func TestHealthEndpoint(t *testing.T) {
	req := httptest.NewRequest("GET", "/api", nil)
	w := httptest.NewRecorder()
	server(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if w.Body.String() != "Server running" {
		t.Errorf("unexpected body: %s", w.Body.String())
	}
}

func TestCreateSession(t *testing.T) {
	sessionregister = NewSessionRegister()

	body, _ := json.Marshal(UserRequest{Host: "testhost", Role: "Host", FilePath: "main.go"})
	req := httptest.NewRequest("POST", "/api/session/create", bytes.NewReader(body))
	w := httptest.NewRecorder()
	startSession(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var s Session
	json.Unmarshal(w.Body.Bytes(), &s)
	if s.ID == "" {
		t.Error("session ID should not be empty")
	}
	if s.Host != "testhost" {
		t.Errorf("expected host testhost, got %s", s.Host)
	}
	if !s.Active {
		t.Error("session should be active")
	}
}

func TestGetAllSessionsEmpty(t *testing.T) {
	sessionregister = NewSessionRegister()

	req := httptest.NewRequest("GET", "/api/sessions", nil)
	w := httptest.NewRecorder()
	getAllSessions(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestEndSession(t *testing.T) {
	sessionregister = NewSessionRegister()
	sessionregister.Add(&Session{ID: "end-me", Host: "h1", Active: true})

	body, _ := json.Marshal(UserRequest{Host: "h1", Role: "Host", ID: "end-me"})
	req := httptest.NewRequest("POST", "/api/session/end", bytes.NewReader(body))
	w := httptest.NewRecorder()
	endSession(w, req)

	s := sessionregister.Get("end-me")
	if s.ID != "" {
		t.Error("session should be removed after end")
	}
}

func TestLeaveSessionGuest(t *testing.T) {
	sessionregister = NewSessionRegister()
	sessionregister.Add(&Session{ID: "leave-me", Host: "h1", Guest: "g1", Active: true})

	body, _ := json.Marshal(UserRequest{Host: "g1", Role: "Guest", ID: "leave-me"})
	req := httptest.NewRequest("POST", "/api/session/leave", bytes.NewReader(body))
	w := httptest.NewRecorder()
	leaveSession(w, req)

	s := sessionregister.Get("leave-me")
	if s.ID == "" {
		t.Error("session should still exist after guest leave")
	}
	if s.Guest != "" {
		t.Errorf("guest should be cleared, got %s", s.Guest)
	}
}

func TestLeaveSessionHost(t *testing.T) {
	sessionregister = NewSessionRegister()
	sessionregister.Add(&Session{ID: "host-leave", Host: "h1", Guest: "g1", Active: true})

	body, _ := json.Marshal(UserRequest{Host: "h1", Role: "Host", ID: "host-leave"})
	req := httptest.NewRequest("POST", "/api/session/leave", bytes.NewReader(body))
	w := httptest.NewRecorder()
	leaveSession(w, req)

	s := sessionregister.Get("host-leave")
	if s.ID != "" {
		t.Error("session should be removed when host leaves")
	}
}

func TestRelayHostFromRemoteAddr(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"192.168.1.1:12345", "192.168.1.1"},
		{"10.0.0.1:80", "10.0.0.1"},
		{"[::1]:9080", "::1"},
		{"malformed", "malformed"},
	}

	for _, tt := range tests {
		result := relayHostFromRemoteAddr(tt.input)
		if result != tt.expected {
			t.Errorf("relayHostFromRemoteAddr(%s) = %s, want %s", tt.input, result, tt.expected)
		}
	}
}

func TestStopBroadcastWithoutStart(t *testing.T) {
	cancel = nil
	started = false

	req := httptest.NewRequest("POST", "/api/broadcast/stop", nil)
	w := httptest.NewRecorder()

	defer func() {
		if r := recover(); r != nil {
			t.Errorf("stopBroadcast panicked: %v", r)
		}
	}()

	stopBroadcast(w, req)
}

func TestReadPeersEmpty(t *testing.T) {
	register = NewRegister()

	req := httptest.NewRequest("GET", "/api/peers", nil)
	w := httptest.NewRecorder()
	readPeers(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestCreateAndEndFlow(t *testing.T) {
	sessionregister = NewSessionRegister()

	body, _ := json.Marshal(UserRequest{Host: "h1", Role: "Host", FilePath: "test.go"})
	req := httptest.NewRequest("POST", "/api/session/create", bytes.NewReader(body))
	w := httptest.NewRecorder()
	startSession(w, req)

	var s Session
	json.Unmarshal(w.Body.Bytes(), &s)

	all := sessionregister.GetAll()
	if len(all) != 1 {
		t.Errorf("expected 1 session, got %d", len(all))
	}

	endBody, _ := json.Marshal(UserRequest{Host: "h1", Role: "Host", ID: s.ID})
	endReq := httptest.NewRequest("POST", "/api/session/end", bytes.NewReader(endBody))
	endW := httptest.NewRecorder()
	endSession(endW, endReq)

	all = sessionregister.GetAll()
	if len(all) != 0 {
		t.Errorf("expected 0 sessions after end, got %d", len(all))
	}
}

func TestMalformedJSON(t *testing.T) {
	handlers := []struct {
		name    string
		handler http.HandlerFunc
	}{
		{"create", startSession},
		{"leave", leaveSession},
		{"end", endSession},
	}

	for _, h := range handlers {
		req := httptest.NewRequest("POST", "/api/test", bytes.NewReader([]byte("not json")))
		w := httptest.NewRecorder()

		defer func() {
			if r := recover(); r != nil {
				t.Errorf("%s panicked on malformed JSON: %v", h.name, r)
			}
		}()

		h.handler(w, req)
	}
}
