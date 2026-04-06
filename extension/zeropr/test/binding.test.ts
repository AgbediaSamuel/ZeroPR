// Binding and echo detection tests

import { assert, printResults, EchoDetector, Y } from './helpers';

class MockFileSystem {
	files: Map<string, Uint8Array>;

	constructor() {
		this.files = new Map();
	}
	writeFile(path: string, content: Uint8Array): void { this.files.set(path, content); }
	readFile(path: string): Uint8Array {
		const data = this.files.get(path);
		if (!data) {throw new Error('FileNotFound');}
		return data;
	}
	stat(path: string): { size: number; type: string } {
		const data = this.files.get(path);
		if (!data) {throw new Error('FileNotFound');}
		return { size: data.byteLength, type: 'file' };
	}
	delete(path: string): void { this.files.delete(path); }
	has(path: string): boolean { return this.files.has(path); }
}

function testEchoBasicInsert(): void {
	console.log('\nEcho detection — basic insert');
	const detector = new EchoDetector('hello');

	const cs = detector.applyRemote([{ retain: 5 }, { insert: ' world' }]);
	const isReal = detector.shouldApply([{ rangeOffset: 5, rangeLength: 0, text: ' world' }]);
	assert(!isReal, 'insert echo should be detected');
	assert(detector.text === 'hello world', 'mirror should be "hello world"');

	detector.finishRemote(cs);
	assert(detector.changeSets.length === 0, 'changeset cleaned up');
	console.log(`  mirror: "${detector.text}"`);
}

function testEchoBasicDelete(): void {
	console.log('\nEcho detection — basic delete');
	const detector = new EchoDetector('hello world');

	const cs = detector.applyRemote([{ retain: 5 }, { delete: 6 }]);
	const isReal = detector.shouldApply([{ rangeOffset: 5, rangeLength: 6, text: '' }]);
	assert(!isReal, 'delete echo should be detected');
	assert(detector.text === 'hello', 'mirror should be "hello"');

	detector.finishRemote(cs);
}

function testEchoReplace(): void {
	console.log('\nEcho detection — replace echo');
	const detector = new EchoDetector('hello world');

	const cs = detector.applyRemote([{ retain: 6 }, { delete: 5 }, { insert: 'earth' }]);
	const isReal = detector.shouldApply([{ rangeOffset: 6, rangeLength: 5, text: 'earth' }]);
	assert(!isReal, 'replace echo should be detected');
	assert(detector.text === 'hello earth', 'mirror correct');

	detector.finishRemote(cs);
}

function testRealLocalEdit(): void {
	console.log('\nReal local edit (not an echo)');
	const detector = new EchoDetector('hello');

	const isReal = detector.shouldApply([{ rangeOffset: 5, rangeLength: 0, text: '!' }]);
	assert(isReal, 'real local edit should return true');
	assert(detector.text === 'hello!', 'mirror updated');
	console.log(`  mirror: "${detector.text}"`);
}

function testRealEditWithPending(): void {
	console.log('\nReal edit while remote changeset pending');
	const detector = new EchoDetector('abc');

	const cs = detector.applyRemote([{ retain: 1 }, { insert: 'X' }]);

	const isReal = detector.shouldApply([{ rangeOffset: 0, rangeLength: 0, text: 'Y' }]);
	assert(isReal, 'different edit should not be detected as echo');
	assert(detector.text === 'YaXbc', 'mirror has both edits');

	const isEcho = detector.shouldApply([{ rangeOffset: 2, rangeLength: 0, text: 'X' }]);
	console.log(`  real edit detected: ${isReal}, mirror: "${detector.text}"`);

	detector.finishRemote(cs);
}

function testMultiplePending(): void {
	console.log('\nMultiple pending changesets');
	const detector = new EchoDetector('abcdef');

	const cs1 = detector.applyRemote([{ retain: 3 }, { insert: 'X' }]);
	const cs2 = detector.applyRemote([{ retain: 5 }, { insert: 'Y' }]);

	assert(detector.changeSets.length === 2, 'two pending changesets');
	assert(detector.text === 'abcXdYef', 'mirror reflects both');

	const e1 = detector.shouldApply([{ rangeOffset: 3, rangeLength: 0, text: 'X' }]);
	const e2 = detector.shouldApply([{ rangeOffset: 5, rangeLength: 0, text: 'Y' }]);

	console.log(`  echo1=${!e1} echo2=${!e2} mirror="${detector.text}"`);

	detector.finishRemote(cs1);
	detector.finishRemote(cs2);
}

