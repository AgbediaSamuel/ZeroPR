package peers

import (
	"sync"
	"time"
)

// Peer represents a discovered peer on the network
type Peer struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Address    string    `json:"address"`
	Port       int       `json:"port"`
	RepoHash   string    `json:"repoHash"`
	Branch     string    `json:"branch"`
	ActiveFile string    `json:"activeFile,omitempty"`
	Status     string    `json:"status"`
	LastSeen   time.Time `json:"lastSeen"`
	Trusted    bool      `json:"trusted"`
}

// Registry manages discovered peers
type Registry struct {
	peers map[string]*Peer
	mu    sync.RWMutex
}

// NewRegistry creates a new peer registry
func NewRegistry() *Registry {
	return &Registry{
		peers: make(map[string]*Peer),
	}
}

// Add adds or updates a peer
func (r *Registry) Add(peer *Peer) {
	r.mu.Lock()
	defer r.mu.Unlock()
	
	peer.LastSeen = time.Now()
	r.peers[peer.ID] = peer
}

// Get retrieves a peer by ID
func (r *Registry) Get(id string) (*Peer, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	
	peer, ok := r.peers[id]
	return peer, ok
}

// GetAll returns all peers
func (r *Registry) GetAll() []*Peer {
	r.mu.RLock()
	defer r.mu.RUnlock()
	
	peers := make([]*Peer, 0, len(r.peers))
	for _, peer := range r.peers {
		peers = append(peers, peer)
	}
	return peers
}

// Remove removes a peer by ID
func (r *Registry) Remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	
	delete(r.peers, id)
}

// Cleanup removes stale peers (not seen in timeout duration)
func (r *Registry) Cleanup(timeout time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	
	now := time.Now()
	for id, peer := range r.peers {
		if now.Sub(peer.LastSeen) > timeout {
			delete(r.peers, id)
		}
	}
}

// Count returns the number of peers
func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	
	return len(r.peers)
}

