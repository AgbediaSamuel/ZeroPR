// Sync stress tests — host + guest via WebSocket to the Go agent

import { assert, sleep, createProvider, connectWs, createSession, setupPeer, cleanup, printResults, Y, MSG_SYNC } from './helpers';

async function testInitialSync(): Promise<void> {
	console.log('\nInitial sync');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h1', 'hello world');
	const guest = await setupPeer(session.id, 'Guest', 'g1', null);
	await sleep(500);

	assert(guest.text.toString() === 'hello world', 'guest should receive host content');
	assert(host.text.toString() === guest.text.toString(), 'both should match');
	console.log(`  host="${host.text.toString()}" guest="${guest.text.toString()}"`);

	cleanup(host, guest);
}

async function testBidirectional(): Promise<void> {
	console.log('\nBidirectional edits');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h2', 'base');
	const guest = await setupPeer(session.id, 'Guest', 'g2', null);
	await sleep(500);

	host.doc.transact(() => host.text.insert(4, '_host'), 'local');
	await sleep(300);
	assert(guest.text.toString() === 'base_host', 'guest sees host edit');

	guest.doc.transact(() => guest.text.insert(9, '_guest'), 'local');
	await sleep(300);
	assert(host.text.toString() === 'base_host_guest', 'host sees guest edit');
	assert(host.text.toString() === guest.text.toString(), 'both match');
	console.log(`  result="${host.text.toString()}"`);

	cleanup(host, guest);
}

async function testRapidEdits(): Promise<void> {
	console.log('\nRapid sequential edits (100 chars)');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h3', '');
	const guest = await setupPeer(session.id, 'Guest', 'g3', null);
	await sleep(500);

	const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz0123456789abcd';
	const target = chars.substring(0, 100);

	for (let i = 0; i < 100; i++) {
		host.doc.transact(() => host.text.insert(i, target[i]), 'local');
	}
	await sleep(1000);

	assert(host.text.toString() === target, 'host has correct text');
	assert(guest.text.toString() === target, 'guest received all 100 chars');
	assert(host.text.toString() === guest.text.toString(), 'both match after rapid edits');
	console.log(`  host len=${host.text.length} guest len=${guest.text.length} match=${host.text.toString() === guest.text.toString()}`);

	cleanup(host, guest);
}

async function testConcurrentTyping(): Promise<void> {
	console.log('\nConcurrent typing (50 chars each side)');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h4', '');
	const guest = await setupPeer(session.id, 'Guest', 'g4', null);
	await sleep(500);

	for (let i = 0; i < 50; i++) {
		host.doc.transact(() => host.text.insert(host.text.length, 'H'), 'local');
		guest.doc.transact(() => guest.text.insert(0, 'G'), 'local');
	}
	await sleep(1500);

	assert(host.text.length === 100, `both sides should have 100 chars, host has ${host.text.length}`);
	assert(host.text.toString() === guest.text.toString(), 'CRDT convergence after concurrent edits');
	console.log(`  host len=${host.text.length} guest len=${guest.text.length} match=${host.text.toString() === guest.text.toString()}`);
	console.log(`  host first 20: "${host.text.toString().substring(0, 20)}"`);
	console.log(`  guest first 20: "${guest.text.toString().substring(0, 20)}"`);

	cleanup(host, guest);
}

async function testLargeDoc(): Promise<void> {
	console.log('\nLarge document sync (10KB)');
	const largeContent = Array(200).fill('Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n').join('');
	console.log(`  content size: ${largeContent.length} chars`);

	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h5', largeContent);
	const guest = await setupPeer(session.id, 'Guest', 'g5', null);
	await sleep(1000);

	assert(guest.text.toString() === largeContent, 'guest received full 10KB doc');
	assert(guest.text.length === largeContent.length, `guest length ${guest.text.length} === ${largeContent.length}`);
	console.log(`  host len=${host.text.length} guest len=${guest.text.length} match=${host.text.toString() === guest.text.toString()}`);

	cleanup(host, guest);
}

