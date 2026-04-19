import * as vscode from 'vscode';
import * as Y from 'yjs';
import { startBroadcast, stopBroadcast, createSession, joinSession, endSession, invitePeer, getSessions, host, Session, wsconn } from './agentClient';
import { Peers } from './peersTree';
import { Sessions } from './sessionsTree';
import { YjsProvider } from './yjsProvider';
import { YjsBinding } from './yjsBinding';
import { ZeroPRFileSystem } from './zeroprFs';
import { CursorPresence } from './cursorPresence';
import { startAgent, stopAgent } from './agentProcess';

interface ActiveFile {
	binding: YjsBinding
	cursors: CursorPresence
	document: vscode.TextDocument
	sandboxFilename: string
	originalFilePath: string | null
	ytextKey: string
}

interface ActiveSession {
	id: string
	ws: WebSocket
	doc: Y.Doc
	provider: YjsProvider
	files: Map<string, ActiveFile>
	isHost: boolean
}

let activeSession: ActiveSession | null = null;
let isEndingSession = false;
let zeroprFs: ZeroPRFileSystem;
let statusBar: vscode.StatusBarItem;

function updateStatusBar() {
	if (!activeSession) {
		statusBar.text = '$(circle-slash) ZeroPR';
		statusBar.tooltip = 'No active session';
	} else {
		const fileCount = activeSession.files.size;
		const role = activeSession.isHost ? 'Host' : 'Guest';
		statusBar.text = `$(broadcast) ZeroPR: ${role} (${fileCount} file${fileCount !== 1 ? 's' : ''})`;
		statusBar.tooltip = `Session ${activeSession.id.slice(0, 8)} — ${role}`;
	}
	statusBar.show();
}

function addFileToSession(session: ActiveSession, document: vscode.TextDocument, isHost: boolean, sandboxFilename: string, originalFilePath: string | null): ActiveFile {
	const ytextKey = `file:${sandboxFilename}`;
	const ytext = session.doc.getText(ytextKey);
	if (isHost && document.getText().length > 0) {
		ytext.insert(0, document.getText());
	}
	const binding = new YjsBinding(ytext, session.doc, document);
	const cursors = new CursorPresence(session.provider.awareness, document, host);

	const file: ActiveFile = { binding, cursors, document, sandboxFilename, originalFilePath, ytextKey };
	session.files.set(sandboxFilename, file);
	return file;
}

function cleanupFile(file: ActiveFile) {
	file.cursors.destroy();
	file.binding.destroy();
}

async function cleanupSession() {
	if (activeSession) {
		for (const file of activeSession.files.values()) {
			cleanupFile(file);
		}
		activeSession.provider.destroy();
		activeSession.doc.destroy();
		activeSession.ws.close();

		const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
		for (const tab of tabs) {
			if (tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'zeropr') {
				await vscode.window.tabGroups.close(tab);
			}
		}

		for (const file of activeSession.files.values()) {
			const uri = vscode.Uri.parse(`zeropr://session-${activeSession.id}/${file.sandboxFilename}`);
			try { zeroprFs.delete(uri); } catch {}
		}
	}
	activeSession = null;
	isEndingSession = false;
	updateStatusBar();
}

async function openSandbox(sessionId: string, filename: string, content: string): Promise<vscode.TextDocument> {
	const uri = vscode.Uri.parse(`zeropr://session-${sessionId}/${filename}`);
	const encoder = new TextEncoder();
	zeroprFs.writeFile(uri, encoder.encode(content));
	const doc = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(doc, { preview: false });
	return doc;
}

function setupWsOnClose(ws: WebSocket, sessionsView: Sessions) {
	ws.onclose = async () => {
		if (isEndingSession) { return; }
		if (!activeSession) { return; }

		if (activeSession.isHost) {
			vscode.window.showInformationMessage('Guest left the session');
			const sessionId = activeSession.id;
			const request = { host: host, role: "Host", id: sessionId };
			wsconn("localhost", request).then(newWs => {
				if (!activeSession) { return; }
				activeSession.provider.destroy();
				activeSession.provider = new YjsProvider(activeSession.doc, newWs);
				for (const file of activeSession.files.values()) {
					file.cursors.destroy();
					file.cursors = new CursorPresence(activeSession.provider.awareness, file.document, host);
				}
				activeSession.ws = newWs;
				setupWsOnClose(newWs, sessionsView);
			});
		} else {
			vscode.window.showInformationMessage('Session ended');
			const sessionId = activeSession.id;
			await cleanupSession();
			await endSession(sessionId);
			sessionsView.update();
		}
	};
}

