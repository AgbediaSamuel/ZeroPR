import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const MSG_SYNC = 0
const MSG_AWARENESS = 1

export class YjsProvider {
	doc: Y.Doc
	ws: WebSocket
	awareness: awarenessProtocol.Awareness
	private updateHandler: (update: Uint8Array, origin: any) => void
	private awarenessHandler: ({ added, updated, removed }: { added: number[], updated: number[], removed: number[] }, origin: any) => void

	constructor(doc: Y.Doc, ws: WebSocket) {
		this.doc = doc
		this.ws = ws
		this.awareness = new awarenessProtocol.Awareness(doc)

		this.updateHandler = (update, origin) => {
			if (origin === this) { return }
			const encoder = encoding.createEncoder()
			encoding.writeVarUint(encoder, MSG_SYNC)
			syncProtocol.writeUpdate(encoder, update)
			this.send(encoding.toUint8Array(encoder))
		}

		this.awarenessHandler = ({ added, updated, removed }) => {
			const changed = added.concat(updated, removed)
			const encoder = encoding.createEncoder()
			encoding.writeVarUint(encoder, MSG_AWARENESS)
			encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed))
			this.send(encoding.toUint8Array(encoder))
		}

		doc.on('update', this.updateHandler)
		this.awareness.on('update', this.awarenessHandler)

		ws.onmessage = (event) => this.onMessage(event)

		this.sendSyncStep1()
	}

	private onMessage(event: MessageEvent) {
		const data = new Uint8Array(event.data instanceof ArrayBuffer ? event.data : event.data)
		const decoder = decoding.createDecoder(data)
		const msgType = decoding.readVarUint(decoder)

		if (msgType === MSG_SYNC) {
			const encoder = encoding.createEncoder()
			encoding.writeVarUint(encoder, MSG_SYNC)
			syncProtocol.readSyncMessage(decoder, encoder, this.doc, this)
			if (encoding.length(encoder) > 1) {
				this.send(encoding.toUint8Array(encoder))
			}
		} else if (msgType === MSG_AWARENESS) {
			awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this)
		}
	}

	private sendSyncStep1() {
		const encoder = encoding.createEncoder()
		encoding.writeVarUint(encoder, MSG_SYNC)
		syncProtocol.writeSyncStep1(encoder, this.doc)
		this.send(encoding.toUint8Array(encoder))
	}

	private send(data: Uint8Array) {
		if (this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(data)
		}
	}

	destroy() {
		this.doc.off('update', this.updateHandler)
		this.awareness.off('update', this.awarenessHandler)
		awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], null)
	}
}