async function testDeletes(): Promise<void> {
	console.log('\nDelete operations');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h6', 'abcdefghij');
	const guest = await setupPeer(session.id, 'Guest', 'g6', null);
	await sleep(500);

	host.doc.transact(() => host.text.delete(3, 4), 'local');
	await sleep(300);
	assert(host.text.toString() === 'abchij', 'host after delete');
	assert(guest.text.toString() === 'abchij', 'guest after host delete');

	guest.doc.transact(() => guest.text.delete(4, 2), 'local');
	await sleep(300);
	assert(host.text.toString() === 'abch', 'host after guest delete');
	assert(guest.text.toString() === 'abch', 'guest after own delete');

	host.doc.transact(() => host.text.delete(0, host.text.length), 'local');
	await sleep(300);
	assert(host.text.toString() === '', 'host empty after full delete');
	assert(guest.text.toString() === '', 'guest empty after full delete');
	console.log(`  final: host="${host.text.toString()}" guest="${guest.text.toString()}"`);

	cleanup(host, guest);
}

async function testInterleavedOps(): Promise<void> {
	console.log('\nInterleaved insert + delete');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h7', 'the quick brown fox');
	const guest = await setupPeer(session.id, 'Guest', 'g7', null);
	await sleep(500);

	host.doc.transact(() => {
		host.text.delete(4, 5);
		host.text.insert(4, 'slow');
	}, 'local');
	await sleep(300);
	assert(host.text.toString() === 'the slow brown fox', 'host after replace');
	assert(guest.text.toString() === 'the slow brown fox', 'guest after host replace');

	guest.doc.transact(() => {
		guest.text.delete(9, 5);
		guest.text.insert(9, 'red');
	}, 'local');
	await sleep(300);
	assert(host.text.toString() === 'the slow red fox', 'host after guest replace');
	assert(guest.text.toString() === 'the slow red fox', 'guest after own replace');

	host.doc.transact(() => {
		host.text.delete(0, 3);
		host.text.insert(0, 'a');
	}, 'local');
	guest.doc.transact(() => {
		guest.text.delete(guest.text.length - 3, 3);
		guest.text.insert(guest.text.length, 'cat');
	}, 'local');
	await sleep(500);
	assert(host.text.toString() === guest.text.toString(), 'convergence after concurrent replace');
	console.log(`  final: "${host.text.toString()}"`);

	cleanup(host, guest);
}

async function testUndoManager(): Promise<void> {
	console.log('\nUndo manager');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h8', 'base');
	const guest = await setupPeer(session.id, 'Guest', 'g8', null);
	await sleep(500);

	const hostUndo = new Y.UndoManager(host.text, { trackedOrigins: new Set(['local']) });
	const guestUndo = new Y.UndoManager(guest.text, { trackedOrigins: new Set(['local']) });

	host.doc.transact(() => host.text.insert(4, '_HOST'), 'local');
	await sleep(300);
	guest.doc.transact(() => guest.text.insert(guest.text.length, '_GUEST'), 'local');
	await sleep(300);
	console.log(`  after both type: "${host.text.toString()}"`);
	assert(host.text.toString() === guest.text.toString(), 'both match');

	hostUndo.undo();
	await sleep(300);
	assert(!host.text.toString().includes('_HOST'), 'host undo removed _HOST');
	assert(host.text.toString().includes('_GUEST'), 'host undo kept _GUEST');
	assert(host.text.toString() === guest.text.toString(), 'both match after host undo');
	console.log(`  after host undo: "${host.text.toString()}"`);

	hostUndo.redo();
	await sleep(300);
	assert(host.text.toString().includes('_HOST'), 'host redo restored _HOST');
	assert(host.text.toString() === guest.text.toString(), 'both match after host redo');
	console.log(`  after host redo: "${host.text.toString()}"`);

	guestUndo.undo();
	await sleep(300);
	assert(!guest.text.toString().includes('_GUEST'), 'guest undo removed _GUEST');
	assert(guest.text.toString().includes('_HOST'), 'guest undo kept _HOST');
	assert(host.text.toString() === guest.text.toString(), 'both match after guest undo');
	console.log(`  after guest undo: "${host.text.toString()}"`);

	cleanup(host, guest);
}

