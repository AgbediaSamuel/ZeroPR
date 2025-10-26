import * as vscode from 'vscode';
import * as os from 'os';
import { AgentClient } from './agentClient';

/**
 * Manages presence broadcasting (active file, cursor position, status)
 */
export class PresenceManager implements vscode.Disposable {
  private updateTimer?: NodeJS.Timeout;
  private currentFile: string | null = null;
  private currentCursor: { line: number; column: number } | null = null;
  private currentStatus: 'editing' | 'idle' | 'away' = 'idle';
  private lastActivity: number = Date.now();
  private readonly idleThreshold = 30000; // 30 seconds
  private readonly awayThreshold = 300000; // 5 minutes

  constructor(private agentClient: AgentClient) {
    this.startPresenceUpdates();
  }

  /**
   * Start periodic presence updates
   */
  private startPresenceUpdates() {
    // Send presence update every 2 seconds
    this.updateTimer = setInterval(() => {
      this.updateStatus();
      this.sendPresenceUpdate();
    }, 2000);
  }

  /**
   * Update user status based on activity
   */
  private updateStatus() {
    const now = Date.now();
    const timeSinceActivity = now - this.lastActivity;

    if (timeSinceActivity > this.awayThreshold) {
      this.currentStatus = 'away';
    } else if (timeSinceActivity > this.idleThreshold) {
      this.currentStatus = 'idle';
    } else {
      this.currentStatus = 'editing';
    }
  }

  /**
   * Send presence update to agent
   */
  private async sendPresenceUpdate() {
    try {
      await this.agentClient.updatePresence({
        activeFile: this.currentFile,
        cursor: this.currentCursor,
        status: this.currentStatus,
      });
    } catch (error) {
      console.error('Failed to update presence:', error);
    }
  }

  /**
   * Update active file
   */
  public updateActiveFile(editor: vscode.TextEditor | undefined) {
    this.lastActivity = Date.now();

    if (!editor) {
      this.currentFile = null;
      this.currentCursor = null;
      return;
    }

    // Get file path relative to workspace
    const filePath = vscode.workspace.asRelativePath(editor.document.uri);
    
    // Filter out non-code files
    const config = vscode.workspace.getConfiguration('zeropr');
    const whitelist = config.get<string[]>('fileWhitelist', []);
    const extension = filePath.split('.').pop();
    
    if (extension && whitelist.includes(`.${extension}`)) {
      this.currentFile = filePath;
      
      // Update cursor position
      const position = editor.selection.active;
      this.currentCursor = {
        line: position.line + 1, // VS Code is 0-indexed, we want 1-indexed
        column: position.character + 1,
      };
      
      console.log(`Active file: ${filePath} at ${this.currentCursor.line}:${this.currentCursor.column}`);
    } else {
      this.currentFile = null;
      this.currentCursor = null;
    }
  }

  /**
   * Update cursor position
   */
  public updateCursorPosition(editor: vscode.TextEditor, selection: vscode.Selection) {
    this.lastActivity = Date.now();

    if (!this.currentFile) {
      return;
    }

    const position = selection.active;
    this.currentCursor = {
      line: position.line + 1,
      column: position.character + 1,
    };
  }

  /**
   * Get display name for this user
   */
  private getDisplayName(): string {
    const config = vscode.workspace.getConfiguration('zeropr');
    const configName = config.get<string>('displayName');
    
    if (configName) {
      return configName;
    }

    // Fallback to system username
    return os.userInfo().username;
  }

  /**
   * Dispose resources
   */
  public dispose() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
  }
}

