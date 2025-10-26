import * as vscode from 'vscode';
import { Peer } from '@zeropr/shared';
import { AgentClient } from '../agentClient';

/**
 * Tree data provider for the peers view
 */
export class PeersViewProvider implements vscode.TreeDataProvider<PeerTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PeerTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private agentClient: AgentClient) {
    // Refresh peers every 5 seconds
    setInterval(() => this.refresh(), 5000);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PeerTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PeerTreeItem): Promise<PeerTreeItem[]> {
    if (element) {
      return [];
    }

    const peers = await this.agentClient.getPeers();
    
    if (peers.length === 0) {
      return [new PeerTreeItem('No peers found', '', '', vscode.TreeItemCollapsibleState.None)];
    }

    return peers.map(peer => {
      const label = `${peer.name}`;
      const description = peer.activeFile || 'idle';
      const item = new PeerTreeItem(label, peer.id, description, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('account');
      item.contextValue = 'peer';
      
      // Add status indicator
      const statusIcon = peer.status === 'editing' ? '[EDITING]' : peer.status === 'idle' ? '[IDLE]' : '[AWAY]';
      item.tooltip = `${statusIcon} ${peer.name}\nBranch: ${peer.branch || 'unknown'}\nFile: ${peer.activeFile || 'None'}\nStatus: ${peer.status}`;
      
      return item;
    });
  }
}

/**
 * Tree item representing a peer
 */
class PeerTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly peerId: string,
    description: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.description = description;
  }
}

