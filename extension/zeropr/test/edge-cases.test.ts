// Edge case tests — unicode, conflicts, echo detector, error recovery, large operations

import { assert, sleep, createProvider, connectWs, createSession, setupPeer, cleanup, printResults, EchoDetector, Y, AGENT, MSG_SYNC } from './helpers';

async function testUnicodeEmoji(): Promise<void> {
	console.log('\nUnicode: emoji and multi-byte characters');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', 'Hello 🌍🎉 World');
	const guest = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(500);

	assert(guest.text.toString() === 'Hello 🌍🎉 World', 'guest gets emoji content');

	host.doc.transact(() => host.text.insert(8, '🔥'), 'local');
	await sleep(300);
	assert(host.text.toString() === 'Hello 🌍🔥🎉 World', 'host has new emoji');
	assert(guest.text.toString() === host.text.toString(), 'guest matches after emoji insert');

	guest.doc.transact(() => guest.text.delete(6, 2), 'local');
	await sleep(300);
	assert(!host.text.toString().includes('🌍'), 'emoji deleted');
	assert(host.text.toString() === guest.text.toString(), 'match after emoji delete');
	console.log(`  result: "${host.text.toString()}"`);

	cleanup(host, guest);
}

async function testSameOffsetInsert(): Promise<void> {
	console.log('\nConcurrent insert at exact same offset');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', '01234567');
	const guest = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(500);

	host.doc.transact(() => host.text.insert(5, 'AAA'), 'local');
	guest.doc.transact(() => guest.text.insert(5, 'BBB'), 'local');
	await sleep(500);

	assert(host.text.toString() === guest.text.toString(), 'convergence at same offset');
	assert(host.text.length === 14, `length should be 14, got ${host.text.length}`);
	console.log(`  result: "${host.text.toString()}"`);

	cleanup(host, guest);
}

async function testDeleteWhileInsertSamePos(): Promise<void> {
	console.log('\nDelete at pos while other inserts at same pos');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', 'ABCDEFGH');
	const guest = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(500);

	host.doc.transact(() => host.text.delete(2, 3), 'local');
	guest.doc.transact(() => guest.text.insert(4, 'XYZ'), 'local');
	await sleep(500);

	assert(host.text.toString() === guest.text.toString(), 'convergence after delete+insert conflict');
	console.log(`  result: "${host.text.toString()}"`);

	cleanup(host, guest);
}

async function testSelectAllReplace(): Promise<void> {
	console.log('\nSelect-all and replace (full doc swap)');
	const original = 'function hello() {\n  return "hello";\n}\n'.repeat(50);
	const replacement = 'class Goodbye {\n  constructor() {}\n}\n'.repeat(50);

	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', original);
	const guest = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(1000);

	assert(guest.text.toString() === original, 'guest has original');

	host.doc.transact(() => {
		host.text.delete(0, host.text.length);
		host.text.insert(0, replacement);
	}, 'local');
	await sleep(1000);

	assert(guest.text.toString() === replacement, 'guest has replacement');
	assert(host.text.toString() === guest.text.toString(), 'match after full replace');
	console.log(`  original len=${original.length} replacement len=${replacement.length} match=${host.text.toString() === guest.text.toString()}`);

	cleanup(host, guest);
}

async function testLargePaste(): Promise<void> {
	console.log('\nLarge paste (50KB single insert)');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', 'start');
	const guest = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(500);

	const paste = 'X'.repeat(50000);
	host.doc.transact(() => host.text.insert(5, paste), 'local');
	await sleep(2000);

	assert(host.text.length === 50005, `host length ${host.text.length}`);
	assert(guest.text.length === 50005, `guest length ${guest.text.length}`);
	assert(host.text.toString() === guest.text.toString(), '50KB paste synced');

	const paste2 = 'Y'.repeat(50000);
	guest.doc.transact(() => guest.text.insert(25000, paste2), 'local');
	await sleep(2000);

	assert(host.text.length === 100005, `host length after second paste ${host.text.length}`);
	assert(host.text.toString() === guest.text.toString(), '100KB total synced');
	console.log(`  final length: ${host.text.length}`);

	cleanup(host, guest);
}

