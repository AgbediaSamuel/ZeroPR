// Go agent edge case tests — malformed input, race conditions, concurrent sessions

import { assert, sleep, connectWs, createSession, printResults, AGENT } from './helpers';

async function testStopWithoutStart(): Promise<void> {
	console.log('\nStop broadcast without start (nil cancel check)');
	let crashed = false;
	try {
		const res = await fetch(`${AGENT}/api/broadcast/stop`, { method: 'POST' });
		crashed = false;
	} catch {
		crashed = true;
	}
	const health = await fetch(`${AGENT}/api`);
	assert(health.ok, 'agent still alive after stop without start');
	assert(!crashed, 'no crash on stop without start');
}

async function testDoubleEnd(): Promise<void> {
	console.log('\nDouble endSession on same session');
	const session = await createSession();

	const res1 = await fetch(`${AGENT}/api/session/end`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ host: 'test', role: 'Host', id: session.id })
	});
	assert(res1.ok, 'first end succeeds');

	const res2 = await fetch(`${AGENT}/api/session/end`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ host: 'test', role: 'Host', id: session.id })
	});
	assert(res2.ok, 'second end does not crash');

	const health = await fetch(`${AGENT}/api`);
	assert(health.ok, 'agent healthy after double end');
}

async function testMalformedJson(): Promise<void> {
	console.log('\nMalformed JSON to HTTP endpoints');
	const endpoints = [
		'/api/session/create',
		'/api/session/join',
		'/api/session/leave',
		'/api/session/end',
	];

	for (const ep of endpoints) {
		await fetch(`${AGENT}${ep}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: 'NOT VALID JSON {{{}'
		});
	}

	const health = await fetch(`${AGENT}/api`);
	assert(health.ok, 'agent survives all malformed JSON requests');
}

async function testJoinNonexistent(): Promise<void> {
	console.log('\nJoin nonexistent session');
	const res = await fetch(`${AGENT}/api/session/join`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ id: 'does-not-exist', host: 'h', guest: 'g', filepath: 'x', created_at: 'now' })
	});
	assert(res.ok, 'join nonexistent does not crash');

	const health = await fetch(`${AGENT}/api`);
	assert(health.ok, 'agent healthy after join nonexistent');
}

async function testConcurrentSessions(): Promise<void> {
	console.log('\nMultiple concurrent sessions');
	const s1 = await createSession();
	const s2 = await createSession();
	const s3 = await createSession();

	assert(s1.id !== s2.id, 'session 1 and 2 have different IDs');
	assert(s2.id !== s3.id, 'session 2 and 3 have different IDs');

	const h1ws = await connectWs(`ws://localhost:9080/ws/session/${s1.id}`);
	h1ws.send(JSON.stringify({ id: s1.id, role: 'Host', host: 'h1' }));
	const g1ws = await connectWs(`ws://localhost:9080/ws/session/${s1.id}`);
	g1ws.send(JSON.stringify({ id: s1.id, role: 'Guest', host: 'g1' }));

	const h2ws = await connectWs(`ws://localhost:9080/ws/session/${s2.id}`);
	h2ws.send(JSON.stringify({ id: s2.id, role: 'Host', host: 'h2' }));
	const g2ws = await connectWs(`ws://localhost:9080/ws/session/${s2.id}`);
	g2ws.send(JSON.stringify({ id: s2.id, role: 'Guest', host: 'g2' }));

	await sleep(500);

	let s1received = false;
	let s2received = false;

	g1ws.onmessage = () => { s1received = true; };
	g2ws.onmessage = () => { s2received = true; };

	h1ws.send(new Uint8Array([1, 2, 3, 4]));
	await sleep(300);

	assert(s1received, 'session 1 guest received message');
	assert(!s2received, 'session 2 guest did NOT receive session 1 message');

	h1ws.close(); g1ws.close(); h2ws.close(); g2ws.close();

	const res = await fetch(`${AGENT}/api/sessions`);
	const sessions: Array<{ id: string }> = await res.json();
	const ids = sessions.map(s => s.id);
	assert(ids.includes(s1.id), 'session 1 in list');
	assert(ids.includes(s2.id), 'session 2 in list');
	assert(ids.includes(s3.id), 'session 3 in list (no WS, still exists)');
	console.log(`  ${sessions.length} active sessions`);
}

async function testEndDuringRelay(): Promise<void> {
	console.log('\nEnd session during active relay');
	const session = await createSession();

	const hws = await connectWs(`ws://localhost:9080/ws/session/${session.id}`);
	hws.send(JSON.stringify({ id: session.id, role: 'Host', host: 'h' }));
	const gws = await connectWs(`ws://localhost:9080/ws/session/${session.id}`);
	gws.send(JSON.stringify({ id: session.id, role: 'Guest', host: 'g' }));
	await sleep(500);

	let sending = true;
	const sendLoop = (async () => {
		while (sending) {
			try { hws.send(new Uint8Array([0, 1, 2, 3])); } catch { break; }
			await sleep(10);
		}
	})();

	await sleep(100);
	const res = await fetch(`${AGENT}/api/session/end`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ host: 'test', role: 'Host', id: session.id })
	});
	sending = false;
	await sendLoop;

	assert(res.ok, 'endSession returned OK');

	const health = await fetch(`${AGENT}/api`);
	assert(health.ok, 'agent alive after end during relay');

	hws.close(); gws.close();
}