function testMultilineInsert(): void {
	console.log('\nMultiline insert echo');
	const detector = new EchoDetector('line1\nline3');

	const cs = detector.applyRemote([{ retain: 5 }, { insert: '\nline2' }]);
	const isReal = detector.shouldApply([{ rangeOffset: 5, rangeLength: 0, text: '\nline2' }]);
	assert(!isReal, 'multiline insert echo detected');
	assert(detector.text === 'line1\nline2\nline3', 'mirror correct');

	detector.finishRemote(cs);
	console.log(`  mirror: "${detector.text.replace(/\n/g, '\\n')}"`);
}

function testEmptyChangesets(): void {
	console.log('\nNo pending changesets');
	const detector = new EchoDetector('test');

	const isReal = detector.shouldApply([{ rangeOffset: 0, rangeLength: 4, text: 'new' }]);
	assert(isReal, 'always real when no pending changesets');
	assert(detector.text === 'new', 'mirror updated');
}

function testMirrorAccuracy(): void {
	console.log('\nText mirror accuracy (50 operations)');
	const detector = new EchoDetector('');
	let expected = '';

	for (let i = 0; i < 50; i++) {
		const char = String.fromCharCode(65 + (i % 26));
		expected += char;
		detector.shouldApply([{ rangeOffset: i, rangeLength: 0, text: char }]);
	}

	assert(detector.text === expected, `mirror matches after 50 inserts: len=${detector.text.length}`);

	expected = expected.substring(0, 20) + expected.substring(30);
	detector.shouldApply([{ rangeOffset: 20, rangeLength: 10, text: '' }]);
	assert(detector.text === expected, 'mirror matches after delete');

	expected = expected.substring(0, 10) + 'XXXXX' + expected.substring(15);
	detector.shouldApply([{ rangeOffset: 10, rangeLength: 5, text: 'XXXXX' }]);
	assert(detector.text === expected, 'mirror matches after replace');

	console.log(`  final mirror len: ${detector.text.length}, expected: ${expected.length}`);
}

function testFsBasic(): void {
	console.log('\nFileSystemProvider basic ops');
	const fs = new MockFileSystem();
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	fs.writeFile('/session-abc/main.go', encoder.encode('package main'));
	const content = decoder.decode(fs.readFile('/session-abc/main.go'));
	assert(content === 'package main', 'read matches write');

	const stat = fs.stat('/session-abc/main.go');
	assert(stat.size === 12, 'stat size correct');

	fs.writeFile('/session-abc/main.go', encoder.encode('package test'));
	const content2 = decoder.decode(fs.readFile('/session-abc/main.go'));
	assert(content2 === 'package test', 'overwrite works');

	fs.delete('/session-abc/main.go');
	assert(!fs.has('/session-abc/main.go'), 'file deleted');

	let threw = false;
	try { fs.readFile('/session-abc/main.go'); } catch { threw = true; }
	assert(threw, 'read deleted file throws');
}

function testFsIsolation(): void {
	console.log('\nFileSystemProvider session isolation');
	const fs = new MockFileSystem();
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	fs.writeFile('/session-aaa/file.go', encoder.encode('aaa content'));
	fs.writeFile('/session-bbb/file.go', encoder.encode('bbb content'));

	const a = decoder.decode(fs.readFile('/session-aaa/file.go'));
	const b = decoder.decode(fs.readFile('/session-bbb/file.go'));

	assert(a === 'aaa content', 'session aaa has its own content');
	assert(b === 'bbb content', 'session bbb has its own content');
	assert(a !== b, 'sessions are isolated');

	fs.delete('/session-aaa/file.go');
	assert(!fs.has('/session-aaa/file.go'), 'aaa deleted');
	assert(fs.has('/session-bbb/file.go'), 'bbb still exists');
}

function testFsLargeFile(): void {
	console.log('\nFileSystemProvider large file (100KB)');
	const fs = new MockFileSystem();
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	const large = 'x'.repeat(100000);
	fs.writeFile('/session-big/huge.txt', encoder.encode(large));
	const back = decoder.decode(fs.readFile('/session-big/huge.txt'));
	assert(back === large, '100KB file round-trips');
	assert(fs.stat('/session-big/huge.txt').size === 100000, 'stat size correct for 100KB');
}