async function testStressConcurrent(): Promise<void> {
	console.log('\nStress test — 200 concurrent ops each side');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h9', '');
	const guest = await setupPeer(session.id, 'Guest', 'g9', null);
	await sleep(500);

	for (let i = 0; i < 200; i++) {
		host.doc.transact(() => host.text.insert(host.text.length, 'H'), 'local');
		guest.doc.transact(() => guest.text.insert(guest.text.length, 'G'), 'local');
	}

	await sleep(3000);

	assert(host.text.length === 400, `host should have 400 chars, has ${host.text.length}`);
	assert(guest.text.length === 400, `guest should have 400 chars, has ${guest.text.length}`);
	assert(host.text.toString() === guest.text.toString(), 'CRDT convergence after 400 concurrent ops');

	const hostHs = (host.text.toString().match(/H/g) || []).length;
	const hostGs = (host.text.toString().match(/G/g) || []).length;
	console.log(`  host: ${hostHs} H's + ${hostGs} G's = ${host.text.length} total`);
	console.log(`  match: ${host.text.toString() === guest.text.toString()}`);

	cleanup(host, guest);
}

async function testLargeDocConcurrent(): Promise<void> {
	console.log('\nLarge doc (5KB) + 50 concurrent random edits');
	const initial = 'function hello() {\n  console.log("hello world");\n}\n'.repeat(100);
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h10', initial);
	const guest = await setupPeer(session.id, 'Guest', 'g10', null);
	await sleep(1500);

	assert(guest.text.toString() === initial, 'guest got full initial doc');

	for (let i = 0; i < 50; i++) {
		const hostPos = Math.floor(Math.random() * host.text.length);
		const guestPos = Math.floor(Math.random() * guest.text.length);
		host.doc.transact(() => host.text.insert(hostPos, `/*H${i}*/`), 'local');
		guest.doc.transact(() => guest.text.insert(guestPos, `/*G${i}*/`), 'local');
	}

	await sleep(3000);

	assert(host.text.toString() === guest.text.toString(), 'convergence after random concurrent inserts on large doc');
	console.log(`  final length: host=${host.text.length} guest=${guest.text.length} match=${host.text.toString() === guest.text.toString()}`);

	cleanup(host, guest);
}

async function testDeleteStress(): Promise<void> {
	console.log('\nConcurrent random deletes');
	const initial = 'A'.repeat(500);
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h11', initial);
	const guest = await setupPeer(session.id, 'Guest', 'g11', null);
	await sleep(500);

	for (let i = 0; i < 30; i++) {
		if (host.text.length > 5) {
			const pos = Math.floor(Math.random() * (host.text.length - 3));
			const len = Math.min(3, host.text.length - pos);
			host.doc.transact(() => host.text.delete(pos, len), 'local');
		}
		if (guest.text.length > 5) {
			const pos = Math.floor(Math.random() * (guest.text.length - 3));
			const len = Math.min(3, guest.text.length - pos);
			guest.doc.transact(() => guest.text.delete(pos, len), 'local');
		}
	}

	await sleep(2000);

	assert(host.text.toString() === guest.text.toString(), 'convergence after concurrent deletes');
	console.log(`  final length: host=${host.text.length} guest=${guest.text.length} match=${host.text.toString() === guest.text.toString()}`);

	cleanup(host, guest);
}

async function testMixedStorm(): Promise<void> {
	console.log('\nMixed insert/delete/replace storm (100 ops each)');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h12', 'START_' + 'x'.repeat(200) + '_END');
	const guest = await setupPeer(session.id, 'Guest', 'g12', null);
	await sleep(500);

	for (let i = 0; i < 100; i++) {
		const op = Math.random();
		if (host.text.length > 10) {
			if (op < 0.4) {
				const pos = Math.floor(Math.random() * host.text.length);
				host.doc.transact(() => host.text.insert(pos, String.fromCharCode(65 + (i % 26))), 'local');
			} else if (op < 0.7) {
				const pos = Math.floor(Math.random() * (host.text.length - 1));
				host.doc.transact(() => host.text.delete(pos, 1), 'local');
			} else {
				const pos = Math.floor(Math.random() * (host.text.length - 1));
				host.doc.transact(() => {
					host.text.delete(pos, 1);
					host.text.insert(pos, String.fromCharCode(97 + (i % 26)));
				}, 'local');
			}
		}
		if (guest.text.length > 10) {
			if (op < 0.4) {
				const pos = Math.floor(Math.random() * guest.text.length);
				guest.doc.transact(() => guest.text.insert(pos, String.fromCharCode(48 + (i % 10))), 'local');
			} else if (op < 0.7) {
				const pos = Math.floor(Math.random() * (guest.text.length - 1));
				guest.doc.transact(() => guest.text.delete(pos, 1), 'local');
			} else {
				const pos = Math.floor(Math.random() * (guest.text.length - 1));
				guest.doc.transact(() => {
					guest.text.delete(pos, 1);
					guest.text.insert(pos, '#');
				}, 'local');
			}
		}
	}

	await sleep(3000);

	assert(host.text.toString() === guest.text.toString(), 'convergence after mixed storm');
	console.log(`  final length: host=${host.text.length} guest=${guest.text.length} match=${host.text.toString() === guest.text.toString()}`);

	cleanup(host, guest);
}

