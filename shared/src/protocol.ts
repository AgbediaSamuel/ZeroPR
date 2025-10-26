/**
 * Protocol constants and message types
 */

/**
 * WebSocket message types
 */
export enum WSMessageType {
  // Session control
  SESSION_JOIN = 'session:join',
  SESSION_LEAVE = 'session:leave',
  SESSION_STATE = 'session:state',
  
  // CRDT sync (Yjs messages are binary, these are for metadata)
  CURSOR_UPDATE = 'cursor:update',
  SELECTION_UPDATE = 'selection:update',
  
  // File operations
  FILE_REQUEST = 'file:request',
  FILE_RESPONSE = 'file:response',
  DIFF_SEND = 'diff:send',
  
  // Pairing
  PAIRING_REQUEST = 'pairing:request',
  PAIRING_RESPONSE = 'pairing:response',
  
  // Keep-alive
  PING = 'ping',
  PONG = 'pong',
}

/**
 * Base WebSocket message
 */
export interface WSMessage<T = any> {
  type: WSMessageType;
  payload: T;
  timestamp: number;
}

/**
 * HTTP API endpoints
 */
export const API_ENDPOINTS = {
  PEERS: '/api/peers',
  STATUS: '/api/status',
  BROADCAST_START: '/api/broadcast/start',
  BROADCAST_STOP: '/api/broadcast/stop',
  SESSION_REQUEST: '/api/session/request',
  FILE_DIFF: '/api/file/diff',
  PAIRING: '/api/pairing',
} as const;

/**
 * Default ports
 */
export const DEFAULT_PORTS = {
  AGENT_HTTP: 8080,
  AGENT_WS: 9000,
  MDNS_PORT: 5353,
} as const;

/**
 * Protocol version
 */
export const PROTOCOL_VERSION = '0.1.0';

/**
 * Service name for mDNS discovery
 */
export const MDNS_SERVICE_NAME = '_zeropr._tcp';

/**
 * Broadcast interval (milliseconds)
 */
export const BROADCAST_INTERVAL_MS = 2000;

/**
 * Peer timeout (milliseconds)
 */
export const PEER_TIMEOUT_MS = 10000;

