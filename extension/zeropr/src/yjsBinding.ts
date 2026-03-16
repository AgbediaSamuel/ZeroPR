import * as Y from 'yjs'
import * as vscode from 'vscode'

export class YjsBinding {
	private ytext: Y.Text
	private doc: Y.Doc
	private document: vscode.TextDocument
	private isApplyingRemote = false
	private ytextObserver: (event: Y.YTextEvent, transaction: Y.Transaction) => void
	private disposable: vscode.Disposable

	constructor(ytext: Y.Text, doc: Y.Doc, document: vscode.TextDocument) {
		this.ytext = ytext
		this.doc = doc
		this.document = document

		this.ytextObserver = (event, transaction) => {
			if (transaction.local) { return }
			console.log('[YjsBinding] remote change, delta:', JSON.stringify(event.delta))
			this.applyRemoteChanges(event)
		}
		ytext.observe(this.ytextObserver)

		this.disposable = vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document !== this.document || this.isApplyingRemote) { return }
			console.log('[YjsBinding] local change, changes:', event.contentChanges.length)
			this.applyLocalChanges(event.contentChanges)
		})
	}

	private async applyRemoteChanges(event: Y.YTextEvent) {
		this.isApplyingRemote = true
		const wsEdit = new vscode.WorkspaceEdit()
		let offset = 0

		for (const op of event.delta) {
			if (op.retain !== undefined) {
				offset += op.retain
			} else if (op.insert !== undefined) {
				const pos = this.document.positionAt(offset)
				const text = typeof op.insert === 'string' ? op.insert : ''
				wsEdit.insert(this.document.uri, pos, text)
				offset += text.length
			} else if (op.delete !== undefined) {
				const start = this.document.positionAt(offset)
				const end = this.document.positionAt(offset + op.delete)
				wsEdit.delete(this.document.uri, new vscode.Range(start, end))
			}
		}

		await vscode.workspace.applyEdit(wsEdit)
		this.isApplyingRemote = false
	}

	private applyLocalChanges(changes: readonly vscode.TextDocumentContentChangeEvent[]) {
		this.doc.transact(() => {
			// reverse order preserves offsets when multiple changes exist
			const sorted = [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset)
			for (const change of sorted) {
				if (change.rangeLength > 0) {
					this.ytext.delete(change.rangeOffset, change.rangeLength)
				}
				if (change.text.length > 0) {
					this.ytext.insert(change.rangeOffset, change.text)
				}
			}
		})
	}

	destroy() {
		this.ytext.unobserve(this.ytextObserver)
		this.disposable.dispose()
	}
}