async function testBinaryHandshake(): Promise<void> {
	console.log('\nBinary (non-JSON) as first WS message');
	const session = await createSession();

	const ws = await connectWs(`ws://localhost:9080/ws/session/${session.id}`);
	ws.send(new Uint8Array([0, 1, 2, 3, 4, 5]));
	await sleep(500);
	ws.close();

	const health = await fetch(`${AGENT}/api`);
	assert(health.ok, 'agent survives binary handshake');
}

async function testEmptyBody(): Promise<void> {
	console.log('\nEmpty body to POST endpoints');
	const endpoints = ['/api/session/create', '/api/session/join', '/api/session/leave', '/api/session/end'];

	for (const ep of endpoints) {
		try { await fetch(`${AGENT}${ep}`, { method: 'POST' }); } catch {}
	}

	const health = await fetch(`${AGENT}/api`);
	assert(health.ok, 'agent survives empty bodies');
}

async function testEmptySessions(): Promise<void> {
	console.log('\nSessions endpoint with no sessions');
	const res = await fetch(`${AGENT}/api/sessions`);
	const data: unknown[] | null = await res.json();
	assert(Array.isArray(data), 'sessions returns an array');
	console.log(`  sessions: ${data ? data.length : 'null'}`);
}

async function testPeersEndpoint(): Promise<void> {
	console.log('\nPeers endpoint');
	const res = await fetch(`${AGENT}/api/peers`);
	const data: unknown[] | null = await res.json();
	assert(Array.isArray(data) || data === null, 'peers returns array or null');
	console.log(`  peers: ${data ? data.length : 'null'}`);
}

async function testMessageOrdering(): Promise<void> {
	console.log('\nRelay preserves message order');
	const session = await createSession();

	const hws = await connectWs(`ws://localhost:9080/ws/session/${session.id}`);
	hws.send(JSON.stringify({ id: session.id, role: 'Host', host: 'h' }));
	const gws = await connectWs(`ws://localhost:9080/ws/session/${session.id}`);
	gws.send(JSON.stringify({ id: session.id, role: 'Guest', host: 'g' }));
	await sleep(500);

	const received: number[] = [];
	gws.onmessage = (event: MessageEvent) => {
		const data = new Uint8Array(event.data);
		received.push(data[0]);
	};

	for (let i = 0; i < 50; i++) {
		hws.send(new Uint8Array([i]));
	}
	await sleep(1000);

	assert(received.length === 50, `received ${received.length}/50 messages`);
	let inOrder = true;
	for (let i = 0; i < received.length; i++) {
		if (received[i] !== i) { inOrder = false; break; }
	}
	assert(inOrder, 'messages received in order');
	console.log(`  received: ${received.length}, in order: ${inOrder}`);

	hws.close(); gws.close();
}

async function testCreateEndRace(): Promise<void> {
	console.log('\nConcurrent create and end');
	const promises: Promise<void>[] = [];
	for (let i = 0; i < 10; i++) {
		promises.push((async () => {
			const s = await createSession();
			await fetch(`${AGENT}/api/session/end`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ host: 'test', role: 'Host', id: s.id })
			});
		})());
	}
	await Promise.all(promises);

	const health = await fetch(`${AGENT}/api`);
	assert(health.ok, 'agent survives 10 concurrent create+end');
}

async function testOneSidedConnection(): Promise<void> {
	console.log('\nOne-sided connection (host only, then end)');
	const session = await createSession();

	const hws = await connectWs(`ws://localhost:9080/ws/session/${session.id}`);
	hws.send(JSON.stringify({ id: session.id, role: 'Host', host: 'h' }));
	await sleep(300);

	const res = await fetch(`${AGENT}/api/session/end`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ host: 'test', role: 'Host', id: session.id })
	});
	assert(res.ok, 'end one-sided session OK');
	await sleep(500);

	hws.close();

	const health = await fetch(`${AGENT}/api`);
	assert(health.ok, 'agent alive after one-sided end');
}

async function main(): Promise<void> {
	console.log('ZeroPR Agent Edge Case Tests');

	await testStopWithoutStart();
	await testDoubleEnd();
	await testMalformedJson();
	await testJoinNonexistent();
	await testConcurrentSessions();
	await testEndDuringRelay();
	await testBinaryHandshake();
	await testEmptyBody();
	await testEmptySessions();
	await testPeersEndpoint();
	await testMessageOrdering();
	await testCreateEndRace();
	await testOneSidedConnection();

	printResults('Agent');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
