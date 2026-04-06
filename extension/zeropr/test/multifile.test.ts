// Multi-file session tests
import { assert, sleep, createProvider, connectWs, createSession, printResults, Y } from './helpers';

function testLocalMultiText(): void {
	console.log('\nMulti-text: basic isolation in one Y.Doc');
	const doc = new Y.Doc();
	const file1 = doc.getText('file:main.go');
	const file2 = doc.getText('file:utils.go');
	const file3 = doc.getText('file:test.go');

	file1.insert(0, 'package main');
	file2.insert(0, 'package utils');
	file3.insert(0, 'package test');

	assert(file1.toString() === 'package main', 'file1 correct');
	assert(file2.toString() === 'package utils', 'file2 correct');
	assert(file3.toString() === 'package test', 'file3 correct');

	file1.insert(12, '\nfunc main() {}');
	assert(file2.toString() === 'package utils', 'file2 unchanged after file1 edit');
	assert(file3.toString() === 'package test', 'file3 unchanged after file1 edit');

	doc.destroy();
}

async function testMultiTextSync(): Promise<void> {
	console.log('\nMulti-text: sync 3 files over one WebSocket');
	const session = await createSession();

	const hostDoc = new Y.Doc();
	const hostWs = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Host', host: 'h' });
	const hostProv = createProvider(hostDoc, hostWs);

	const hFile1 = hostDoc.getText('file:main.go');
	const hFile2 = hostDoc.getText('file:utils.go');
	const hFile3 = hostDoc.getText('file:config.json');
	hFile1.insert(0, 'package main\nfunc main() {}');
	hFile2.insert(0, 'package utils\nfunc Helper() {}');
	hFile3.insert(0, '{"port": 9080}');

	const guestDoc = new Y.Doc();
	const guestWs = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Guest', host: 'g' });
	const guestProv = createProvider(guestDoc, guestWs);
	await sleep(1000);

	const gFile1 = guestDoc.getText('file:main.go');
	const gFile2 = guestDoc.getText('file:utils.go');
	const gFile3 = guestDoc.getText('file:config.json');

	assert(gFile1.toString() === hFile1.toString(), 'main.go synced');
	assert(gFile2.toString() === hFile2.toString(), 'utils.go synced');
	assert(gFile3.toString() === hFile3.toString(), 'config.json synced');
	console.log(`  main.go: "${gFile1.toString().substring(0, 30)}..."`);
	console.log(`  utils.go: "${gFile2.toString().substring(0, 30)}..."`);
	console.log(`  config.json: "${gFile3.toString()}"`);

	hostProv.destroy(); guestProv.destroy();
	hostWs.close(); guestWs.close();
	hostDoc.destroy(); guestDoc.destroy();
}

async function testConcurrentDifferentFiles(): Promise<void> {
	console.log('\nMulti-text: concurrent edits on different files');
	const session = await createSession();

	const hostDoc = new Y.Doc();
	const hostWs = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Host', host: 'h' });
	const hostProv = createProvider(hostDoc, hostWs);

	const hFile1 = hostDoc.getText('file:a.go');
	const hFile2 = hostDoc.getText('file:b.go');
	hFile1.insert(0, 'aaa');
	hFile2.insert(0, 'bbb');

	const guestDoc = new Y.Doc();
	const guestWs = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Guest', host: 'g' });
	const guestProv = createProvider(guestDoc, guestWs);
	await sleep(500);

	const gFile1 = guestDoc.getText('file:a.go');
	const gFile2 = guestDoc.getText('file:b.go');

	for (let i = 0; i < 50; i++) {
		hostDoc.transact(() => hFile1.insert(hFile1.length, 'H'), 'local');
		guestDoc.transact(() => gFile2.insert(gFile2.length, 'G'), 'local');
	}
	await sleep(1000);

	assert(hFile1.toString() === gFile1.toString(), 'file a converged');
	assert(hFile2.toString() === gFile2.toString(), 'file b converged');
	assert(hFile1.toString().includes('aaa'), 'file a has original');
	assert(hFile2.toString().includes('bbb'), 'file b has original');
	assert((hFile1.toString().match(/H/g) || []).length === 50, 'file a has 50 H\'s');
	assert((hFile2.toString().match(/G/g) || []).length === 50, 'file b has 50 G\'s');
	assert(!(hFile1.toString().includes('G')), 'file a has no G\'s (no cross-file leak)');
	assert(!(hFile2.toString().includes('H')), 'file b has no H\'s (no cross-file leak)');

	console.log(`  a.go: "${hFile1.toString().substring(0, 20)}..." (${hFile1.length} chars)`);
	console.log(`  b.go: "${hFile2.toString().substring(0, 20)}..." (${hFile2.length} chars)`);

	hostProv.destroy(); guestProv.destroy();
	hostWs.close(); guestWs.close();
	hostDoc.destroy(); guestDoc.destroy();
}

