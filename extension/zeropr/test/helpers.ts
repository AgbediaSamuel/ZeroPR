import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

export const MSG_SYNC = 0;
export const MSG_AWARENESS = 1;
export const AGENT = 'http://localhost:9080';

let passed = 0;
let failed = 0;

export function assert(condition: boolean, msg: string): void {
	if (condition) { passed++; }
	else { failed++; console.error(`  FAIL: ${msg}`); }
}

export function getResults(): { passed: number; failed: number } { return { passed, failed }; }
export function resetResults(): void { passed = 0; failed = 0; }

export function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

export function createProvider(doc: Y.Doc, ws: WebSocket) {
	const updateHandler = (update: Uint8Array, origin: string) => {
		if (origin === 'provider') {return;}
		const e = encoding.createEncoder();
		encoding.writeVarUint(e, MSG_SYNC);
		syncProtocol.writeUpdate(e, update);
		if (ws.readyState === 1) {ws.send(encoding.toUint8Array(e));}
	};
	ws.onmessage = (event: MessageEvent) => {
		const data = new Uint8Array(event.data instanceof ArrayBuffer ? event.data : event.data);
		const dec = decoding.createDecoder(data);
		const t = decoding.readVarUint(dec);
		if (t === MSG_SYNC) {
			const e = encoding.createEncoder();
			encoding.writeVarUint(e, MSG_SYNC);
			syncProtocol.readSyncMessage(dec, e, doc, 'provider');
			if (encoding.length(e) > 1 && ws.readyState === 1) {ws.send(encoding.toUint8Array(e));}
		}
	};
	doc.on('update', updateHandler);
	const e = encoding.createEncoder();
	encoding.writeVarUint(e, MSG_SYNC);
	syncProtocol.writeSyncStep1(e, doc);
	if (ws.readyState === 1) {ws.send(encoding.toUint8Array(e));}
	return { destroy: () => doc.off('update', updateHandler) };
}

export function createProviderWithAwareness(doc: Y.Doc, ws: WebSocket) {
	const awareness = new awarenessProtocol.Awareness(doc);
	const updateHandler = (update: Uint8Array, origin: string) => {
		if (origin === 'provider') {return;}
		const e = encoding.createEncoder();
		encoding.writeVarUint(e, MSG_SYNC);
		syncProtocol.writeUpdate(e, update);
		if (ws.readyState === 1) {ws.send(encoding.toUint8Array(e));}
	};
	const awarenessHandler = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: string) => {
		if (origin === 'provider') {return;}
		const changed = added.concat(updated, removed);
		const e = encoding.createEncoder();
		encoding.writeVarUint(e, MSG_AWARENESS);
		encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
		if (ws.readyState === 1) {ws.send(encoding.toUint8Array(e));}
	};
	ws.onmessage = (event: MessageEvent) => {
		const data = new Uint8Array(event.data);
		const dec = decoding.createDecoder(data);
		const t = decoding.readVarUint(dec);
		if (t === MSG_SYNC) {
			const e = encoding.createEncoder();
			encoding.writeVarUint(e, MSG_SYNC);
			syncProtocol.readSyncMessage(dec, e, doc, 'provider');
			if (encoding.length(e) > 1 && ws.readyState === 1) {ws.send(encoding.toUint8Array(e));}
		} else if (t === MSG_AWARENESS) {
			awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(dec), 'provider');
		}
	};
	doc.on('update', updateHandler);
	awareness.on('update', awarenessHandler);
	const e = encoding.createEncoder();
	encoding.writeVarUint(e, MSG_SYNC);
	syncProtocol.writeSyncStep1(e, doc);
	if (ws.readyState === 1) {ws.send(encoding.toUint8Array(e));}
	return {
		awareness,
		destroy: () => {
			doc.off('update', updateHandler);
			awareness.off('update', awarenessHandler);
			awarenessProtocol.removeAwarenessStates(awareness, [doc.clientID], null);
		}
	};
}

export function connectWs(url: string, token?: object): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		ws.binaryType = 'arraybuffer';
		ws.onopen = () => {
			if (token) {ws.send(JSON.stringify(token));}
			resolve(ws);
		};
		ws.onerror = () => reject(new Error('ws failed'));
	});
}

