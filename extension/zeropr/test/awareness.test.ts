// Awareness / cursor presence tests
import { assert, sleep, printResults, wireAwareness, createProviderWithAwareness, connectWs, AGENT, Y, awarenessProtocol } from './helpers';

function testBasicPropagation(): void {
	console.log('\nAwareness: basic cursor propagation');
	const doc1 = new Y.Doc();
	const doc2 = new Y.Doc();
	const a1 = new awarenessProtocol.Awareness(doc1);
	const a2 = new awarenessProtocol.Awareness(doc2);
	const unwire = wireAwareness(a1, a2);

	a1.setLocalStateField('cursor', { anchor: 0, head: 5, name: 'Alice' });

	const state = a2.getStates().get(doc1.clientID);
	assert(state !== undefined, 'peer state exists');
	assert(state?.cursor?.anchor === 0, 'anchor is 0');
	assert(state?.cursor?.head === 5, 'head is 5');
	assert(state?.cursor?.name === 'Alice', 'name is Alice');

	unwire();
	doc1.destroy(); doc2.destroy();
}

function testUpdateOverwrite(): void {
	console.log('\nAwareness: update overwrites previous');
	const doc1 = new Y.Doc();
	const doc2 = new Y.Doc();
	const a1 = new awarenessProtocol.Awareness(doc1);
	const a2 = new awarenessProtocol.Awareness(doc2);
	const unwire = wireAwareness(a1, a2);

	a1.setLocalStateField('cursor', { anchor: 0, head: 0, name: 'Alice' });
	a1.setLocalStateField('cursor', { anchor: 10, head: 20, name: 'Alice' });

	const state = a2.getStates().get(doc1.clientID);
	assert(state?.cursor?.anchor === 10, 'anchor updated to 10');
	assert(state?.cursor?.head === 20, 'head updated to 20');

	unwire();
	doc1.destroy(); doc2.destroy();
}

function testThreePeers(): void {
	console.log('\nAwareness: three peers');
	const doc1 = new Y.Doc();
	const doc2 = new Y.Doc();
	const doc3 = new Y.Doc();
	const a1 = new awarenessProtocol.Awareness(doc1);
	const a2 = new awarenessProtocol.Awareness(doc2);
	const a3 = new awarenessProtocol.Awareness(doc3);

	const u12 = wireAwareness(a1, a2);
	const u13 = wireAwareness(a1, a3);
	const u23 = wireAwareness(a2, a3);

	a1.setLocalStateField('cursor', { anchor: 0, head: 0, name: 'Alice' });
	a2.setLocalStateField('cursor', { anchor: 5, head: 5, name: 'Bob' });
	a3.setLocalStateField('cursor', { anchor: 10, head: 10, name: 'Carol' });

	const a1States = a1.getStates();
	assert(a1States.get(doc2.clientID)?.cursor?.name === 'Bob', 'a1 sees Bob');
	assert(a1States.get(doc3.clientID)?.cursor?.name === 'Carol', 'a1 sees Carol');

	const a2States = a2.getStates();
	assert(a2States.get(doc1.clientID)?.cursor?.name === 'Alice', 'a2 sees Alice');
	assert(a2States.get(doc3.clientID)?.cursor?.name === 'Carol', 'a2 sees Carol');

	const a3States = a3.getStates();
	assert(a3States.get(doc1.clientID)?.cursor?.name === 'Alice', 'a3 sees Alice');
	assert(a3States.get(doc2.clientID)?.cursor?.name === 'Bob', 'a3 sees Bob');

	u12(); u13(); u23();
	doc1.destroy(); doc2.destroy(); doc3.destroy();
}

function testDisconnectCleanup(): void {
	console.log('\nAwareness: disconnect cleanup');
	const doc1 = new Y.Doc();
	const doc2 = new Y.Doc();
	const a1 = new awarenessProtocol.Awareness(doc1);
	const a2 = new awarenessProtocol.Awareness(doc2);
	const unwire = wireAwareness(a1, a2);

	a1.setLocalStateField('cursor', { anchor: 0, head: 5, name: 'Alice' });
	assert(a2.getStates().get(doc1.clientID) !== undefined, 'peer visible before disconnect');

	awarenessProtocol.removeAwarenessStates(a1, [doc1.clientID], null);

	const stateAfter = a2.getStates().get(doc1.clientID);
	assert(stateAfter === undefined || stateAfter === null, 'peer removed after disconnect');

	unwire();
	doc1.destroy(); doc2.destroy();
}

