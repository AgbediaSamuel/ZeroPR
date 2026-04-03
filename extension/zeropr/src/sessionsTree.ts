import * as vscode from 'vscode'
import { TreeDataProvider as Tree, TreeItem as Item } from 'vscode'
import { Session, getSessions, host } from './agentClient'

export class Sessions implements Tree<Session> {
    getTreeItem(element: Session): Item {
        const other = (element.host === host) ? element.guest : element.host
        const label = other ? `Session with ${other}` : 'Waiting for guest...'
        const session = new Item(label)
        session.description = element.id.slice(0, 8)
        session.tooltip = `Created: ${element.createdat}`
        session.contextValue = (element.host === host) ? "ownSession" : "invitation"
        return session
    }

    async getChildren(): Promise<Session[]> {
        const sessions = await getSessions()
        return sessions
    }

    private changeEvent = new vscode.EventEmitter<Session | undefined>()
    readonly onDidChangeTreeData = this.changeEvent.event

    update() {
        this.changeEvent.fire(undefined)
    }
}
