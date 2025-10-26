package sessions

import (
	"sync"
	"time"
)

// Session represents a co-editing session
type Session struct {
	ID           string
	FilePath     string
	Participants []string
	Initiator    string
	CreatedAt    time.Time
}

// Manager manages active sessions
type Manager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
}

// NewManager creates a new session manager
func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
	}
}

// Create creates a new session
func (m *Manager) Create(id, filePath, initiator string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()

	session := &Session{
		ID:           id,
		FilePath:     filePath,
		Participants: []string{initiator},
		Initiator:    initiator,
		CreatedAt:    time.Now(),
	}

	m.sessions[id] = session
	return session
}

// Get retrieves a session by ID
func (m *Manager) Get(id string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, ok := m.sessions[id]
	return session, ok
}

// AddParticipant adds a participant to a session
func (m *Manager) AddParticipant(sessionID, participantID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return false
	}

	// Check if already participant
	for _, p := range session.Participants {
		if p == participantID {
			return true
		}
	}

	session.Participants = append(session.Participants, participantID)
	return true
}

// RemoveParticipant removes a participant from a session
func (m *Manager) RemoveParticipant(sessionID, participantID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return
	}

	// Remove participant
	for i, p := range session.Participants {
		if p == participantID {
			session.Participants = append(session.Participants[:i], session.Participants[i+1:]...)
			break
		}
	}

	// If no participants left, delete session
	if len(session.Participants) == 0 {
		delete(m.sessions, sessionID)
	}
}

// GetAll returns all active sessions
func (m *Manager) GetAll() []*Session {
	m.mu.RLock()
	defer m.mu.RUnlock()

	sessions := make([]*Session, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	return sessions
}

// Count returns the number of active sessions
func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return len(m.sessions)
}