async function testConcurrentSameFile(): Promise<void> {
	console.log('\nMulti-text: concurrent edits on same file');
	const session = await createSession();

	const hostDoc = new Y.Doc();
	const hostWs = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Host', host: 'h' });
	const hostProv = createProvider(hostDoc, hostWs);

	const hFile = hostDoc.getText('file:shared.go');
	hFile.insert(0, 'start');

	const guestDoc = new Y.Doc();
	const guestWs = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Guest', host: 'g' });
	const guestProv = createProvider(guestDoc, guestWs);
	await sleep(500);

	const gFile = guestDoc.getText('file:shared.go');
	assert(gFile.toString() === 'start', 'guest has initial');

	for (let i = 0; i < 30; i++) {
		hostDoc.transact(() => hFile.insert(hFile.length, 'H'), 'local');
		guestDoc.transact(() => gFile.insert(gFile.length, 'G'), 'local');
	}
	await sleep(1000);

	assert(hFile.toString() === gFile.toString(), 'same file converged');
	assert(hFile.length === 5 + 60, `length is ${hFile.length} (start + 30H + 30G)`);
	console.log(`  shared.go: "${hFile.toString().substring(0, 30)}..." (${hFile.length} chars)`);

	hostProv.destroy(); guestProv.destroy();
	hostWs.close(); guestWs.close();
	hostDoc.destroy(); guestDoc.destroy();
}

async function testLateFileAdd(): Promise<void> {
	console.log('\nMulti-text: host adds file mid-session');
	const session = await createSession();

	const hostDoc = new Y.Doc();
	const hostWs = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Host', host: 'h' });
	const hostProv = createProvider(hostDoc, hostWs);

	const hFile1 = hostDoc.getText('file:first.go');
	hFile1.insert(0, 'first file content');

	const guestDoc = new Y.Doc();
	const guestWs = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Guest', host: 'g' });
	const guestProv = createProvider(guestDoc, guestWs);
	await sleep(500);

	assert(guestDoc.getText('file:first.go').toString() === 'first file content', 'guest has first file');

	const hFile2 = hostDoc.getText('file:second.go');
	hFile2.insert(0, 'second file content');
	await sleep(500);

	assert(guestDoc.getText('file:second.go').toString() === 'second file content', 'guest got late-added file');

	const hFile3 = hostDoc.getText('file:third.go');
	hFile3.insert(0, 'third file content');
	await sleep(500);

	assert(guestDoc.getText('file:third.go').toString() === 'third file content', 'guest got third file');

	assert(guestDoc.getText('file:first.go').toString() === hFile1.toString(), 'first still matches');
	assert(guestDoc.getText('file:second.go').toString() === hFile2.toString(), 'second matches');
	assert(guestDoc.getText('file:third.go').toString() === hFile3.toString(), 'third matches');

	console.log(`  3 files synced, all match`);

	hostProv.destroy(); guestProv.destroy();
	hostWs.close(); guestWs.close();
	hostDoc.destroy(); guestDoc.destroy();
}

function testUndoPerFile(): void {
	console.log('\nMulti-text: undo scoped per file');
	const doc = new Y.Doc();
	const file1 = doc.getText('file:a.go');
	const file2 = doc.getText('file:b.go');

	const undo1 = new Y.UndoManager(file1, { trackedOrigins: new Set(['local']), captureTimeout: 0 });
	const undo2 = new Y.UndoManager(file2, { trackedOrigins: new Set(['local']), captureTimeout: 0 });

	doc.transact(() => file1.insert(0, 'AAA'), 'local');
	doc.transact(() => file2.insert(0, 'BBB'), 'local');
	doc.transact(() => file1.insert(3, '_CCC'), 'local');
	doc.transact(() => file2.insert(3, '_DDD'), 'local');

	assert(file1.toString() === 'AAA_CCC', 'file1 before undo');
	assert(file2.toString() === 'BBB_DDD', 'file2 before undo');

	undo1.undo();
	assert(file1.toString() === 'AAA', 'file1 after undo: _CCC removed');
	assert(file2.toString() === 'BBB_DDD', 'file2 unchanged by file1 undo');

	undo2.undo();
	assert(file1.toString() === 'AAA', 'file1 still unchanged');
	assert(file2.toString() === 'BBB', 'file2 after undo: _DDD removed');

	undo1.redo();
	undo2.redo();
	assert(file1.toString() === 'AAA_CCC', 'file1 redo');
	assert(file2.toString() === 'BBB_DDD', 'file2 redo');

	doc.destroy();
}