function testOffsetConversion(): void {
	console.log('\nY.Text delta to content changes');

	const doc = 'hello world';
	const delta = [{ retain: 5 }, { insert: 'X' }];

	let offset = 0;
	let result = doc;
	for (const op of delta) {
		if (op.retain) { offset += op.retain; }
		else if (op.insert) {
			result = result.substring(0, offset) + op.insert + result.substring(offset);
			offset += op.insert.length;
		}
	}
	assert(result === 'helloX world', 'retain+insert at correct position');

	let result2 = result;
	offset = 0;
	const delta2: Array<{ retain?: number; delete?: number }> = [{ retain: 5 }, { delete: 1 }];
	for (const op of delta2) {
		if (op.retain) {offset += op.retain;}
		else if (op.delete) {result2 = result2.substring(0, offset) + result2.substring(offset + op.delete);}
	}
	assert(result2 === 'hello world', 'retain+delete restores original');
}

function testEchoRapidSequential(): void {
	console.log('\nEcho detection — rapid sequential remotes');
	const detector = new EchoDetector('start');

	for (let i = 0; i < 20; i++) {
		const ch = String.fromCharCode(65 + i);
		detector.applyRemote([{ retain: detector.text.length }, { insert: ch }]);
	}

	assert(detector.text === 'startABCDEFGHIJKLMNOPQRST', 'mirror has all 20 inserts');
	assert(detector.changeSets.length === 20, '20 pending changesets');

	let echoes = 0;
	let echoResult = detector.shouldApply([{ rangeOffset: 5, rangeLength: 0, text: 'A' }]);
	if (!echoResult) {echoes++;}

	console.log(`  echoes detected: ${echoes}/1 tested, mirror len=${detector.text.length}`);
}

function testChangesetCleanup(): void {
	console.log('\nChangeset cleanup');
	const detector = new EchoDetector('abc');

	const cs1 = detector.applyRemote([{ insert: 'X' }]);
	const cs2 = detector.applyRemote([{ retain: detector.text.length }, { insert: 'Y' }]);
	const cs3 = detector.applyRemote([{ retain: detector.text.length }, { insert: 'Z' }]);

	assert(detector.changeSets.length === 3, 'three pending');

	detector.finishRemote(cs2);
	assert(detector.changeSets.length === 2, 'two after removing middle');

	detector.finishRemote(cs1);
	assert(detector.changeSets.length === 1, 'one remaining');

	detector.finishRemote(cs3);
	assert(detector.changeSets.length === 0, 'all cleaned up');

	detector.finishRemote(cs1);
	assert(detector.changeSets.length === 0, 'no crash on double-finish');
}

function testUndoOrigins(): void {
	console.log('\nUndoManager origin filtering');
	const doc = new Y.Doc();
	const text = doc.getText('content');
	const undoManager = new Y.UndoManager(text, { trackedOrigins: new Set(['local']) });

	doc.transact(() => text.insert(0, 'local_'), 'local');
	assert(text.toString() === 'local_', 'local insert works');

	doc.transact(() => text.insert(text.length, 'remote_'), 'provider');
	assert(text.toString() === 'local_remote_', 'remote insert works');

	undoManager.undo();
	assert(text.toString() === 'remote_', 'undo only removed local content');
	assert(!text.toString().includes('local_'), 'local content gone');
	assert(text.toString().includes('remote_'), 'remote content preserved');

	undoManager.redo();
	assert(text.toString().includes('local_'), 'redo restored local');
	assert(text.toString().includes('remote_'), 'remote still there');
	console.log(`  final: "${text.toString()}"`);
}