export async function createSession(): Promise<{ id: string }> {
	const res = await fetch(`${AGENT}/api/session/create`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ host: 'test', role: 'Host', filepath: 'test.go' })
	});
	return await res.json();
}

interface Peer {
	doc: Y.Doc;
	text: Y.Text;
	ws: WebSocket;
	provider: { destroy: () => void };
}

export async function setupPeer(sessionId: string, role: string, hostname: string, content: string | null): Promise<Peer> {
	const doc = new Y.Doc();
	const text = doc.getText('content');
	if (content) {text.insert(0, content);}
	const ws = await connectWs(`ws://localhost:9080/ws/session/${sessionId}`, { id: sessionId, role, host: hostname });
	const provider = createProvider(doc, ws);
	return { doc, text, ws, provider };
}

export function cleanup(...peers: Peer[]): void {
	for (const p of peers) { p.provider.destroy(); p.ws.close(); }
}

export function printResults(suiteName: string): void {
	const { passed, failed } = getResults();
	console.log(`\nResults: ${passed} passed, ${failed} failed`);
	process.exit(failed > 0 ? 1 : 0);
}

interface ContentChange {
	rangeOffset: number;
	rangeLength: number;
	text: string;
}

interface DeltaOp {
	retain?: number;
	insert?: string;
	delete?: number;
}

interface ChangeSet {
	before: string;
	after: string;
}

export class EchoDetector {
	text: string;
	changeSets: ChangeSet[];

	constructor(initialText: string) {
		this.text = initialText;
		this.changeSets = [];
	}

	applyRemote(delta: DeltaOp[]): ChangeSet {
		const before = this.text;
		let offset = 0, mirrorText = this.text;
		for (const op of delta) {
			if (op.retain !== undefined) { offset += op.retain; }
			else if (op.insert !== undefined) {
				mirrorText = mirrorText.substring(0, offset) + op.insert + mirrorText.substring(offset);
				offset += op.insert.length;
			}
			else if (op.delete !== undefined) {
				mirrorText = mirrorText.substring(0, offset) + mirrorText.substring(offset + op.delete);
			}
		}
		this.text = mirrorText;
		const cs: ChangeSet = { before, after: mirrorText };
		this.changeSets.push(cs);
		return cs;
	}

	finishRemote(cs: ChangeSet): void {
		const i = this.changeSets.indexOf(cs);
		if (i !== -1) {this.changeSets.splice(i, 1);}
	}

	shouldApply(contentChanges: ContentChange[]): boolean {
		const changes = [...contentChanges].sort((a, b) => a.rangeOffset - b.rangeOffset);
		let newText = this.text;
		let drift = 0;
		for (const change of changes) {
			const start = change.rangeOffset + drift;
			const end = start + change.rangeLength;
			newText = newText.substring(0, start) + change.text + newText.substring(end);
			drift += change.text.length - change.rangeLength;
		}
		for (const cs of this.changeSets) {
			let replay = cs.before, rd = 0;
			for (const change of changes) {
				const start = change.rangeOffset + rd;
				const end = start + change.rangeLength;
				replay = replay.substring(0, start) + change.text + replay.substring(end);
				rd += change.text.length - change.rangeLength;
			}
			if (replay === cs.after) {return false;}
		}
		this.text = newText;
		return true;
	}
}

export function wireAwareness(a1: awarenessProtocol.Awareness, a2: awarenessProtocol.Awareness): () => void {
	const h1 = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
		const changed = added.concat(updated, removed);
		const encoded = awarenessProtocol.encodeAwarenessUpdate(a1, changed);
		awarenessProtocol.applyAwarenessUpdate(a2, encoded, 'remote');
	};
	const h2 = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
		const changed = added.concat(updated, removed);
		const encoded = awarenessProtocol.encodeAwarenessUpdate(a2, changed);
		awarenessProtocol.applyAwarenessUpdate(a1, encoded, 'remote');
	};
	a1.on('update', h1);
	a2.on('update', h2);
	return () => { a1.off('update', h1); a2.off('update', h2); };
}

export { Y, syncProtocol, awarenessProtocol, encoding, decoding };
