import * as vscode from 'vscode';
import * as awarenessProtocol from 'y-protocols/awareness';

const COLORS = [
	{ cursor: '#FF6B6B', selection: 'rgba(255,107,107,0.3)' },
	{ cursor: '#4ECDC4', selection: 'rgba(78,205,196,0.3)' },
	{ cursor: '#FFE66D', selection: 'rgba(255,230,109,0.3)' },
	{ cursor: '#A855F7', selection: 'rgba(168,85,247,0.3)' },
	{ cursor: '#F97316', selection: 'rgba(249,115,22,0.3)' },
];

interface CursorState {
	anchor: number
	head: number
}

export class CursorPresence {
	private awareness: awarenessProtocol.Awareness;
	private document: vscode.TextDocument;
	private cursorDecoration: vscode.TextEditorDecorationType;
	private selectionDecoration: vscode.TextEditorDecorationType;
	private cursorDisposable: vscode.Disposable;
	private awarenessHandler: () => void;

	constructor(awareness: awarenessProtocol.Awareness, document: vscode.TextDocument, localName: string) {
		this.awareness = awareness;
		this.document = document;

		const color = COLORS[(awareness.clientID + 1) % COLORS.length];

		this.cursorDecoration = vscode.window.createTextEditorDecorationType({
			borderStyle: 'solid',
			borderWidth: '0 2px 0 0',
			borderColor: color.cursor,
		});

		this.selectionDecoration = vscode.window.createTextEditorDecorationType({
			backgroundColor: color.selection,
		});

		awareness.setLocalStateField('user', { name: localName });

		this.cursorDisposable = vscode.window.onDidChangeTextEditorSelection(event => {
			if (event.textEditor.document !== this.document) { return; }
			const sel = event.selections[0];
			awareness.setLocalStateField('cursor', {
				anchor: this.document.offsetAt(sel.anchor),
				head: this.document.offsetAt(sel.active),
			});
		});

		this.awarenessHandler = () => this.renderRemoteCursors();
		awareness.on('change', this.awarenessHandler);
	}

	private renderRemoteCursors() {
		const editor = vscode.window.visibleTextEditors.find(e => e.document === this.document);
		if (!editor) { return; }

		const cursors: vscode.DecorationOptions[] = [];
		const selections: vscode.DecorationOptions[] = [];
		const states = this.awareness.getStates();

		for (const [clientID, state] of states.entries()) {
			if (clientID === this.awareness.doc.clientID) { continue; }

			const cursor = state.cursor as CursorState | undefined;
			if (!cursor) { continue; }

			const anchor = this.document.positionAt(cursor.anchor);
			const head = this.document.positionAt(cursor.head);

			if (cursor.anchor === cursor.head) {
				cursors.push({ range: new vscode.Range(head, head) });
			} else {
				const start = anchor.isBefore(head) ? anchor : head;
				const end = anchor.isBefore(head) ? head : anchor;
				selections.push({ range: new vscode.Range(start, end) });
				cursors.push({ range: new vscode.Range(head, head) });
			}
		}

		editor.setDecorations(this.cursorDecoration, cursors);
		editor.setDecorations(this.selectionDecoration, selections);
	}

	destroy() {
		this.cursorDisposable.dispose();
		this.awareness.off('change', this.awarenessHandler);
		this.cursorDecoration.dispose();
		this.selectionDecoration.dispose();
	}
}