async function testOnlyNewlines(): Promise<void> {
	console.log('\nDocument with only newlines');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', '\n\n\n\n\n');
	const guest = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(500);

	assert(guest.text.toString() === '\n\n\n\n\n', 'guest gets newlines');

	host.doc.transact(() => host.text.insert(3, 'X'), 'local');
	await sleep(300);
	assert(guest.text.toString() === '\n\n\nX\n\n', 'insert between newlines');

	guest.doc.transact(() => guest.text.delete(0, 1), 'local');
	await sleep(300);
	assert(host.text.toString() === guest.text.toString(), 'match after newline delete');
	assert(host.text.toString() === '\n\nX\n\n', 'correct content');
	console.log(`  result: "${host.text.toString().replace(/\n/g, '\\n')}"`);

	cleanup(host, guest);
}

async function testRapidUndoRedo(): Promise<void> {
	console.log('\nRapid undo/redo cycling (20 cycles)');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', 'base');
	const guest = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(500);

	const undo = new Y.UndoManager(host.text, { trackedOrigins: new Set(['local']), captureTimeout: 0 });

	for (let i = 0; i < 10; i++) {
		host.doc.transact(() => host.text.insert(host.text.length, String.fromCharCode(65 + i)), 'local');
	}
	await sleep(300);
	assert(host.text.toString() === 'baseABCDEFGHIJ', 'after typing 10');

	undo.undo(); undo.undo(); undo.undo();
	undo.redo(); undo.redo();
	undo.undo(); undo.undo(); undo.undo(); undo.undo();
	undo.redo(); undo.redo(); undo.redo();
	undo.undo();
	await sleep(500);

	assert(host.text.toString() === guest.text.toString(), 'convergence after undo/redo storm');
	console.log(`  host: "${host.text.toString()}" guest: "${guest.text.toString()}" match=${host.text.toString() === guest.text.toString()}`);

	cleanup(host, guest);
}

async function testVeryLongSingleLine(): Promise<void> {
	console.log('\nVery long single line (200KB, no newlines)');
	const session = await createSession();
	const longLine = 'A'.repeat(200000);
	const host = await setupPeer(session.id, 'Host', 'h', longLine);
	const guest = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(2000);

	assert(guest.text.length === 200000, `guest length ${guest.text.length}`);
	assert(guest.text.toString() === longLine, '200KB single line synced');

	host.doc.transact(() => host.text.insert(100000, 'MIDDLE'), 'local');
	await sleep(1000);
	assert(guest.text.length === 200006, `guest length after insert ${guest.text.length}`);
	assert(host.text.toString() === guest.text.toString(), 'match after mid-insert');
	console.log(`  final length: ${host.text.length}`);

	cleanup(host, guest);
}

async function testDeleteMoreThanExists(): Promise<void> {
	console.log('\nDelete more than exists');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', 'abc');
	const guest = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(500);

	let threw = false;
	try {
		host.doc.transact(() => host.text.delete(0, 10), 'local');
	} catch {
		threw = true;
	}
	await sleep(300);
	assert(host.text.toString() === guest.text.toString(), 'convergence after oversized delete');
	console.log(`  threw: ${threw}, host: "${host.text.toString()}" guest: "${guest.text.toString()}"`);

	cleanup(host, guest);
}

async function testMixedUnicodeAndAscii(): Promise<void> {
	console.log('\nMixed unicode, CJK, and ASCII');
	const session = await createSession();
	const content = 'Hello 世界 مرحبا мир 🌍\nLine 2: café résumé naïve\n日本語テスト';
	const host = await setupPeer(session.id, 'Host', 'h', content);
	const guest = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(500);

	assert(guest.text.toString() === content, 'mixed unicode synced');

	host.doc.transact(() => host.text.insert(9, '你好'), 'local');
	await sleep(300);
	assert(host.text.toString() === guest.text.toString(), 'CJK insert synced');

	guest.doc.transact(() => guest.text.delete(6, 4), 'local');
	await sleep(300);
	assert(host.text.toString() === guest.text.toString(), 'cross-unicode delete synced');
	console.log(`  result: "${host.text.toString().substring(0, 30)}..."`);

	cleanup(host, guest);
}

async function testEmptyInsertAndDelete(): Promise<void> {
	console.log('\nEmpty string operations');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', 'test');
	const guest = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(500);

	host.doc.transact(() => host.text.insert(2, ''), 'local');
	await sleep(200);
	assert(host.text.toString() === 'test', 'empty insert is no-op');
	assert(host.text.toString() === guest.text.toString(), 'still in sync');

	host.doc.transact(() => host.text.delete(2, 0), 'local');
	await sleep(200);
	assert(host.text.toString() === 'test', 'zero-length delete is no-op');
	assert(host.text.toString() === guest.text.toString(), 'still in sync');

	cleanup(host, guest);
}

