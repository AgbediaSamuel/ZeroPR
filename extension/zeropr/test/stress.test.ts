// Stress & edge-case tests
import { assert, sleep, createProvider, connectWs, createSession, setupPeer, cleanup, printResults, Y, AGENT } from './helpers';

async function testSustainedLoad(): Promise<void> {
	console.log('\nSustained 5-second bidirectional editing');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', '');
	const guest = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(500);

	const start = Date.now();
	let hostOps = 0, guestOps = 0;

	while (Date.now() - start < 5000) {
		const hPos = Math.floor(Math.random() * (host.text.length + 1));
		host.doc.transact(() => host.text.insert(hPos, 'H'), 'local');
		hostOps++;

		const gPos = Math.floor(Math.random() * (guest.text.length + 1));
		guest.doc.transact(() => guest.text.insert(gPos, 'G'), 'local');
		guestOps++;

		await sleep(10);
	}

	await sleep(2000);

	const match = host.text.toString() === guest.text.toString();
	assert(match, `convergence after sustained load (${hostOps}+${guestOps} ops)`);
	assert(host.text.length === guest.text.length, `same length: host=${host.text.length} guest=${guest.text.length}`);

	const hostHs = (host.text.toString().match(/H/g) || []).length;
	const hostGs = (host.text.toString().match(/G/g) || []).length;
	assert(hostHs === hostOps, `all host ops present: ${hostHs}/${hostOps}`);
	assert(hostGs === guestOps, `all guest ops present: ${hostGs}/${guestOps}`);

	console.log(`  ${hostOps} host ops + ${guestOps} guest ops = ${host.text.length} chars, match=${match}`);
	console.log(`  duration: ${Date.now() - start}ms`);

	cleanup(host, guest);
}

async function testThreeWayLifecycle(): Promise<void> {
	console.log('\nThree-way lifecycle: type, disconnect, type, reconnect, type');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', 'AAAA');
	const guest1 = await setupPeer(session.id, 'Guest', 'g1', null);
	await sleep(500);

	host.doc.transact(() => host.text.insert(2, 'BB'), 'local');
	await sleep(200);
	guest1.doc.transact(() => guest1.text.insert(4, 'CC'), 'local');
	await sleep(200);
	const phase1 = host.text.toString();
	assert(host.text.toString() === guest1.text.toString(), `phase 1 sync: "${phase1}"`);

	guest1.provider.destroy();
	guest1.ws.close();
	await sleep(300);

	host.doc.transact(() => host.text.insert(0, 'DD'), 'local');
	await sleep(200);

	host.provider.destroy();
	host.ws.close();
	const hostWs2 = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Host', host: 'h' });
	host.ws = hostWs2;
	host.provider = createProvider(host.doc, hostWs2);
	await sleep(300);

	const guest2 = await setupPeer(session.id, 'Guest', 'g2', null);
	await sleep(1000);

	assert(guest2.text.toString().includes('DD'), 'guest2 has content typed during disconnect');
	assert(host.text.toString() === guest2.text.toString(), `phase 3 sync: "${host.text.toString()}"`);

	host.doc.transact(() => host.text.insert(host.text.length, '_END_H'), 'local');
	guest2.doc.transact(() => guest2.text.insert(0, 'START_G_'), 'local');
	await sleep(500);

	assert(host.text.toString() === guest2.text.toString(), 'phase 4 convergence');
	console.log(`  final: "${host.text.toString()}"`);

	cleanup(host, guest2);
}