function testUndoMultipleCycles(): void {
	console.log('\nUndoManager multiple cycles');
	const doc = new Y.Doc();
	const text = doc.getText('content');
	const undo = new Y.UndoManager(text, { trackedOrigins: new Set(['local']), captureTimeout: 0 });

	doc.transact(() => text.insert(0, 'A'), 'local');
	doc.transact(() => text.insert(1, 'B'), 'local');
	doc.transact(() => text.insert(2, 'C'), 'local');
	doc.transact(() => text.insert(3, 'D'), 'remote');
	assert(text.toString() === 'ABCD', 'all inserted');

	undo.undo();
	assert(text.toString() === 'ABD', 'undo C');

	undo.undo();
	assert(text.toString() === 'AD', 'undo B');

	undo.undo();
	assert(text.toString() === 'D', 'undo A, remote D stays');

	undo.undo();
	assert(text.toString() === 'D', 'extra undo is no-op');

	undo.redo();
	assert(text.toString().includes('A'), 'redo A');

	undo.redo();
	assert(text.toString().includes('B'), 'redo B');

	undo.redo();
	assert(text.toString().includes('C'), 'redo C');

	undo.redo();
	assert(text.toString() === 'ABCD', 'all restored');

	console.log(`  final: "${text.toString()}"`);
}

function testUndoRemoteInterleave(): void {
	console.log('\nUndoManager with interleaved remote ops');
	const doc = new Y.Doc();
	const text = doc.getText('content');
	const undo = new Y.UndoManager(text, { trackedOrigins: new Set(['local']) });

	doc.transact(() => text.insert(0, 'AAA'), 'local');
	doc.transact(() => text.insert(3, 'RRR'), 'remote');
	doc.transact(() => text.insert(6, 'BBB'), 'local');
	doc.transact(() => text.insert(9, 'SSS'), 'remote');

	assert(text.toString() === 'AAARRRBBBS' + 'SS', 'all 12 chars');
	console.log(`  before undo: "${text.toString()}"`);

	undo.undo();
	const afterUndo1 = text.toString();
	assert(!afterUndo1.includes('BBB'), 'BBB removed');
	assert(afterUndo1.includes('RRR'), 'RRR preserved');
	assert(afterUndo1.includes('SSS'), 'SSS preserved');
	console.log(`  after undo BBB: "${afterUndo1}"`);

	undo.undo();
	const afterUndo2 = text.toString();
	assert(!afterUndo2.includes('AAA'), 'AAA removed');
	assert(afterUndo2.includes('RRR'), 'RRR still preserved');
	assert(afterUndo2.includes('SSS'), 'SSS still preserved');
	console.log(`  after undo AAA: "${afterUndo2}"`);
}

function testMirrorInterleaving(): void {
	console.log('\nText mirror with echo + local interleaving');
	const detector = new EchoDetector('hello');

	const cs = detector.applyRemote([{ retain: 5 }, { insert: ' world' }]);

	detector.shouldApply([{ rangeOffset: 0, rangeLength: 0, text: 'oh ' }]);
	assert(detector.text === 'oh hello world', 'mirror has both local and remote');

	const echoResult = detector.shouldApply([{ rangeOffset: 8, rangeLength: 0, text: ' world' }]);
	console.log(`  echo after local edit detected as real: ${echoResult}`);

	detector.finishRemote(cs);
}

function testEchoStress(): void {
	console.log('\nEcho detection stress (100 round-trips)');
	const detector = new EchoDetector('');

	let correctEchoes = 0;
	for (let i = 0; i < 100; i++) {
		const ch = String.fromCharCode(65 + (i % 26));
		const pos = detector.text.length;

		const cs = detector.applyRemote([{ retain: pos }, { insert: ch }]);
		const isReal = detector.shouldApply([{ rangeOffset: pos, rangeLength: 0, text: ch }]);
		if (!isReal) {correctEchoes++;}

		detector.finishRemote(cs);
	}

	assert(correctEchoes === 100, `all 100 echoes detected (got ${correctEchoes})`);
	assert(detector.text.length === 100, 'mirror has 100 chars');
	assert(detector.changeSets.length === 0, 'no leftover changesets');
	console.log(`  echoes detected: ${correctEchoes}/100, mirror len: ${detector.text.length}`);
}

console.log('ZeroPR Binding & Echo Detection Tests');

testEchoBasicInsert();
testEchoBasicDelete();
testEchoReplace();
testRealLocalEdit();
testRealEditWithPending();
testMultiplePending();
testMultilineInsert();
testEmptyChangesets();
testMirrorAccuracy();
testFsBasic();
testFsIsolation();
testFsLargeFile();
testOffsetConversion();
testEchoRapidSequential();
testChangesetCleanup();
testUndoOrigins();
testUndoMultipleCycles();
testUndoRemoteInterleave();
testMirrorInterleaving();
testEchoStress();

printResults('Binding');
