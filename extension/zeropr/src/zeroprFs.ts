import * as vscode from 'vscode';

export class ZeroPRFileSystem implements vscode.FileSystemProvider {
	private files = new Map<string, Uint8Array>();
	private changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	readonly onDidChangeFile = this.changeEmitter.event;

	stat(uri: vscode.Uri): vscode.FileStat {
		const data = this.files.get(uri.path);
		if (!data) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		return {
			type: vscode.FileType.File,
			ctime: Date.now(),
			mtime: Date.now(),
			size: data.byteLength
		};
	}

	readFile(uri: vscode.Uri): Uint8Array {
		const data = this.files.get(uri.path);
		if (!data) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		return data;
	}

	writeFile(uri: vscode.Uri, content: Uint8Array): void {
		this.files.set(uri.path, content);
	}

	delete(uri: vscode.Uri): void {
		this.files.delete(uri.path);
	}

	watch(): vscode.Disposable {
		return new vscode.Disposable(() => {});
	}

	readDirectory(): [string, vscode.FileType][] {
		throw vscode.FileSystemError.NoPermissions('Not supported');
	}

	createDirectory(): void {
		throw vscode.FileSystemError.NoPermissions('Not supported');
	}

	rename(): void {
		throw vscode.FileSystemError.NoPermissions('Not supported');
	}
}
