import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

let child: ChildProcess | null = null;

function targetDir(): string {
	const p = process.platform;
	const a = process.arch;
	if (p === 'darwin' && a === 'arm64') return 'darwin-arm64';
	if (p === 'darwin' && a === 'x64') return 'darwin-x64';
	if (p === 'linux' && a === 'arm64') return 'linux-arm64';
	if (p === 'linux' && a === 'x64') return 'linux-x64';
	if (p === 'win32' && a === 'x64') return 'win32-x64';
	throw new Error(`unsupported platform: ${p}/${a}`);
}

function binaryPath(extensionPath: string): string {
	const target = targetDir();
	const exe = process.platform === 'win32' ? 'zeropr-agent.exe' : 'zeropr-agent';
	return path.join(extensionPath, 'bin', target, exe);
}

async function waitForHealth(timeoutMs: number = 5000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch('http://localhost:9080/api/health', { signal: AbortSignal.timeout(300) });
			if (res.ok) return;
		} catch {}
		await new Promise(r => setTimeout(r, 150));
	}
	throw new Error('agent did not become healthy within ' + timeoutMs + 'ms');
}

export async function startAgent(context: vscode.ExtensionContext): Promise<void> {
	const bin = binaryPath(context.extensionPath);
	if (!fs.existsSync(bin)) {
		throw new Error(`zeropr-agent binary not found at ${bin}`);
	}
	if (process.platform !== 'win32') {
		try { fs.chmodSync(bin, 0o755); } catch {}
	}

	try {
		await waitForHealth(400);
		return;
	} catch {}

	child = spawn(bin, [], {
		stdio: 'ignore',
		detached: false,
		windowsHide: true,
	});

	child.on('error', err => {
		vscode.window.showErrorMessage(`ZeroPR agent failed to start: ${err.message}`);
	});

	await waitForHealth(5000);
}

export function stopAgent(): void {
	if (child && !child.killed) {
		try { child.kill('SIGTERM'); } catch {}
		child = null;
	}
}
