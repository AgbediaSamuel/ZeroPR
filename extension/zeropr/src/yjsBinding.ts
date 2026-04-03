import * as Y from 'yjs'
import * as vscode from 'vscode'

const ORIGIN_LOCAL = 'local'

interface ChangeSnapshot {
	before: string
	after: string
}

export class YjsBinding {
	private ytext: Y.Text
	private doc: Y.Doc
	private document: vscode.TextDocument
	private text: string
	private changeSets: ChangeSnapshot[] = []
	private remoteQueue: Y.YTextEvent[] = []
	private processing = false
	private ytextObserver: (event: Y.YTextEvent, transaction: Y.Transaction) => void
	private disposable: vscode.Disposable
	undoManager: Y.UndoManager

	constructor(ytext: Y.Text, doc: Y.Doc, document: vscode.TextDocument) {
		this.ytext = ytext
		this.doc = doc
		this.document = document
		this.text = document.getText()
		this.undoManager = new Y.UndoManager(ytext, { trackedOrigins: new Set([ORIGIN_LOCAL]) })

		this.ytextObserver = (event, transaction) => {
			if (transaction.origin === ORIGIN_LOCAL) { return }
			this.remoteQueue.push(event)
			this.processQueue()
		}
		ytext.observe(this.ytextObserver)

		this.disposable = vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document !== this.document) { return }
			if (event.contentChanges.length === 0) { return }
			if (this.shouldApply(event.contentChanges)) {
				this.applyLocalChanges(event.contentChanges)
			}
		})
	}

	// Eclipse OCT approach: replay incoming VS Code changes against stored
	// {before, after} snapshots. If the replay matches a known remote change,
	// it's an echo — skip it. This is deterministic and timing-independent.
	private shouldApply(contentChanges: readonly vscode.TextDocumentContentChangeEvent[]): boolean {
		// update our internal text mirror with whatever VS Code says happened
		const changes = [...contentChanges].sort((a, b) => a.rangeOffset - b.rangeOffset)
		let newText = this.text
		let drift = 0
		for (const change of changes) {
			const start = change.rangeOffset + drift
			const end = start + change.rangeLength
			newText = newText.substring(0, start) + change.text + newText.substring(end)
			drift += change.text.length - change.rangeLength
		}

		// check if this change matches any pending remote changeset
		for (const changeSet of this.changeSets) {
			let replayText = changeSet.before
			let replayDrift = 0
			for (const change of changes) {
				const start = change.rangeOffset + replayDrift
				const end = start + change.rangeLength
				replayText = replayText.substring(0, start) + change.text + replayText.substring(end)
				replayDrift += change.text.length - change.rangeLength
			}
			if (replayText === changeSet.after) {
				// echo detected — mirror was already updated by applyRemote, don't double-update
				return false
			}
		}

		// real local change — update mirror
		this.text = newText
		return true
	}

	private async processQueue() {
		if (this.processing) { return }
		this.processing = true

		try {
			while (this.remoteQueue.length > 0) {
				const event = this.remoteQueue.shift()!
				await this.applyRemoteChanges(event)
			}
		} catch (err) {
			console.error('[YjsBinding] error processing remote queue:', err)
		} finally {
			this.processing = false
		}
	}

	private async applyRemoteChanges(event: Y.YTextEvent) {
		const before = this.text

		// apply delta to our internal mirror first
		let mirrorOffset = 0
		let mirrorText = this.text
		for (const op of event.delta) {
			if (op.retain !== undefined) {
				mirrorOffset += op.retain
			} else if (op.insert !== undefined) {
				const text = typeof op.insert === 'string' ? op.insert : ''
				mirrorText = mirrorText.substring(0, mirrorOffset) + text + mirrorText.substring(mirrorOffset)
				mirrorOffset += text.length
			} else if (op.delete !== undefined) {
				mirrorText = mirrorText.substring(0, mirrorOffset) + mirrorText.substring(mirrorOffset + op.delete)
			}
		}
		const after = mirrorText
		this.text = after

		// push changeset BEFORE applyEdit so the echo detector has it
		const changeSet: ChangeSnapshot = { before, after }
		this.changeSets.push(changeSet)

		// build and apply the VS Code edit
		const wsEdit = new vscode.WorkspaceEdit()
		let offset = 0
		for (const op of event.delta) {
			if (op.retain !== undefined) {
				offset += op.retain
			} else if (op.insert !== undefined) {
				const text = typeof op.insert === 'string' ? op.insert : ''
				const pos = this.document.positionAt(offset)
				wsEdit.insert(this.document.uri, pos, text)
				offset += text.length
			} else if (op.delete !== undefined) {
				const start = this.document.positionAt(offset)
				const end = this.document.positionAt(offset + op.delete)
				wsEdit.delete(this.document.uri, new vscode.Range(start, end))
			}
		}

		await vscode.workspace.applyEdit(wsEdit)

		// remove changeset after applyEdit completes (echo event already fired)
		const index = this.changeSets.indexOf(changeSet)
		if (index !== -1) {
			this.changeSets.splice(index, 1)
		}

		// drift detection
		const ytextContent = this.ytext.toString()
		const docContent = this.document.getText()
		if (ytextContent !== docContent) {
			console.warn('[YjsBinding] DRIFT DETECTED — resyncing')
			console.warn('[YjsBinding] Y.Text length:', ytextContent.length, 'doc length:', docContent.length)
			await this.resync()
		}
	}

	private async resync() {
		const content = this.ytext.toString()
		const before = this.text
		this.text = content

		const fullRange = new vscode.Range(
			this.document.positionAt(0),
			this.document.positionAt(this.document.getText().length)
		)
		const edit = new vscode.WorkspaceEdit()
		edit.replace(this.document.uri, fullRange, content)

		const changeSet: ChangeSnapshot = { before, after: content }
		this.changeSets.push(changeSet)

		await vscode.workspace.applyEdit(edit)

		const index = this.changeSets.indexOf(changeSet)
		if (index !== -1) {
			this.changeSets.splice(index, 1)
		}
	}

	private applyLocalChanges(changes: readonly vscode.TextDocumentContentChangeEvent[]) {
		this.doc.transact(() => {
			const sorted = [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset)
			for (const change of sorted) {
				if (change.rangeLength > 0) {
					this.ytext.delete(change.rangeOffset, change.rangeLength)
				}
				if (change.text.length > 0) {
					this.ytext.insert(change.rangeOffset, change.text)
				}
			}
		}, ORIGIN_LOCAL)
	}

	destroy() {
		this.ytext.unobserve(this.ytextObserver)
		this.disposable.dispose()
	}
}
