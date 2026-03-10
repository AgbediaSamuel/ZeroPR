import * as vscode from 'vscode'
import { TreeDataProvider as Tree, TreeItem as Item } from 'vscode'
import { Session, getSessions, host } from './agentClient'

export class Sessions implements Tree<Session> {
    getTreeItem(element: Session): Item {
        const other = (element.Host === host) ? element.Guest : element.Host
        const session = new Item(`Session with ${other}`)
        session.description = element.ID
        session.tooltip = `Created: ${element.CreatedAt}`
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
