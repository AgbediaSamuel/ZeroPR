// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { startBroadcast, stopBroadcast, createSession, joinSession, leaveSession, invitePeer } from './agentClient';
import { Peers } from './peersTree';
import { Sessions } from './sessionsTree';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const peersView = new Peers()
	const sessionsView = new Sessions()
	vscode.window.registerTreeDataProvider("zeropr.getPeers", peersView)
	vscode.window.registerTreeDataProvider("zeropr.sessions", sessionsView)
	vscode.commands.registerCommand("zeropr.startBroadcast", () => {
		startBroadcast()
		peersView.update()
	})
	vscode.commands.registerCommand("zeropr.stopBroadcast", () => {
		stopBroadcast()
		peersView.update()
	})
	vscode.commands.registerCommand("zeropr.refreshPeers", () => {
		peersView.update()
	})
	vscode.commands.registerCommand("zeropr.invitePeer", async (peer) => {
		await invitePeer(peer)
		sessionsView.update()
	})
	vscode.commands.registerCommand("zeropr.createSession", createSession)
	vscode.commands.registerCommand("zeropr.joinSession", joinSession)
	vscode.commands.registerCommand("zeropr.leaveSession", leaveSession)

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "zeropr" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('zeropr.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from zeropr!');
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