async function testEmptyDoc(): Promise<void> {
	console.log('\nEmpty doc edge cases');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h13', '');
	const guest = await setupPeer(session.id, 'Guest', 'g13', null);
	await sleep(500);

	assert(host.text.toString() === '', 'host starts empty');
	assert(guest.text.toString() === '', 'guest starts empty');

	guest.doc.transact(() => guest.text.insert(0, 'first'), 'local');
	await sleep(300);
	assert(host.text.toString() === 'first', 'host got insert into empty');

	host.doc.transact(() => host.text.delete(0, host.text.length), 'local');
	await sleep(300);
	assert(guest.text.toString() === '', 'guest sees full delete');

	host.doc.transact(() => host.text.insert(0, 'second'), 'local');
	await sleep(300);
	assert(guest.text.toString() === 'second', 'guest sees insert after clear');
	assert(host.text.toString() === guest.text.toString(), 'match');
	console.log(`  final: "${host.text.toString()}"`);

	cleanup(host, guest);
}

async function testUndoWithRemote(): Promise<void> {
	console.log('\nUndo with concurrent remote edits');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h14', 'initial');
	const guest = await setupPeer(session.id, 'Guest', 'g14', null);
	await sleep(500);

	const hostUndo = new Y.UndoManager(host.text, { trackedOrigins: new Set(['local']) });

	host.doc.transact(() => host.text.insert(7, '_one'), 'local');
	await sleep(200);
	host.doc.transact(() => host.text.insert(11, '_two'), 'local');
	await sleep(200);

	guest.doc.transact(() => guest.text.insert(0, 'GUEST_'), 'local');
	await sleep(300);

	host.doc.transact(() => host.text.insert(host.text.length, '_three'), 'local');
	await sleep(300);

	console.log(`  before undos: "${host.text.toString()}"`);
	const beforeUndo = host.text.toString();
	assert(beforeUndo.includes('GUEST_'), 'has guest content');
	assert(beforeUndo.includes('_one'), 'has host _one');
	assert(beforeUndo.includes('_two'), 'has host _two');
	assert(beforeUndo.includes('_three'), 'has host _three');

	hostUndo.undo();
	await sleep(300);
	assert(!host.text.toString().includes('_three'), 'undo removed _three');
	assert(host.text.toString().includes('GUEST_'), 'undo kept GUEST_');
	assert(host.text.toString().includes('_one'), 'undo kept _one');

	hostUndo.undo();
	await sleep(300);
	assert(!host.text.toString().includes('_two'), 'undo removed _two');
	assert(host.text.toString().includes('GUEST_'), 'still has GUEST_');

	hostUndo.undo();
	await sleep(300);
	assert(!host.text.toString().includes('_one'), 'undo removed _one');
	assert(host.text.toString().includes('GUEST_'), 'still has GUEST_');
	assert(host.text.toString().includes('initial'), 'still has initial');

	assert(host.text.toString() === guest.text.toString(), 'convergence after undos');
	console.log(`  after all undos: "${host.text.toString()}"`);

	cleanup(host, guest);
}

async function main(): Promise<void> {
	console.log('ZeroPR Sync Stress Test Suite');

	await testInitialSync();
	await testBidirectional();
	await testRapidEdits();
	await testConcurrentTyping();
	await testLargeDoc();
	await testDeletes();
	await testInterleavedOps();
	await testUndoManager();
	await testStressConcurrent();
	await testLargeDocConcurrent();
	await testDeleteStress();
	await testMixedStorm();
	await testEmptyDoc();
	await testUndoWithRemote();

	printResults('Sync');
}

main().catch(err => {
	console.error('FATAL:', err);
	process.exit(1);
});
