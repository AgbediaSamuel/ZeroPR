import * as vscode from 'vscode'
import * as Y from 'yjs'
import { startBroadcast, stopBroadcast, createSession, joinSession, endSession, invitePeer, getSessions, host, Session, wsconn } from './agentClient'
import { Peers } from './peersTree'
import { Sessions } from './sessionsTree'
import { YjsProvider } from './yjsProvider'
import { YjsBinding } from './yjsBinding'
import { ZeroPRFileSystem } from './zeroprFs'

let activeWs: WebSocket | null = null
let activeDocument: vscode.TextDocument | null = null
let activeDoc: Y.Doc | null = null
let activeProvider: YjsProvider | null = null
let activeBinding: YjsBinding | null = null
let activeSessionId: string | null = null
let activeSandboxFilename: string | null = null
let originalFilePath: string | null = null
let isEndingSession = false
let zeroprFs: ZeroPRFileSystem

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

async function cleanupSession() {
	cleanupYjs()
	if (activeWs) {
		activeWs.close()
		activeWs = null
	}
	// close the sandbox editor tab
	const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs)
	for (const tab of tabs) {
		if (tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'zeropr') {
			await vscode.window.tabGroups.close(tab)
		}
	}
	if (activeSessionId && activeSandboxFilename) {
		const uri = vscode.Uri.parse(`zeropr://session-${activeSessionId}/${activeSandboxFilename}`)
		try { zeroprFs.delete(uri) } catch {}
	}
	activeDocument = null
	activeSessionId = null
	activeSandboxFilename = null
	originalFilePath = null
	isEndingSession = false
}

async function openSandbox(sessionId: string, filename: string, content: string): Promise<vscode.TextDocument> {
	const uri = vscode.Uri.parse(`zeropr://session-${sessionId}/${filename}`)
	const encoder = new TextEncoder()
	zeroprFs.writeFile(uri, encoder.encode(content))
	const doc = await vscode.workspace.openTextDocument(uri)
	await vscode.window.showTextDocument(doc, { preview: false })
	return doc
}

function setupWsOnClose(ws: WebSocket, sessionsView: Sessions, isHost: boolean) {
	ws.onclose = async () => {
		if (isEndingSession) { return }

		if (isHost && activeDoc && activeSessionId) {
			vscode.window.showInformationMessage('Guest left the session')
			const request = { host: host, role: "Host", id: activeSessionId }
			wsconn("localhost", request).then(newWs => {
				activeProvider?.destroy()
				if (activeDoc) {
					activeProvider = new YjsProvider(activeDoc, newWs)
				}
				activeWs = newWs
				setupWsOnClose(newWs, sessionsView, true)
			})
		} else {
			vscode.window.showInformationMessage('Session ended')
			const sessionId = activeSessionId
			await cleanupSession()
			if (sessionId) {
				await endSession(sessionId)
			}
			sessionsView.update()
		}
	}
}

export function activate(context: vscode.ExtensionContext) {
	zeroprFs = new ZeroPRFileSystem()
	context.subscriptions.push(
		vscode.workspace.registerFileSystemProvider('zeropr', zeroprFs, { isCaseSensitive: true })
	)

	const peersView = new Peers()
	const sessionsView = new Sessions()
	vscode.window.registerTreeDataProvider("zeropr.getPeers", peersView)
	vscode.window.registerTreeDataProvider("zeropr.sessions", sessionsView)

	const pollInterval = setInterval(() => {
		peersView.update()
		sessionsView.update()
	}, 3000)
	context.subscriptions.push({ dispose: () => clearInterval(pollInterval) })

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
			const fileContent = editor.document.getText()
			const filePath = editor.document.uri.fsPath
			const filename = `[ZeroPR] ${filePath.split('/').pop() || 'untitled'}`

			const { session, ws } = await invitePeer(peer, filePath)
			activeSessionId = session.id
			activeSandboxFilename = filename
			originalFilePath = filePath
			const doc = await openSandbox(session.id, filename, fileContent)
			activeDocument = doc
			setupYjs(ws, doc, true)
			activeWs = ws
			setupWsOnClose(ws, sessionsView, true)
			sessionsView.update()
			vscode.window.showInformationMessage(`Invited ${peer.Name} to session`)
		}),

		vscode.commands.registerCommand("zeropr.createSession", async () => {
			const editor = vscode.window.activeTextEditor
			if (!editor) {
				vscode.window.showWarningMessage("Open a file to start a session")
				return
			}
			const fileContent = editor.document.getText()
			const filePath = editor.document.uri.fsPath
			const filename = `[ZeroPR] ${filePath.split('/').pop() || 'untitled'}`

			const { session, ws } = await createSession(filePath)
			activeSessionId = session.id
			activeSandboxFilename = filename
			originalFilePath = filePath
			const doc = await openSandbox(session.id, filename, fileContent)
			activeDocument = doc
			setupYjs(ws, doc, true)
			activeWs = ws
			setupWsOnClose(ws, sessionsView, true)
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

			const filename = `[ZeroPR] ${session.filepath.split('/').pop() || 'untitled'}`
			activeSessionId = session.id
			activeSandboxFilename = filename

			const ws = await joinSession(session)
			const doc = await openSandbox(session.id, filename, '')
			activeDocument = doc
			setupYjs(ws, doc, false)
			activeWs = ws
			setupWsOnClose(ws, sessionsView, false)
			sessionsView.update()
			vscode.window.showInformationMessage(`Joined session with ${session.host}`)
		}),

		vscode.commands.registerCommand("zeropr.endSession", async (sessionItem?: Session) => {
			if (activeDoc && originalFilePath) {
				const ytext = activeDoc.getText('content')
				const answer = await vscode.window.showInformationMessage(
					`Save changes to ${originalFilePath.split('/').pop()}?`,
					'Save', 'Discard'
				)
				if (answer === 'Save') {
					const uri = vscode.Uri.file(originalFilePath)
					const encoder = new TextEncoder()
					await vscode.workspace.fs.writeFile(uri, encoder.encode(ytext.toString()))
				}
			}
			isEndingSession = true
			if (sessionItem) {
				await endSession(sessionItem.id)
			} else if (activeSessionId) {
				await endSession(activeSessionId)
			}
			cleanupSession()
			sessionsView.update()
		}),

		vscode.commands.registerCommand("zeropr.leaveSession", async (sessionItem?: Session) => {
			isEndingSession = true
			if (sessionItem) {
				await endSession(sessionItem.id)
			}
			cleanupSession()
			sessionsView.update()
		}),

		vscode.commands.registerCommand('zeropr.undo', () => {
			activeBinding?.undoManager.undo()
		}),

		vscode.commands.registerCommand('zeropr.redo', () => {
			activeBinding?.undoManager.redo()
		}),

		vscode.commands.registerCommand('zeropr.helloWorld', () => {
			vscode.window.showInformationMessage('Hello World from zeropr!')
		})
	)

	console.log('ZeroPR extension is now active!')
}

export function deactivate() {
	isEndingSession = true
	cleanupSession()
}