async function testReconnectMidEdit(): Promise<void> {
	console.log('\nReconnect: guest leaves and rejoins mid-editing');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', 'initial content');
	const guest1 = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(500);

	assert(guest1.text.toString() === 'initial content', 'guest1 synced');

	host.doc.transact(() => host.text.insert(host.text.length, ' BEFORE'), 'local');
	await sleep(300);
	assert(guest1.text.toString().includes('BEFORE'), 'guest1 got BEFORE');

	guest1.provider.destroy();
	guest1.ws.close();
	await sleep(500);

	host.doc.transact(() => host.text.insert(host.text.length, ' DURING'), 'local');

	host.provider.destroy();
	host.ws.close();
	const hostWs2 = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Host', host: 'h' });
	host.ws = hostWs2;
	host.provider = createProvider(host.doc, hostWs2);
	await sleep(300);

	const guest2 = await setupPeer(session.id, 'Guest', 'g2', null);
	await sleep(1000);

	assert(guest2.text.toString().includes('BEFORE'), 'guest2 has BEFORE');
	assert(guest2.text.toString().includes('DURING'), 'guest2 has DURING');
	assert(host.text.toString() === guest2.text.toString(), 'guest2 fully caught up');
	console.log(`  host: "${host.text.toString()}"`);

	cleanup(host, guest2);
}

async function testUndoAfterReconnect(): Promise<void> {
	console.log('\nUndo after guest reconnect');
	const session = await createSession();
	const host = await setupPeer(session.id, 'Host', 'h', 'base');
	const undo = new Y.UndoManager(host.text, { trackedOrigins: new Set(['local']), captureTimeout: 0 });

	const guest1 = await setupPeer(session.id, 'Guest', 'g', null);
	await sleep(500);

	host.doc.transact(() => host.text.insert(4, '_AAA'), 'local');
	await sleep(200);
	host.doc.transact(() => host.text.insert(host.text.length, '_BBB'), 'local');
	await sleep(200);

	guest1.doc.transact(() => guest1.text.insert(0, 'GUEST_'), 'local');
	await sleep(300);

	const beforeDisconnect = host.text.toString();
	console.log(`  before disconnect: "${beforeDisconnect}"`);

	guest1.provider.destroy();
	guest1.ws.close();
	await sleep(500);

	undo.undo();
	await sleep(200);
	assert(!host.text.toString().includes('_BBB'), 'undo removed _BBB');
	assert(host.text.toString().includes('GUEST_'), 'undo kept GUEST_');
	assert(host.text.toString().includes('_AAA'), 'undo kept _AAA');

	host.provider.destroy();
	host.ws.close();
	const hostWs2 = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Host', host: 'h' });
	host.ws = hostWs2;
	host.provider = createProvider(host.doc, hostWs2);
	await sleep(300);

	const guest2 = await setupPeer(session.id, 'Guest', 'g2', null);
	await sleep(1000);

	assert(host.text.toString() === guest2.text.toString(), 'guest2 matches host after undo');
	console.log(`  after undo + reconnect: "${host.text.toString()}"`);

	cleanup(host, guest2);
}

function testCoincidentalCollision(): void {
	console.log('\nEcho detector: coincidental collision (false negative risk)');
	const det = new EchoDetector('hello');

	const cs = det.applyRemote([{ retain: 5 }, { insert: 'X' }]);
	const result = det.shouldApply([{ rangeOffset: 5, rangeLength: 0, text: 'X' }]);
	console.log(`  coincidental collision: shouldApply=${result} (false=echo detected, potential false negative)`);

	det.finishRemote(cs);
}

function testEchoWithMultipleContentChanges(): void {
	console.log('\nEcho detector: VS Code batches multiple changes');
	const det = new EchoDetector('ABCDEF');

	const cs = det.applyRemote([
		{ retain: 1 }, { delete: 2 }, { insert: 'XY' },
		{ retain: 1 }, { delete: 2 }, { insert: 'ZW' }
	]);

	const isEcho = det.shouldApply([
		{ rangeOffset: 1, rangeLength: 2, text: 'XY' },
		{ rangeOffset: 4, rangeLength: 2, text: 'ZW' }
	]);
	assert(!isEcho, 'multi-change echo detected');
	console.log(`  mirror: "${det.text}"`);

	det.finishRemote(cs);
}

