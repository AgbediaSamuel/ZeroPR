import * as vscode from 'vscode';
import { TreeDataProvider as Tree, TreeItem as Item } from 'vscode';
import { Peer, getPeers } from './agentClient';

export class Peers implements Tree<Peer> {
    private lastData = '';

    getTreeItem(element: Peer): Item {
        const peer = new Item(element.Name);
        peer.description = element.Host;
        peer.tooltip = `Last Seen: ${element.LastSeen}`;
        return peer;
    }

    async getChildren(): Promise<Peer[]> {
        const peers = await getPeers();
        return peers;
    }

    private changeEvent = new vscode.EventEmitter<Peer | undefined>();
    readonly onDidChangeTreeData = this.changeEvent.event;

    update() {
        this.changeEvent.fire(undefined);
    }

    async poll() {
        try {
            const peers = await getPeers();
            const data = JSON.stringify(peers);
            if (data !== this.lastData) {
                this.lastData = data;
                this.changeEvent.fire(undefined);
            }
        } catch {}
    }
}
