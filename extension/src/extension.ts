import * as vscode from 'vscode';
import { AgentClient } from './agentClient';
import { PeersViewProvider } from './ui/peersView';
import { PresenceManager } from './presenceManager';
import { SessionManager } from './sessionManager';

let agentClient: AgentClient;
let presenceManager: PresenceManager;
let sessionManager: SessionManager;

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext) {
  console.log('ZeroPR extension activating...');

  // Initialize agent client
  const config = vscode.workspace.getConfiguration('zeropr');
  const agentPort = config.get<number>('agentPort', 8080);
  agentClient = new AgentClient(`http://localhost:${agentPort}`);

  // Check if agent is running
  const agentRunning = await agentClient.isAgentRunning();
  if (!agentRunning) {
    vscode.window.showWarningMessage(
      'ZeroPR: Agent not running. Start it with: cd agent && ./bin/zeropr-agent',
      'Dismiss'
    );
  }

  // Initialize presence manager
  presenceManager = new PresenceManager(agentClient);
  context.subscriptions.push(presenceManager);

  // Initialize session manager
  sessionManager = new SessionManager(agentClient);

  // Register views
  const peersProvider = new PeersViewProvider(agentClient);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('zeropr.peersView', peersProvider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('zeropr.showPeers', () => {
      vscode.window.showInformationMessage('ZeroPR: Showing peers');
      peersProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zeropr.startBroadcast', async () => {
      try {
        await agentClient.startBroadcast();
        vscode.window.showInformationMessage('ZeroPR: Broadcasting started');
      } catch (error) {
        vscode.window.showErrorMessage(`ZeroPR: Failed to start broadcast - ${error}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zeropr.stopBroadcast', async () => {
      try {
        await agentClient.stopBroadcast();
        vscode.window.showInformationMessage('ZeroPR: Broadcasting stopped');
      } catch (error) {
        vscode.window.showErrorMessage(`ZeroPR: Failed to stop broadcast - ${error}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zeropr.requestFile', async (peerItem) => {
      if (!peerItem || !peerItem.peerId) {
        vscode.window.showErrorMessage('No peer selected');
        return;
      }

      const peers = await agentClient.getPeers();
      const peer = peers.find(p => p.id === peerItem.peerId);
      
      if (!peer || !peer.activeFile) {
        vscode.window.showWarningMessage('Peer has no active file');
        return;
      }

      try {
        vscode.window.showInformationMessage(`Requesting ${peer.activeFile} from ${peer.name}...`);
        
        // Request file from peer
        const response = await agentClient.requestFile(peer.id, peer.activeFile);
        
        // Try to open or create the file in workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          const filePath = vscode.Uri.joinPath(workspaceFolders[0].uri, peer.activeFile);
          
          // Write received content to file
          const content = Buffer.from(response.content, 'utf8');
          await vscode.workspace.fs.writeFile(filePath, content);
          
          // Open the file
          const doc = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(doc);
          
          vscode.window.showInformationMessage(`Received ${peer.activeFile} from ${peer.name}`);
        } else {
          // No workspace, open in temporary document
          const doc = await vscode.workspace.openTextDocument({
            content: response.content,
            language: peer.activeFile.endsWith('.ts') ? 'typescript' : 'javascript'
          });
          
          await vscode.window.showTextDocument(doc);
          vscode.window.showInformationMessage(`Received ${peer.activeFile} from ${peer.name} (open as temp file)`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to request file: ${error}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zeropr.startCoEdit', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active file');
        return;
      }

      const filePath = vscode.workspace.asRelativePath(editor.document.uri);
      
      try {
        await sessionManager.startCoEdit(filePath);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to start co-edit: ${error}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zeropr.stopCoEdit', async () => {
      try {
        await sessionManager.stopCoEdit();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to stop co-edit: ${error}`);
      }
    })
  );

  // Track active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      presenceManager.updateActiveFile(editor);
    })
  );

  // Track cursor position changes
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(event => {
      presenceManager.updateCursorPosition(event.textEditor, event.selections[0]);
    })
  );

  // Auto-start broadcasting if configured
  const autoBroadcast = config.get<boolean>('autoBroadcast', true);
  if (autoBroadcast && agentRunning) {
    try {
      await agentClient.startBroadcast();
      console.log('ZeroPR: Auto-broadcast started');
    } catch (error) {
      console.error('ZeroPR: Failed to auto-start broadcast', error);
    }
  }

  // Update initial active file
  if (vscode.window.activeTextEditor) {
    presenceManager.updateActiveFile(vscode.window.activeTextEditor);
  }

  console.log('ZeroPR extension activated');
}

/**
 * Extension deactivation
 */
export async function deactivate() {
  console.log('ZeroPR extension deactivating...');
  
  if (agentClient) {
    try {
      await agentClient.stopBroadcast();
    } catch (error) {
      console.error('Failed to stop broadcast on deactivation', error);
    }
  }
}

