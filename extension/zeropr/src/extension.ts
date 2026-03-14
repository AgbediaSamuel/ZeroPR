import * as vscode from 'vscode'
import * as Y from 'yjs'
import { startBroadcast, stopBroadcast, createSession, joinSession, leaveSession, invitePeer, getSessions, host, Session } from './agentClient'
import { Peers } from './peersTree'
import { Sessions } from './sessionsTree'
import { YjsProvider } from './yjsProvider'
import { YjsBinding } from './yjsBinding'

let activeWs: WebSocket | null = null
let activeDocument: vscode.TextDocument | null = null
let activeDoc: Y.Doc | null = null

let activeProvider: YjsProvider | null = null
let activeBinding: YjsBinding | null = null

function setupYjs(ws: WebSocket, document: vscode.TextDocument, isHost: boolean) {
	const ydoc = new Y.Doc()
	const ytext = ydoc.getText('content')
	if (isHost) {
		ytext.insert(0, document.getText())
	}
	activeDoc = ydoc
	activeProvider = new YjsProvider(ydoc, ws)
	activeBinding = new YjsBinding(ytext, ydoc, document)
}

function cleanupYjs() {
	activeBinding?.destroy()
	activeProvider?.destroy()
	activeDoc?.destroy()
	activeBinding = null
	activeProvider = null
	activeDoc = null
}

export function activate(context: vscode.ExtensionContext) {
	const peersView = new Peers()
	const sessionsView = new Sessions()
	vscode.window.registerTreeDataProvider("zeropr.getPeers", peersView)
	vscode.window.registerTreeDataProvider("zeropr.sessions", sessionsView)

	context.subscriptions.push(
		vscode.commands.registerCommand("zeropr.startBroadcast", () => {
			startBroadcast()
			peersView.update()
		}),

		vscode.commands.registerCommand("zeropr.stopBroadcast", () => {
			stopBroadcast()
			peersView.update()
		}),

		vscode.commands.registerCommand("zeropr.refreshPeers", () => {
			peersView.update()
		}),

		vscode.commands.registerCommand("zeropr.refreshSessions", () => {
			sessionsView.update()
		}),

		vscode.commands.registerCommand("zeropr.invitePeer", async (peer) => {
			const editor = vscode.window.activeTextEditor
			if (!editor) {
				vscode.window.showWarningMessage("Open a file to start a session")
				return
			}
			activeDocument = editor.document
			const { session, ws } = await invitePeer(peer, editor.document.uri.fsPath, () => {
				setupYjs(ws, editor.document, true)
			})
			activeWs = ws
			sessionsView.update()
			vscode.window.showInformationMessage(`Invited ${peer.Host} to session`)
		}),

		vscode.commands.registerCommand("zeropr.createSession", async () => {
			const editor = vscode.window.activeTextEditor
			if (!editor) {
				vscode.window.showWarningMessage("Open a file to start a session")
				return
			}
			activeDocument = editor.document
			const { session, ws } = await createSession(editor.document.uri.fsPath, () => {
				setupYjs(ws, editor.document, true)
			})
			activeWs = ws
			sessionsView.update()
			vscode.window.showInformationMessage(`Session created: ${session.id.slice(0, 8)}`)
		}),

		vscode.commands.registerCommand("zeropr.joinSession", async (sessionItem?: Session) => {
			let session = sessionItem
			if (!session) {
				const sessions = await getSessions()
				const pending = sessions.filter(s => s.host !== host)
				if (pending.length === 0) {
					vscode.window.showInformationMessage("No sessions to join")
					return
				}
				const pick = await vscode.window.showQuickPick(
					pending.map(s => ({ label: `Session with ${s.host}`, detail: s.id, session: s })),
					{ placeHolder: "Select a session to join" }
				)
				if (!pick) { return }
				session = pick.session
			}

			// guest: create empty doc, Yjs sync will fill in content from host
			const doc = await vscode.workspace.openTextDocument({ content: '' })
			activeDocument = doc
			await vscode.window.showTextDocument(doc)

			const ws = await joinSession(session, () => {
				setupYjs(ws, doc, false)
			})
			activeWs = ws
			sessionsView.update()
			vscode.window.showInformationMessage(`Joined session with ${session.host}`)
		}),

		vscode.commands.registerCommand("zeropr.leaveSession", async (sessionItem?: Session) => {
			if (sessionItem) {
				const role = sessionItem.host === host ? "Host" : "Guest"
				await leaveSession(sessionItem.id, role)
			}
			cleanupYjs()
			if (activeWs) {
				activeWs.close()
				activeWs = null
			}
			activeDocument = null
			sessionsView.update()
		}),

		vscode.commands.registerCommand('zeropr.helloWorld', () => {
			vscode.window.showInformationMessage('Hello World from zeropr!')
		})
	)

	console.log('ZeroPR extension is now active!')
}

export function deactivate() {
	cleanupYjs()
	if (activeWs) {
		activeWs.close()
		activeWs = null
	}
}