export async function activate(context: vscode.ExtensionContext) {
	try {
		await startAgent(context);
	} catch (err) {
		vscode.window.showErrorMessage(`ZeroPR: ${(err as Error).message}`);
	}

	zeroprFs = new ZeroPRFileSystem();
	context.subscriptions.push(
		vscode.workspace.registerFileSystemProvider('zeropr', zeroprFs, { isCaseSensitive: true })
	);

	statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	context.subscriptions.push(statusBar);
	updateStatusBar();

	const peersView = new Peers();
	const sessionsView = new Sessions();
	vscode.window.registerTreeDataProvider("zeropr.getPeers", peersView);
	vscode.window.registerTreeDataProvider("zeropr.sessions", sessionsView);

	const pollInterval = setInterval(() => {
		peersView.poll();
		sessionsView.poll();
	}, 3000);
	context.subscriptions.push({ dispose: () => clearInterval(pollInterval) });

	context.subscriptions.push(
		vscode.commands.registerCommand("zeropr.startBroadcast", async () => {
			try {
				await startBroadcast();
				peersView.update();
			} catch {
				vscode.window.showErrorMessage("Failed to start broadcast — is the ZeroPR agent running?");
			}
		}),

		vscode.commands.registerCommand("zeropr.stopBroadcast", async () => {
			try {
				await stopBroadcast();
				peersView.update();
			} catch {
				vscode.window.showErrorMessage("Failed to stop broadcast — is the ZeroPR agent running?");
			}
		}),

		vscode.commands.registerCommand("zeropr.refreshPeers", () => {
			peersView.update();
		}),

		vscode.commands.registerCommand("zeropr.refreshSessions", () => {
			sessionsView.update();
		}),

		vscode.commands.registerCommand("zeropr.invitePeer", async (peer) => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showWarningMessage("Open a file to start a session");
				return;
			}
			const fileContent = editor.document.getText();
			const filePath = editor.document.uri.fsPath;
			const filename = `[ZeroPR] ${filePath.split('/').pop() || 'untitled'}`;

			try {
				const { session, ws } = await invitePeer(peer, filePath);
				const ydoc = new Y.Doc();
				const provider = new YjsProvider(ydoc, ws);

				activeSession = {
					id: session.id, ws, doc: ydoc, provider,
					files: new Map(), isHost: true
				};

				const doc = await openSandbox(session.id, filename, fileContent);
				addFileToSession(activeSession, doc, true, filename, filePath);

				setupWsOnClose(ws, sessionsView);
				sessionsView.update();
				updateStatusBar();
				vscode.window.showInformationMessage(`Invited ${peer.Name} to session`);
			} catch {
				vscode.window.showErrorMessage("Failed to invite peer — is the ZeroPR agent running?");
			}
		}),

		vscode.commands.registerCommand("zeropr.createSession", async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showWarningMessage("Open a file to start a session");
				return;
			}
			const fileContent = editor.document.getText();
			const filePath = editor.document.uri.fsPath;
			const filename = `[ZeroPR] ${filePath.split('/').pop() || 'untitled'}`;

			try {
				const { session, ws } = await createSession(filePath);
				const ydoc = new Y.Doc();
				const provider = new YjsProvider(ydoc, ws);

				activeSession = {
					id: session.id, ws, doc: ydoc, provider,
					files: new Map(), isHost: true
				};

				const doc = await openSandbox(session.id, filename, fileContent);
				addFileToSession(activeSession, doc, true, filename, filePath);

				setupWsOnClose(ws, sessionsView);
				sessionsView.update();
				updateStatusBar();
				vscode.window.showInformationMessage(`Session created: ${session.id.slice(0, 8)}`);
			} catch {
				vscode.window.showErrorMessage("Failed to create session — is the ZeroPR agent running?");
			}
		}),

		vscode.commands.registerCommand("zeropr.joinSession", async (sessionItem?: Session) => {
			let session = sessionItem;
			if (!session) {
				const sessions = await getSessions();
				const pending = sessions.filter(s => s.host !== host);
				if (pending.length === 0) {
					vscode.window.showInformationMessage("No sessions to join");
					return;
				}
				const pick = await vscode.window.showQuickPick(
					pending.map(s => ({ label: `Session with ${s.host}`, detail: s.id, session: s })),
					{ placeHolder: "Select a session to join" }
				);
				if (!pick) { return; }
				session = pick.session;
			}

			const filename = `[ZeroPR] ${session.filepath.split('/').pop() || 'untitled'}`;

			let ws: WebSocket;
			try {
				ws = await joinSession(session);
			} catch {
				vscode.window.showErrorMessage("Failed to join session — is the host's agent reachable?");
				return;
			}
			const ydoc = new Y.Doc();
			const provider = new YjsProvider(ydoc, ws);

			activeSession = {
				id: session.id, ws, doc: ydoc, provider,
				files: new Map(), isHost: false
			};

			const doc = await openSandbox(session.id, filename, '');
			addFileToSession(activeSession, doc, false, filename, null);

			// poll for new Y.Text keys — when host adds a file, guest auto-opens it
			const existingKeys = new Set(Array.from(ydoc.share.keys()));
			const fileCheckInterval = setInterval(() => {
				if (!activeSession || activeSession.doc !== ydoc) {
					clearInterval(fileCheckInterval);
					return;
				}
				for (const [key] of ydoc.share) {
					if (key.startsWith('file:') && !existingKeys.has(key)) {
						existingKeys.add(key);
						const fname = key.replace('file:', '');
						openSandbox(activeSession.id, fname, '').then(newDoc => {
							if (activeSession) {
								addFileToSession(activeSession, newDoc, false, fname, null);
							}
						});
					}
				}
			}, 500);
			context.subscriptions.push({ dispose: () => clearInterval(fileCheckInterval) });

			setupWsOnClose(ws, sessionsView);
			sessionsView.update();
			updateStatusBar();
			vscode.window.showInformationMessage(`Joined session with ${session.host}`);
		}),

		vscode.commands.registerCommand("zeropr.endSession", async (sessionItem?: Session) => {
			if (activeSession) {
				for (const file of activeSession.files.values()) {
					if (file.originalFilePath) {
						const ytext = activeSession.doc.getText(file.ytextKey);
						const answer = await vscode.window.showInformationMessage(
							`Save changes to ${file.originalFilePath.split('/').pop()}?`,
							'Save', 'Discard'
						);
						if (answer === 'Save') {
							const uri = vscode.Uri.file(file.originalFilePath);
							const encoder = new TextEncoder();
							await vscode.workspace.fs.writeFile(uri, encoder.encode(ytext.toString()));
						}
					}
				}
			}
			isEndingSession = true;
			const sessionId = sessionItem?.id || activeSession?.id;
			if (sessionId) {
				await endSession(sessionId);
			}
			await cleanupSession();
			sessionsView.update();
		}),

		vscode.commands.registerCommand("zeropr.leaveSession", async (sessionItem?: Session) => {
			isEndingSession = true;
			const sessionId = sessionItem?.id || activeSession?.id;
			if (sessionId) {
				await endSession(sessionId);
			}
			await cleanupSession();
			sessionsView.update();
		}),

		vscode.commands.registerCommand("zeropr.addFile", async () => {
			if (!activeSession) {
				vscode.window.showWarningMessage("No active session — create or join one first");
				return;
			}
			if (!activeSession.isHost) {
				vscode.window.showWarningMessage("Only the host can add files to the session");
				return;
			}
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showWarningMessage("Open a file to add to the session");
				return;
			}
			const filePath = editor.document.uri.fsPath;
			const filename = `[ZeroPR] ${filePath.split('/').pop() || 'untitled'}`;

			if (activeSession.files.has(filename)) {
				vscode.window.showWarningMessage("This file is already in the session");
				return;
			}

			const fileContent = editor.document.getText();
			const doc = await openSandbox(activeSession.id, filename, fileContent);
			addFileToSession(activeSession, doc, true, filename, filePath);
			updateStatusBar();
			vscode.window.showInformationMessage(`Added ${filePath.split('/').pop()} to session`);
		}),

		vscode.commands.registerCommand('zeropr.undo', () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || !activeSession) { return; }
			for (const file of activeSession.files.values()) {
				if (file.document === editor.document) {
					file.binding.undoManager.undo();
					return;
				}
			}
		}),

		vscode.commands.registerCommand('zeropr.redo', () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || !activeSession) { return; }
			for (const file of activeSession.files.values()) {
				if (file.document === editor.document) {
					file.binding.undoManager.redo();
					return;
				}
			}
		}),

	);

}

export function deactivate() {
	isEndingSession = true;
	cleanupSession();
	stopAgent();
}