async function testAsymmetricFlood(): Promise<void> {
	console.log('\nAsymmetric flood: 500 chars one side, then swap');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', '');
	const guest = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(500);

	for (let i = 0; i < 500; i++) {
		host.doc.transact(() => host.text.insert(host.text.length, 'H'), 'local');
	}
	await sleep(2000);
	assert(guest.text.length === 500, `guest has 500 after host flood: ${guest.text.length}`);
	assert(host.text.toString() === guest.text.toString(), 'match after host flood');

	for (let i = 0; i < 500; i++) {
		guest.doc.transact(() => guest.text.insert(guest.text.length, 'G'), 'local');
	}
	await sleep(2000);
	assert(host.text.length === 1000, `host has 1000 after guest flood: ${host.text.length}`);
	assert(host.text.toString() === guest.text.toString(), 'match after guest flood');

	host.doc.transact(() => host.text.delete(0, 250), 'local');
	guest.doc.transact(() => guest.text.delete(0, 250), 'local');
	await sleep(1000);
	assert(host.text.toString() === guest.text.toString(), 'convergence after concurrent same-range delete');
	console.log(`  final length: ${host.text.length} match=${host.text.toString() === guest.text.toString()}`);

	cleanup(host, guest);
}

async function testProtocolLikeContent(): Promise<void> {
	console.log('\nContent resembling protocol messages');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', '');
	const guest = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(500);

	const payloads: string[] = [
		'{"id":"fake","role":"Host","host":"evil"}',
		'{"type":0,"data":"malicious"}',
		'\x00\x01\x02\x03',
		'\x00'.repeat(100),
		'null',
		'undefined',
		'true',
		'false',
		'[]',
		'{}',
		String.fromCharCode(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13),
		'<script>alert("xss")</script>',
		'DROP TABLE sessions;',
		'\\n\\r\\t\\0',
	];

	for (const payload of payloads) {
		host.doc.transact(() => host.text.insert(host.text.length, payload + '\n'), 'local');
	}
	await sleep(1000);

	assert(host.text.toString() === guest.text.toString(), 'all payloads synced verbatim');
	for (const payload of payloads) {
		assert(guest.text.toString().includes(payload), `guest has "${payload.substring(0, 20)}..."`);
	}
	console.log(`  total length: ${host.text.length}`);

	cleanup(host, guest);
}

async function testRapidConnectDisconnect(): Promise<void> {
	console.log('\nRapid connect/disconnect cycles (20x)');
	const session = await createSession();

	const host = await setupPeer(session.id, 'Host', 'h', 'stable content');
	await sleep(300);

	for (let i = 0; i < 20; i++) {
		const gws = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Guest', host: `g${i}` });
		await sleep(100);
		gws.close();
		await sleep(300);

		host.provider.destroy();
		host.ws.close();
		await sleep(200);
		const newHws = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Host', host: 'h' });
		host.ws = newHws;
		host.provider = createProvider(host.doc, newHws);
		await sleep(200);
	}

	const finalGuest = await setupPeer(session.id, 'Guest', 'gfinal', null);
	await sleep(1000);

	assert(finalGuest.text.toString() === 'stable content', 'final guest has correct content');
	assert(host.text.toString() === finalGuest.text.toString(), 'match after 20 cycles');
	console.log(`  survived 20 connect/disconnect cycles`);

	const health = await fetch(`${AGENT}/api`);
	assert(health.ok, 'agent alive after 20 cycles');

	cleanup(host, finalGuest);
}

async function testBidirectionalRelayStress(): Promise<void> {
	console.log('\nBidirectional relay: 100 messages each way simultaneously');
	const session = await createSession();

	const hws = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Host', host: 'h' });
	const gws = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Guest', host: 'g' });
	await sleep(500);

	let hostReceived = 0, guestReceived = 0;
	hws.onmessage = () => { hostReceived++; };
	gws.onmessage = () => { guestReceived++; };

	for (let i = 0; i < 100; i++) {
		hws.send(new Uint8Array([i, 0]));
		gws.send(new Uint8Array([i, 1]));
	}
	await sleep(2000);

	assert(guestReceived === 100, `guest received ${guestReceived}/100`);
	assert(hostReceived === 100, `host received ${hostReceived}/100`);
	console.log(`  host received: ${hostReceived}, guest received: ${guestReceived}`);

	hws.close(); gws.close();
}

