package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/zeropr/agent/internal/discovery"
	"github.com/zeropr/agent/internal/peers"
	"github.com/zeropr/agent/internal/sessions"
)

const version = "0.1.0"

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for local development
	},
}

// Server handles HTTP and WebSocket connections
type Server struct {
	httpPort      int
	wsPort        int
	registry      *peers.Registry
	discovery     *discovery.Service
	sessionMgr    *sessions.Manager
	httpServer    *http.Server
	wsServer      *http.Server
	localPresence *LocalPresence
	workingDir    string
}

// LocalPresence stores this device's presence information
type LocalPresence struct {
	ActiveFile string                           `json:"activeFile"`
	Cursor     *struct{ Line, Column int }      `json:"cursor"`
	Status     string                           `json:"status"`
}

// NewServer creates a new server instance
func NewServer(httpPort, wsPort int, registry *peers.Registry, discovery *discovery.Service) *Server {
	workingDir, _ := os.Getwd()
	
	return &Server{
		httpPort:   httpPort,
		wsPort:     wsPort,
		registry:   registry,
		discovery:  discovery,
		sessionMgr: sessions.NewManager(),
		localPresence: &LocalPresence{
			Status: "idle",
		},
		workingDir: workingDir,
	}
}

// Start starts both HTTP and WebSocket servers
func (s *Server) Start() error {
	// Setup HTTP API
	router := mux.NewRouter()
	
	// API endpoints
	api := router.PathPrefix("/api").Subrouter()
	api.HandleFunc("/peers", s.handleGetPeers).Methods("GET")
	api.HandleFunc("/status", s.handleGetStatus).Methods("GET")
	api.HandleFunc("/broadcast/start", s.handleStartBroadcast).Methods("POST")
	api.HandleFunc("/broadcast/stop", s.handleStopBroadcast).Methods("POST")
	api.HandleFunc("/presence", s.handleUpdatePresence).Methods("POST")
	api.HandleFunc("/file/request", s.handleFileRequest).Methods("POST")
	api.HandleFunc("/file/send", s.handleFileSend).Methods("POST")
	api.HandleFunc("/file/get", s.handleFileGet).Methods("GET")
	api.HandleFunc("/session/create", s.handleSessionCreate).Methods("POST")
	api.HandleFunc("/session/join", s.handleSessionJoin).Methods("POST")
	api.HandleFunc("/session/leave", s.handleSessionLeave).Methods("POST")
	api.HandleFunc("/sessions", s.handleGetSessions).Methods("GET")
	api.HandleFunc("/debug/add-mock-peer", s.handleAddMockPeer).Methods("POST")
	
	// WebSocket endpoint for Yjs sync
	router.HandleFunc("/ws/sync/{sessionId}", s.handleYjsSync)
	
	// CORS middleware
	router.Use(corsMiddleware)
	
	s.httpServer = &http.Server{
		Addr:    fmt.Sprintf(":%d", s.httpPort),
		Handler: router,
	}
	
	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully shuts down the server
func (s *Server) Shutdown(ctx context.Context) error {
	if s.httpServer != nil {
		return s.httpServer.Shutdown(ctx)
	}
	return nil
}

// HTTP Handlers

func (s *Server) handleGetPeers(w http.ResponseWriter, r *http.Request) {
	peers := s.registry.GetAll()
	
	response := map[string]interface{}{
		"peers": peers,
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (s *Server) handleGetStatus(w http.ResponseWriter, r *http.Request) {
	response := map[string]interface{}{
		"running":        true,
		"version":        version,
		"peersCount":     s.registry.Count(),
		"broadcasting":   s.discovery.IsBroadcasting(),
		"activeSessions": s.sessionMgr.Count(),
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (s *Server) handleStartBroadcast(w http.ResponseWriter, r *http.Request) {
	err := s.discovery.StartBroadcast()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to start broadcast: %v", err), http.StatusInternalServerError)
		return
	}
	
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "started"})
}

func (s *Server) handleStopBroadcast(w http.ResponseWriter, r *http.Request) {
	s.discovery.StopBroadcast()
	
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "stopped"})
}

func (s *Server) handleUpdatePresence(w http.ResponseWriter, r *http.Request) {
	var presence LocalPresence
	if err := json.NewDecoder(r.Body).Decode(&presence); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	
	s.localPresence = &presence
	log.Printf("Presence updated: file=%s, status=%s", presence.ActiveFile, presence.Status)
	
	// TODO: Update mDNS TXT records with this information
	
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "updated"})
}

func (s *Server) handleFileRequest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PeerID   string `json:"peerId"`
		FilePath string `json:"filePath"`
	}
	
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	peer, exists := s.registry.Get(req.PeerID)
	if !exists {
		http.Error(w, "Peer not found", http.StatusNotFound)
		return
	}
	
	// Forward request to peer's agent
	log.Printf("Forwarding file request to %s: %s", peer.Name, req.FilePath)
	
	// TODO: Make HTTP request to peer's agent to get file
	// For now, return mock response
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "pending",
		"message": "File request sent to peer",
	})
}

