package main

import (
	"maps"
	"sync"
	"slices"
)

// TODO: refactor lock and unlocks to use wrapper function instead
// add a new method that can edit sessions directly in the map
// instead of using sessionregister.Lock() and Unlock()

type Peer struct {
	Name string
	Host string
	LastSeen string
}

type Registry struct {
	peers map[string]Peer
	Key sync.RWMutex

}

// constructor
func NewRegister() *Registry {
	return &Registry{
		peers: make(map[string]Peer),
	}
}

func (r *Registry) exists(host string) bool {
	_, ok := r.peers[host]
	return ok
}

func (r *Registry) Add(peer *Peer) {
	r.Key.Lock()
	if !r.exists(peer.Host) {
		r.peers[peer.Host] = *peer
	}
	r.Key.Unlock()
}

func (r *Registry) Remove(host string) {
	r.Key.Lock()
	if r.exists(host) {
		delete(r.peers, host)
	}
	r.Key.Unlock()
	
}

func (r *Registry) Get(host string) Peer {
	r.Key.RLock()
	defer r.Key.RUnlock()
	if r.exists(host) {
		return r.peers[host]
	}
	return Peer{}
}

func (r *Registry) GetAll() []Peer {
	r.Key.RLock()
	iterator := maps.Values(r.peers)
	values := slices.Collect(iterator)
	r.Key.RUnlock()
	return values
}