function testResyncEchoWithDriftedMirror(): void {
	console.log('\nEcho detector: resync with drifted mirror');
	const det = new EchoDetector('ABC');

	const cs = det.applyRemote([{ delete: 3 }, { insert: 'XYZ' }]);

	const isEcho = det.shouldApply([{ rangeOffset: 0, rangeLength: 4, text: 'XYZ' }]);
	console.log(`  drifted resync echo: shouldApply=${isEcho}`);

	det.finishRemote(cs);
}

function testEchoUnicodeEmoji(): void {
	console.log('\nEcho detector: emoji insert/delete');
	const det = new EchoDetector('Hello 🌍 World');

	const cs = det.applyRemote([{ retain: 8 }, { insert: '🔥' }]);
	assert(det.text === 'Hello 🌍🔥 World', 'mirror after emoji insert');

	const isEcho = det.shouldApply([{ rangeOffset: 8, rangeLength: 0, text: '🔥' }]);
	assert(!isEcho, 'emoji echo detected');

	det.finishRemote(cs);
}

function testProcessQueueErrorRecovery(): void {
	console.log('\nprocessQueue: error recovery');
	const doc1 = new Y.Doc();
	const doc2 = new Y.Doc();
	const text1 = doc1.getText('content');
	const text2 = doc2.getText('content');
	text1.insert(0, 'base');

	const update = Y.encodeStateAsUpdate(doc1);
	Y.applyUpdate(doc2, update);
	assert(text2.toString() === 'base', 'initial sync');

	doc1.transact(() => text1.insert(4, '_one'), 'local');
	doc1.transact(() => text1.insert(8, '_two'), 'local');
	doc1.transact(() => text1.insert(12, '_three'), 'local');

	const fullUpdate = Y.encodeStateAsUpdate(doc1, Y.encodeStateVector(doc2));
	Y.applyUpdate(doc2, fullUpdate);

	assert(text2.toString() === 'base_one_two_three', 'full catchup works');
	assert(text1.toString() === text2.toString(), 'docs match');
	console.log(`  result: "${text2.toString()}"`);
}

function testOverlappingContentChanges(): void {
	console.log('\nEcho detector: overlapping content changes');
	const det = new EchoDetector('ABCDEF');

	const isReal = det.shouldApply([
		{ rangeOffset: 0, rangeLength: 2, text: '' },
		{ rangeOffset: 2, rangeLength: 2, text: '' }
	]);
	assert(isReal, 'adjacent deletes treated as real');
	assert(det.text === 'EF', 'mirror correct after adjacent deletes');
	console.log(`  mirror: "${det.text}"`);
}

function testCRLFContent(): void {
	console.log('\nCRLF content in Y.Text');
	const doc = new Y.Doc();
	const text = doc.getText('content');

	text.insert(0, 'line1\r\nline2\r\nline3');
	assert(text.toString() === 'line1\r\nline2\r\nline3', 'CRLF stored correctly');
	assert(text.length === 19, `length is ${text.length} (includes \\r)`);

	text.insert(7, 'X');
	assert(text.toString() === 'line1\r\nXline2\r\nline3', 'insert after CRLF');

	text.delete(5, 3);
	assert(text.toString() === 'line1line2\r\nline3', 'delete across CRLF');
	console.log(`  result: "${text.toString().replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`);
}

async function main(): Promise<void> {
	console.log('ZeroPR Edge Case & Stress Tests');

	await testUnicodeEmoji();
	await testSameOffsetInsert();
	await testDeleteWhileInsertSamePos();
	await testSelectAllReplace();
	await testLargePaste();
	await testOnlyNewlines();
	await testRapidUndoRedo();
	await testVeryLongSingleLine();
	await testDeleteMoreThanExists();
	await testMixedUnicodeAndAscii();
	await testEmptyInsertAndDelete();
	await testReconnectMidEdit();
	await testUndoAfterReconnect();

	testCoincidentalCollision();
	testEchoWithMultipleContentChanges();
	testResyncEchoWithDriftedMirror();
	testEchoUnicodeEmoji();
	testProcessQueueErrorRecovery();
	testOverlappingContentChanges();
	testCRLFContent();

	printResults('Edge Cases');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