func (s *Server) handleFileSend(w http.ResponseWriter, r *http.Request) {
	var req struct {
		FilePath string `json:"filePath"`
	}
	
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	// Construct full file path relative to working directory
	fullPath := filepath.Join(s.workingDir, req.FilePath)
	
	// Read file content
	content, err := os.ReadFile(fullPath)
	if err != nil {
		log.Printf("Error reading file %s: %v", fullPath, err)
		http.Error(w, fmt.Sprintf("File not found: %v", err), http.StatusNotFound)
		return
	}
	
	log.Printf("Sending file: %s (%d bytes)", req.FilePath, len(content))
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"filePath": req.FilePath,
		"content":  string(content),
		"status":   "success",
	})
}

func (s *Server) handleFileGet(w http.ResponseWriter, r *http.Request) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		http.Error(w, "Missing path parameter", http.StatusBadRequest)
		return
	}
	
	// Construct full file path relative to working directory
	fullPath := filepath.Join(s.workingDir, filePath)
	
	// Read file content
	content, err := os.ReadFile(fullPath)
	if err != nil {
		log.Printf("Error reading file %s: %v", fullPath, err)
		http.Error(w, fmt.Sprintf("File not found: %v", err), http.StatusNotFound)
		return
	}
	
	log.Printf("Serving file: %s (%d bytes)", filePath, len(content))
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"filePath": filePath,
		"content":  string(content),
		"status":   "success",
	})
}

func (s *Server) handleAddMockPeer(w http.ResponseWriter, r *http.Request) {
	mockPeer := &peers.Peer{
		ID:         "mock-peer-1",
		Name:       "Alice's Laptop",
		Address:    "10.0.0.5",
		Port:       8080,
		RepoHash:   "abc123",
		Branch:     "feat/auth",
		ActiveFile: "src/components/Login.tsx",
		Status:     "editing",
		LastSeen:   time.Now(),
		Trusted:    false,
	}
	
	s.registry.Add(mockPeer)
	log.Printf("Added mock peer: %s", mockPeer.Name)
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "added"})
}

func (s *Server) handleSessionCreate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		FilePath  string `json:"filePath"`
		Initiator string `json:"initiator"`
	}
	
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	// Generate session ID
	sessionID := fmt.Sprintf("session-%d", time.Now().UnixNano())
	
	session := s.sessionMgr.Create(sessionID, req.FilePath, req.Initiator)
	log.Printf("Created session: %s for file %s", sessionID, req.FilePath)
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"sessionId": session.ID,
		"filePath":  session.FilePath,
		"wsUrl":     fmt.Sprintf("ws://localhost:%d/ws/sync/%s", s.httpPort, session.ID),
	})
}

func (s *Server) handleSessionJoin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SessionID     string `json:"sessionId"`
		ParticipantID string `json:"participantId"`
	}
	
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	if !s.sessionMgr.AddParticipant(req.SessionID, req.ParticipantID) {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}
	
	log.Printf("Participant %s joined session %s", req.ParticipantID, req.SessionID)
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "joined"})
}

func (s *Server) handleSessionLeave(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SessionID     string `json:"sessionId"`
		ParticipantID string `json:"participantId"`
	}
	
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	
	s.sessionMgr.RemoveParticipant(req.SessionID, req.ParticipantID)
	log.Printf("Participant %s left session %s", req.ParticipantID, req.SessionID)
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "left"})
}

func (s *Server) handleGetSessions(w http.ResponseWriter, r *http.Request) {
	sessions := s.sessionMgr.GetAll()
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"sessions": sessions,
	})
}

func (s *Server) handleYjsSync(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionID := vars["sessionId"]
	
	// Check if session exists
	session, exists := s.sessionMgr.Get(sessionID)
	if !exists {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}
	
	// Upgrade to WebSocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()
	
	log.Printf("WebSocket connected for session %s (file: %s)", sessionID, session.FilePath)
	
	// Simple message relay for Yjs
	// In production, this would relay binary Yjs update messages between all connected clients
	for {
		messageType, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("WebSocket read error: %v", err)
			break
		}
		
		log.Printf("Received Yjs message: %d bytes", len(message))
		
		// TODO: Broadcast to all other participants in the session
		// For now, just echo back
		if err := conn.WriteMessage(messageType, message); err != nil {
			log.Printf("WebSocket write error: %v", err)
			break
		}
	}
	
	log.Printf("WebSocket closed for session %s", sessionID)
}

// Middleware

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		
		next.ServeHTTP(w, r)
	})
}

// WebSocket handlers (placeholder for future implementation)

func (s *Server) handleWebSocketConnection(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()
	
	log.Println("WebSocket connection established")
	
	// TODO: Implement WebSocket message handling
	for {
		messageType, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("WebSocket read error: %v", err)
			break
		}
		
		log.Printf("Received: %s", message)
		
		// Echo back for now
		if err := conn.WriteMessage(messageType, message); err != nil {
			log.Printf("WebSocket write error: %v", err)
			break
		}
	}
}