async function testFiveFileStress(): Promise<void> {
	console.log('\nMulti-text: 5 files, 50 ops each, concurrent');
	const session = await createSession();

	const hostDoc = new Y.Doc();
	const hostWs = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Host', host: 'h' });
	const hostProv = createProvider(hostDoc, hostWs);

	const fileNames: string[] = ['a.go', 'b.go', 'c.go', 'd.go', 'e.go'];
	const hostTexts = fileNames.map((f: string) => {
		const t = hostDoc.getText(`file:${f}`);
		t.insert(0, `// ${f}\n`);
		return t;
	});

	const guestDoc = new Y.Doc();
	const guestWs = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Guest', host: 'g' });
	const guestProv = createProvider(guestDoc, guestWs);
	await sleep(1000);

	const guestTexts = fileNames.map((f: string) => guestDoc.getText(`file:${f}`));

	for (let i = 0; i < 50; i++) {
		for (let f = 0; f < 5; f++) {
			hostDoc.transact(() => hostTexts[f].insert(hostTexts[f].length, 'H'), 'local');
			guestDoc.transact(() => guestTexts[f].insert(guestTexts[f].length, 'G'), 'local');
		}
	}
	await sleep(3000);

	let allMatch = true;
	for (let f = 0; f < 5; f++) {
		if (hostTexts[f].toString() !== guestTexts[f].toString()) {
			allMatch = false;
			console.error(`  MISMATCH on ${fileNames[f]}: host=${hostTexts[f].length} guest=${guestTexts[f].length}`);
		}
	}
	assert(allMatch, 'all 5 files converged');

	for (let f = 0; f < 5; f++) {
		const content = hostTexts[f].toString();
		assert(content.startsWith(`// ${fileNames[f]}`), `${fileNames[f]} has correct header`);
		assert((content.match(/H/g) || []).length === 50, `${fileNames[f]} has 50 H's`);
		assert((content.match(/G/g) || []).length === 50, `${fileNames[f]} has 50 G's`);
	}

	console.log(`  5 files x 100 ops each = 500 total ops, all converged`);

	hostProv.destroy(); guestProv.destroy();
	hostWs.close(); guestWs.close();
	hostDoc.destroy(); guestDoc.destroy();
}

async function testGuestDetectsNewKeys(): Promise<void> {
	console.log('\nMulti-text: guest detects new file keys');
	const session = await createSession();

	const hostDoc = new Y.Doc();
	const hostWs = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Host', host: 'h' });
	const hostProv = createProvider(hostDoc, hostWs);

	const guestDoc = new Y.Doc();
	const guestWs = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Guest', host: 'g' });
	const guestProv = createProvider(guestDoc, guestWs);
	await sleep(500);

	hostDoc.getText('file:first.go').insert(0, 'first');
	await sleep(300);

	hostDoc.getText('file:second.go').insert(0, 'second');
	await sleep(300);

	hostDoc.getText('file:third.go').insert(0, 'third');
	await sleep(300);

	const keys = Array.from(guestDoc.share.keys()).filter((k: string) => k.startsWith('file:'));
	assert(keys.length === 3, `guest sees 3 file keys, got ${keys.length}`);
	assert(keys.includes('file:first.go'), 'has first.go');
	assert(keys.includes('file:second.go'), 'has second.go');
	assert(keys.includes('file:third.go'), 'has third.go');

	assert(guestDoc.getText('file:first.go').toString() === 'first', 'first content');
	assert(guestDoc.getText('file:second.go').toString() === 'second', 'second content');
	assert(guestDoc.getText('file:third.go').toString() === 'third', 'third content');

	console.log(`  guest detected keys: ${keys.join(', ')}`);

	hostProv.destroy(); guestProv.destroy();
	hostWs.close(); guestWs.close();
	hostDoc.destroy(); guestDoc.destroy();
}

async function main(): Promise<void> {
	console.log('  ZeroPR Multi-File Session Tests\n');

	testLocalMultiText();
	testUndoPerFile();

	await testMultiTextSync();
	await testConcurrentDifferentFiles();
	await testConcurrentSameFile();
	await testLateFileAdd();
	await testFiveFileStress();
	await testGuestDetectsNewKeys();

	printResults('multifile');
}

main().catch((err: Error) => { console.error('FATAL:', err); process.exit(1); });
