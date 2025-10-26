import axios, { AxiosInstance } from 'axios';
import { Peer, StatusResponse, API_ENDPOINTS } from '@zeropr/shared';

/**
 * Client for communicating with the local ZeroPR agent
 */
export class AgentClient {
  private client: AxiosInstance;

  constructor(baseURL: string = 'http://localhost:8080') {
    this.client = axios.create({
      baseURL,
      timeout: 5000,
    });
  }

  /**
   * Get list of discovered peers
   */
  async getPeers(): Promise<Peer[]> {
    try {
      const response = await this.client.get(API_ENDPOINTS.PEERS);
      return response.data.peers || [];
    } catch (error) {
      console.error('Failed to get peers:', error);
      return [];
    }
  }

  /**
   * Get agent status
   */
  async getStatus(): Promise<StatusResponse | null> {
    try {
      const response = await this.client.get(API_ENDPOINTS.STATUS);
      return response.data;
    } catch (error) {
      console.error('Failed to get status:', error);
      return null;
    }
  }

  /**
   * Start broadcasting presence
   */
  async startBroadcast(): Promise<void> {
    await this.client.post(API_ENDPOINTS.BROADCAST_START);
  }

  /**
   * Stop broadcasting presence
   */
  async stopBroadcast(): Promise<void> {
    await this.client.post(API_ENDPOINTS.BROADCAST_STOP);
  }

  /**
   * Request file diff from peer
   */
  async requestFileDiff(peerId: string, filePath: string): Promise<string> {
    const response = await this.client.get(`${API_ENDPOINTS.FILE_DIFF}/${peerId}/${encodeURIComponent(filePath)}`);
    return response.data.diff;
  }

  /**
   * Check if agent is running
   */
  async isAgentRunning(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      return status?.running || false;
    } catch {
      return false;
    }
  }

  /**
   * Update presence information (active file, cursor, status)
   */
  async updatePresence(presence: {
    activeFile: string | null;
    cursor: { line: number; column: number } | null;
    status: 'editing' | 'idle' | 'away';
  }): Promise<void> {
    await this.client.post('/api/presence', presence);
  }

  /**
   * Request file from peer
   */
  async requestFile(peerId: string, filePath: string): Promise<{ content: string; filePath: string }> {
    const response = await this.client.post('/api/file/request', {
      peerId,
      filePath
    });
    return response.data;
  }

  /**
   * Create co-editing session
   */
  async createSession(filePath: string): Promise<{ sessionId: string; wsUrl: string; filePath: string }> {
    const response = await this.client.post('/api/session/create', {
      filePath,
      initiator: 'local-user'
    });
    return response.data;
  }

  /**
   * Join existing session
   */
  async joinSession(sessionId: string): Promise<void> {
    await this.client.post('/api/session/join', {
      sessionId,
      participantId: 'local-user'
    });
  }

  /**
   * Leave session
   */
  async leaveSession(sessionId: string): Promise<void> {
    await this.client.post('/api/session/leave', {
      sessionId,
      participantId: 'local-user'
    });
  }
}