function testRapidUpdates(): void {
	console.log('\nAwareness: rapid 50 updates');
	const doc1 = new Y.Doc();
	const doc2 = new Y.Doc();
	const a1 = new awarenessProtocol.Awareness(doc1);
	const a2 = new awarenessProtocol.Awareness(doc2);
	const unwire = wireAwareness(a1, a2);

	for (let i = 0; i < 50; i++) {
		a1.setLocalStateField('cursor', { anchor: i, head: i, name: 'Alice' });
	}

	const state = a2.getStates().get(doc1.clientID);
	assert(state?.cursor?.anchor === 49, `final anchor is 49, got ${state?.cursor?.anchor}`);
	assert(state?.cursor?.head === 49, `final head is 49, got ${state?.cursor?.head}`);

	unwire();
	doc1.destroy(); doc2.destroy();
}

function testFieldCoexistence(): void {
	console.log('\nAwareness: user + cursor coexist');
	const doc1 = new Y.Doc();
	const doc2 = new Y.Doc();
	const a1 = new awarenessProtocol.Awareness(doc1);
	const a2 = new awarenessProtocol.Awareness(doc2);
	const unwire = wireAwareness(a1, a2);

	a1.setLocalStateField('user', { name: 'Alice' });
	a1.setLocalStateField('cursor', { anchor: 0, head: 10, name: 'Alice' });

	let state = a2.getStates().get(doc1.clientID);
	assert(state?.user?.name === 'Alice', 'user.name present');
	assert(state?.cursor?.anchor === 0, 'cursor.anchor present');

	a1.setLocalStateField('cursor', { anchor: 5, head: 15, name: 'Alice' });
	state = a2.getStates().get(doc1.clientID);
	assert(state?.user?.name === 'Alice', 'user.name still present after cursor update');
	assert(state?.cursor?.anchor === 5, 'cursor updated');

	unwire();
	doc1.destroy(); doc2.destroy();
}

function testLocalExclusion(): void {
	console.log('\nAwareness: local state excluded');
	const doc1 = new Y.Doc();
	const doc2 = new Y.Doc();
	const a1 = new awarenessProtocol.Awareness(doc1);
	const a2 = new awarenessProtocol.Awareness(doc2);
	const unwire = wireAwareness(a1, a2);

	a1.setLocalStateField('cursor', { anchor: 0, head: 5, name: 'Alice' });
	a2.setLocalStateField('cursor', { anchor: 10, head: 15, name: 'Bob' });

	let remoteCount = 0;
	for (const [clientID] of a1.getStates()) {
		if (clientID !== doc1.clientID) {remoteCount++;}
	}
	assert(remoteCount === 1, `a1 sees 1 remote peer, got ${remoteCount}`);

	remoteCount = 0;
	for (const [clientID] of a2.getStates()) {
		if (clientID !== doc2.clientID) {remoteCount++;}
	}
	assert(remoteCount === 1, `a2 sees 1 remote peer, got ${remoteCount}`);

	unwire();
	doc1.destroy(); doc2.destroy();
}

function testOriginGuard(): void {
	console.log('\nAwareness: origin guard prevents echo');
	const doc1 = new Y.Doc();
	const a1 = new awarenessProtocol.Awareness(doc1);

	let updateCount = 0;
	a1.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: string) => {
		if (origin !== 'remote') {updateCount++;}
	});

	a1.setLocalStateField('cursor', { anchor: 0, head: 0, name: 'Alice' });
	const localUpdates = updateCount;

	const encoded = awarenessProtocol.encodeAwarenessUpdate(a1, [doc1.clientID]);
	updateCount = 0;
	awarenessProtocol.applyAwarenessUpdate(a1, encoded, 'remote');
	const remoteUpdates = updateCount;

	assert(localUpdates >= 1, `local set triggered update: ${localUpdates}`);
	assert(remoteUpdates === 0, `remote apply did NOT trigger broadcast: ${remoteUpdates}`);

	doc1.destroy();
}

