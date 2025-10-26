import * as vscode from 'vscode';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { AgentClient } from './agentClient';

export class SessionManager {
  private activeSession: {
    sessionId: string;
    doc: Y.Doc;
    provider: WebsocketProvider;
    filePath: string;
    disposable: vscode.Disposable;
  } | null = null;

  constructor(private agentClient: AgentClient) {}

  async startCoEdit(filePath: string): Promise<void> {
    if (this.activeSession) {
      vscode.window.showWarningMessage('Already in a co-editing session');
      return;
    }

    try {
      // Create session on agent
      const response = await this.agentClient.createSession(filePath);
      
      // Initialize Yjs document
      const ydoc = new Y.Doc();
      const ytext = ydoc.getText('content');

      // Get current file content
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.uri.fsPath.endsWith(filePath)) {
        const content = editor.document.getText();
        ytext.insert(0, content);
      }

      // Connect to WebSocket
      const provider = new WebsocketProvider(
        response.wsUrl.replace('ws://', ''),
        response.sessionId,
        ydoc
      );

      // Bind Yjs to editor
      const disposable = this.bindYjsToEditor(ydoc, ytext, filePath);

      this.activeSession = {
        sessionId: response.sessionId,
        doc: ydoc,
        provider,
        filePath,
        disposable,
      };

      vscode.window.showInformationMessage(`Started co-editing ${filePath}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to start co-edit: ${error}`);
    }
  }

  async stopCoEdit(): Promise<void> {
    if (!this.activeSession) {
      return;
    }

    // Disconnect provider
    this.activeSession.provider.destroy();
    
    // Clean up bindings
    this.activeSession.disposable.dispose();

    // Notify agent
    await this.agentClient.leaveSession(this.activeSession.sessionId);

    vscode.window.showInformationMessage(`Stopped co-editing ${this.activeSession.filePath}`);
    this.activeSession = null;
  }

  private bindYjsToEditor(ydoc: Y.Doc, ytext: Y.Text, filePath: string): vscode.Disposable {
    // Listen to Yjs changes and apply to editor
    const observer = (event: Y.YTextEvent) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editor.document.uri.fsPath.endsWith(filePath)) {
        return;
      }

      editor.edit(editBuilder => {
        event.changes.delta.forEach((change: any) => {
          if (change.retain) {
            // No-op, just move position
          } else if (change.insert) {
            const pos = editor.document.positionAt(change.insert.length);
            editBuilder.insert(pos, change.insert);
          } else if (change.delete) {
            const start = editor.document.positionAt(0);
            const end = editor.document.positionAt(change.delete);
            editBuilder.delete(new vscode.Range(start, end));
          }
        });
      });
    };

    ytext.observe(observer);

    // Listen to editor changes and apply to Yjs
    const changeDisposable = vscode.workspace.onDidChangeTextDocument(event => {
      if (!event.document.uri.fsPath.endsWith(filePath)) {
        return;
      }

      event.contentChanges.forEach(change => {
        const startOffset = event.document.offsetAt(change.range.start);
        
        // Delete old content
        if (change.rangeLength > 0) {
          ytext.delete(startOffset, change.rangeLength);
        }
        
        // Insert new content
        if (change.text.length > 0) {
          ytext.insert(startOffset, change.text);
        }
      });
    });

    return vscode.Disposable.from(changeDisposable, {
      dispose: () => ytext.unobserve(observer),
    });
  }

  isInSession(): boolean {
    return this.activeSession !== null;
  }

  getActiveSession() {
    return this.activeSession;
  }
}

