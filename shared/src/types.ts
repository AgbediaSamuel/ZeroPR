/**
 * Core types for ZeroPR protocol
 */

/**
 * Represents a peer on the network
 */
export interface Peer {
  /** Unique peer identifier */
  id: string;
  /** Display name */
  name: string;
  /** IP address */
  address: string;
  /** Port for WebSocket connections */
  port: number;
  /** Current Git repository hash */
  repoHash: string;
  /** Current branch name */
  branch: string;
  /** Currently active file path (relative to repo root) */
  activeFile: string | null;
  /** Cursor position in active file */
  cursor: CursorPosition | null;
  /** Current status */
  status: PeerStatus;
  /** Last seen timestamp */
  lastSeen: number;
  /** Whether this peer is trusted */
  trusted: boolean;
}

/**
 * Cursor position in a file
 */
export interface CursorPosition {
  line: number;
  column: number;
}

/**
 * Peer status
 */
export type PeerStatus = 'editing' | 'idle' | 'away';

/**
 * Presence broadcast message (sent via mDNS/UDP)
 */
export interface PresenceMessage {
  id: string;
  name: string;
  repoHash: string;
  branch: string;
  activeFile: string | null;
  cursor: CursorPosition | null;
  status: PeerStatus;
  port: number;
}

/**
 * Session types
 */
export type SessionMode = 'quick-share' | 'co-edit';

export interface Session {
  id: string;
  mode: SessionMode;
  fileId: string;
  participants: string[];
  initiator: string;
  createdAt: number;
}

/**
 * Request to join a co-editing session
 */
export interface SessionRequest {
  requesterId: string;
  targetPeerId: string;
  filePath: string;
  mode: SessionMode;
}

/**
 * Response to a session request
 */
export interface SessionResponse {
  accepted: boolean;
  sessionId?: string;
  wsAddress?: string;
  reason?: string;
}

/**
 * File diff message
 */
export interface FileDiff {
  filePath: string;
  fromPeer: string;
  diff: string;
  timestamp: number;
}

/**
 * Pairing request (for first-time connections)
 */
export interface PairingRequest {
  fromPeer: string;
  publicKey: string;
  verificationCode: string;
}

/**
 * Pairing response
 */
export interface PairingResponse {
  accepted: boolean;
  publicKey?: string;
  verificationCode?: string;
}

/**
 * Agent API endpoints response types
 */
export interface PeersResponse {
  peers: Peer[];
}

export interface StatusResponse {
  running: boolean;
  version: string;
  peersCount: number;
  activeSessions: number;
}

export interface ErrorResponse {
  error: string;
  code?: string;
}