async function testUndoReconnectConcurrent(): Promise<void> {
	console.log('\nUndo + reconnect + concurrent');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', '');
	const undo = new Y.UndoManager(host.text, { trackedOrigins: new Set(['local']), captureTimeout: 0 });

	const guest1 = await setupPeer(session.id, 'Guest', 'g1', null);
	await sleep(500);

	host.doc.transact(() => host.text.insert(0, 'HELLO'), 'local');
	await sleep(200);
	guest1.doc.transact(() => guest1.text.insert(5, ' WORLD'), 'local');
	await sleep(300);

	assert(host.text.toString() === 'HELLO WORLD', 'both typed');

	undo.undo();
	await sleep(300);
	assert(host.text.toString() === ' WORLD', 'undo removed HELLO');
	assert(host.text.toString() === guest1.text.toString(), 'sync after undo');

	guest1.provider.destroy();
	guest1.ws.close();
	await sleep(300);

	host.doc.transact(() => host.text.insert(0, 'HI'), 'local');

	host.provider.destroy();
	host.ws.close();
	const hostWs2 = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Host', host: 'h' });
	host.ws = hostWs2;
	host.provider = createProvider(host.doc, hostWs2);
	await sleep(300);

	const guest2 = await setupPeer(session.id, 'Guest', 'g2', null);
	await sleep(1000);

	assert(host.text.toString() === guest2.text.toString(), 'sync after reconnect');
	assert(host.text.toString() === 'HI WORLD', 'correct content');

	undo.redo();
	await sleep(500);
	assert(host.text.toString() === guest2.text.toString(), 'sync after redo');
	console.log(`  final: "${host.text.toString()}"`);

	cleanup(host, guest2);
}

async function testDoubleDeleteSameRange(): Promise<void> {
	console.log('\nDouble-delete same range (CRDT idempotency)');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', 'ABCDEFGHIJ');
	const guest = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(500);

	host.doc.transact(() => host.text.delete(3, 3), 'local');
	guest.doc.transact(() => guest.text.delete(3, 3), 'local');
	await sleep(500);

	assert(host.text.toString() === guest.text.toString(), 'convergence after double-delete');
	assert(host.text.length <= 7, `length <= 7 (got ${host.text.length})`);
	console.log(`  result: "${host.text.toString()}" (length ${host.text.length})`);

	cleanup(host, guest);
}

async function testSessionChurn(): Promise<void> {
	console.log('\nSession churn: create 20 sessions, use them, end them');
	const sessions: Array<{ s: any; host: any; guest: any }> = [];

	for (let i = 0; i < 20; i++) {
		const s = await createSession();
		const host = await setupPeer(s.id, 'Host', `h${i}`, `content_${i}`);
		const guest = await setupPeer(s.id, 'Guest', `g${i}`, null);
		sessions.push({ s, host, guest });
	}

	await sleep(2000);

	let allMatch = true;
	for (const { host, guest } of sessions) {
		if (host.text.toString() !== guest.text.toString()) {allMatch = false;}
	}
	assert(allMatch, 'all 20 sessions synced');

	for (const { s, host, guest } of sessions) {
		cleanup(host, guest);
		await fetch(`${AGENT}/api/session/end`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ host: 'test', role: 'Host', id: s.id })
		});
	}

	await sleep(500);
	const health = await fetch(`${AGENT}/api`);
	assert(health.ok, 'agent healthy after 20 session churn');
	console.log(`  created, synced, and cleaned up 20 sessions`);
}

async function main(): Promise<void> {
	console.log('  ZeroPR Final Stress & Edge Tests\n');

	await testSustainedLoad();
	await testThreeWayLifecycle();
	await testAsymmetricFlood();
	await testProtocolLikeContent();
	await testRapidConnectDisconnect();
	await testBidirectionalRelayStress();
	await testUndoReconnectConcurrent();
	await testDoubleDeleteSameRange();
	await testSessionChurn();

	printResults('stress');
}

main().catch((err: Error) => { console.error('FATAL:', err); process.exit(1); });