function testSelectionTypes(): void {
	console.log('\nAwareness: collapsed vs expanded selection');
	const doc1 = new Y.Doc();
	const doc2 = new Y.Doc();
	const a1 = new awarenessProtocol.Awareness(doc1);
	const a2 = new awarenessProtocol.Awareness(doc2);
	const unwire = wireAwareness(a1, a2);

	a1.setLocalStateField('cursor', { anchor: 7, head: 7, name: 'Alice' });
	let state = a2.getStates().get(doc1.clientID);
	assert(state?.cursor?.anchor === state?.cursor?.head, 'collapsed: anchor === head');
	assert(state?.cursor?.anchor === 7, 'collapsed at 7');

	a1.setLocalStateField('cursor', { anchor: 7, head: 42, name: 'Alice' });
	state = a2.getStates().get(doc1.clientID);
	assert(state?.cursor?.anchor === 7, 'forward: anchor 7');
	assert(state?.cursor?.head === 42, 'forward: head 42');
	assert(state?.cursor?.anchor !== state?.cursor?.head, 'forward: not collapsed');

	a1.setLocalStateField('cursor', { anchor: 42, head: 7, name: 'Alice' });
	state = a2.getStates().get(doc1.clientID);
	assert(state?.cursor?.anchor === 42, 'reverse: anchor 42');
	assert(state?.cursor?.head === 7, 'reverse: head 7');

	unwire();
	doc1.destroy(); doc2.destroy();
}

function testLateJoiner(): void {
	console.log('\nAwareness: late joiner');
	const doc1 = new Y.Doc();
	const a1 = new awarenessProtocol.Awareness(doc1);

	a1.setLocalStateField('cursor', { anchor: 0, head: 5, name: 'Alice' });
	a1.setLocalStateField('user', { name: 'Alice' });

	const doc2 = new Y.Doc();
	const a2 = new awarenessProtocol.Awareness(doc2);

	const fullState = awarenessProtocol.encodeAwarenessUpdate(a1, Array.from(a1.getStates().keys()));
	awarenessProtocol.applyAwarenessUpdate(a2, fullState, 'sync');

	const state = a2.getStates().get(doc1.clientID);
	assert(state?.cursor?.anchor === 0, 'late joiner sees anchor');
	assert(state?.cursor?.head === 5, 'late joiner sees head');
	assert(state?.user?.name === 'Alice', 'late joiner sees user name');

	doc1.destroy(); doc2.destroy();
}

async function testAwarenessViaRelay(): Promise<void> {
	console.log('\nAwareness: end-to-end via WebSocket relay');

	const res = await fetch(`${AGENT}/api/session/create`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ host: 'test', role: 'Host', filepath: 'test.go' })
	});
	const session = await res.json();

	const hostDoc = new Y.Doc();
	const hostWs = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Host', host: 'h' });
	const hostProvider = createProviderWithAwareness(hostDoc, hostWs);

	const guestDoc = new Y.Doc();
	const guestWs = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Guest', host: 'g' });
	const guestProvider = createProviderWithAwareness(guestDoc, guestWs);

	await sleep(500);

	hostProvider.awareness.setLocalStateField('cursor', { anchor: 0, head: 10, name: 'Host' });
	hostProvider.awareness.setLocalStateField('user', { name: 'HostMachine' });
	await sleep(500);

	const guestSeesHost = guestProvider.awareness.getStates().get(hostDoc.clientID);
	assert(guestSeesHost?.cursor?.anchor === 0, 'guest sees host cursor anchor');
	assert(guestSeesHost?.cursor?.head === 10, 'guest sees host cursor head');
	assert(guestSeesHost?.user?.name === 'HostMachine', 'guest sees host name');

	guestProvider.awareness.setLocalStateField('cursor', { anchor: 20, head: 30, name: 'Guest' });
	await sleep(500);

	const hostSeesGuest = hostProvider.awareness.getStates().get(guestDoc.clientID);
	assert(hostSeesGuest?.cursor?.anchor === 20, 'host sees guest cursor anchor');
	assert(hostSeesGuest?.cursor?.head === 30, 'host sees guest cursor head');

	hostProvider.awareness.setLocalStateField('cursor', { anchor: 50, head: 50, name: 'Host' });
	await sleep(500);

	const updatedState = guestProvider.awareness.getStates().get(hostDoc.clientID);
	assert(updatedState?.cursor?.anchor === 50, 'guest sees updated host cursor');

	hostProvider.destroy(); guestProvider.destroy();
	hostWs.close(); guestWs.close();
	hostDoc.destroy(); guestDoc.destroy();
}

async function main(): Promise<void> {
	console.log('  ZeroPR Awareness / Cursor Tests\n');

	testBasicPropagation();
	testUpdateOverwrite();
	testThreePeers();
	testDisconnectCleanup();
	testRapidUpdates();
	testFieldCoexistence();
	testLocalExclusion();
	testOriginGuard();
	testSelectionTypes();
	testLateJoiner();

	await testAwarenessViaRelay();

	printResults('awareness');
}

main().catch((err: Error) => { console.error('FATAL:', err); process.exit(1); });
