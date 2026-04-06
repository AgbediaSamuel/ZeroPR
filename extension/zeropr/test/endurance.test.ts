// 30-second endurance test
import { assert, sleep, createProviderWithAwareness, connectWs, printResults, AGENT, Y } from './helpers';

async function main(): Promise<void> {
	console.log('  ZeroPR 30-Second Endurance Test\n');

	const res = await fetch(`${AGENT}/api/session/create`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ host: 'test', role: 'Host', filepath: 'test.go' })
	});
	const session = await res.json();
	console.log(`\nSession: ${session.id}`);

	console.log('\nPhase 1: Setup');
	const hostDoc = new Y.Doc();
	const hostWs = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Host', host: 'h' });
	const hostProv = createProviderWithAwareness(hostDoc, hostWs);

	const files: string[] = ['main.go', 'utils.go', 'config.json'];
	const initialContent: Record<string, string> = {
		'main.go': 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello")\n}\n',
		'utils.go': 'package main\n\nfunc add(a, b int) int {\n\treturn a + b\n}\n\nfunc sub(a, b int) int {\n\treturn a - b\n}\n',
		'config.json': '{\n\t"port": 9080,\n\t"host": "localhost",\n\t"debug": false\n}\n'
	};

	for (const f of files) {
		hostDoc.getText(`file:${f}`).insert(0, initialContent[f]);
	}

	const hostUndoManagers: Record<string, any> = {};
	for (const f of files) {
		hostUndoManagers[f] = new Y.UndoManager(hostDoc.getText(`file:${f}`), {
			trackedOrigins: new Set(['local']),
			captureTimeout: 0
		});
	}

	const guestDoc = new Y.Doc();
	const guestWs = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Guest', host: 'g' });
	const guestProv = createProviderWithAwareness(guestDoc, guestWs);
	await sleep(1000);

	for (const f of files) {
		assert(guestDoc.getText(`file:${f}`).toString() === initialContent[f], `initial sync: ${f}`);
	}
	console.log('  Initial sync: 3 files synced');

	hostProv.awareness.setLocalStateField('user', { name: 'Host' });
	hostProv.awareness.setLocalStateField('cursor', { anchor: 0, head: 0, name: 'Host' });
	guestProv.awareness.setLocalStateField('user', { name: 'Guest' });
	guestProv.awareness.setLocalStateField('cursor', { anchor: 0, head: 0, name: 'Guest' });
	await sleep(200);

	console.log('\nPhase 2: Sustained concurrent editing (13 seconds)');
	const startTime = Date.now();
	let hostOps = 0;
	let guestOps = 0;
	let cursorUpdates = 0;

	while (Date.now() - startTime < 13000) {
		const f = files[Math.floor(Math.random() * files.length)];
		const hostText = hostDoc.getText(`file:${f}`);
		const guestText = guestDoc.getText(`file:${f}`);

		const op = Math.random();

		if (op < 0.5) {
			const pos = Math.floor(Math.random() * (hostText.length + 1));
			const chars = 'abcdefghijklmnopqrstuvwxyz\n\t {}()[];';
			const ch = chars[Math.floor(Math.random() * chars.length)];
			hostDoc.transact(() => hostText.insert(pos, ch), 'local');
			hostOps++;
		} else if (op < 0.8 && hostText.length > 5) {
			const pos = Math.floor(Math.random() * (hostText.length - 1));
			const len = Math.min(1 + Math.floor(Math.random() * 3), hostText.length - pos);
			hostDoc.transact(() => hostText.delete(pos, len), 'local');
			hostOps++;
		} else if (op < 0.9) {
			hostUndoManagers[f].undo();
			hostOps++;
		} else {
			hostUndoManagers[f].redo();
			hostOps++;
		}

		if (guestText.length > 0) {
			const gOp = Math.random();
			if (gOp < 0.6) {
				const pos = Math.floor(Math.random() * (guestText.length + 1));
				guestDoc.transact(() => guestText.insert(pos, String.fromCharCode(65 + Math.floor(Math.random() * 26))), 'local');
				guestOps++;
			} else if (guestText.length > 3) {
				const pos = Math.floor(Math.random() * (guestText.length - 1));
				guestDoc.transact(() => guestText.delete(pos, 1), 'local');
				guestOps++;
			}
		}

		if ((hostOps + guestOps) % 5 === 0) {
			const hPos = Math.floor(Math.random() * Math.max(1, hostText.length));
			hostProv.awareness.setLocalStateField('cursor', { anchor: hPos, head: hPos, name: 'Host' });
			const gPos = Math.floor(Math.random() * Math.max(1, guestText.length));
			guestProv.awareness.setLocalStateField('cursor', { anchor: gPos, head: gPos + Math.floor(Math.random() * 10), name: 'Guest' });
			cursorUpdates++;
		}

		await sleep(15);
	}

	console.log(`  Host: ${hostOps} ops, Guest: ${guestOps} ops, Cursor updates: ${cursorUpdates}`);
	await sleep(2000);

	let phase2Match = true;
	for (const f of files) {
		const h = hostDoc.getText(`file:${f}`).toString();
		const g = guestDoc.getText(`file:${f}`).toString();
		if (h !== g) {
			phase2Match = false;
			console.error(`  DIVERGED on ${f}: host=${h.length} guest=${g.length}`);
		}
	}
	assert(phase2Match, 'all files converge after 13s of concurrent editing');

	console.log('\nPhase 3: Add file mid-session');
	const newFileContent = 'package main\n\n// added during session\nfunc newFunc() {\n\treturn\n}\n';
	hostDoc.getText('file:handler.go').insert(0, newFileContent);
	files.push('handler.go');
	hostUndoManagers['handler.go'] = new Y.UndoManager(hostDoc.getText('file:handler.go'), {
		trackedOrigins: new Set(['local']),
		captureTimeout: 0
	});
	await sleep(1000);

	assert(guestDoc.getText('file:handler.go').toString() === newFileContent, 'guest got new file');
	console.log('  handler.go added and synced');

	console.log('\nPhase 4: Guest disconnect + host edits + rejoin');
	guestProv.destroy();
	guestWs.close();
	await sleep(500);

	for (let i = 0; i < 20; i++) {
		const f = files[Math.floor(Math.random() * files.length)];
		const t = hostDoc.getText(`file:${f}`);
		hostDoc.transact(() => t.insert(t.length, `_offline${i}_`), 'local');
	}

	hostProv.destroy();
	hostWs.close();
	await sleep(300);
	const hostWs2 = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Host', host: 'h' });
	const hostProv2 = createProviderWithAwareness(hostDoc, hostWs2);
	await sleep(300);

	const guestDoc2 = new Y.Doc();
	const guestWs2 = await connectWs(`ws://localhost:9080/ws/session/${session.id}`, { id: session.id, role: 'Guest', host: 'g' });
	const guestProv2 = createProviderWithAwareness(guestDoc2, guestWs2);
	await sleep(2000);

	let phase4Match = true;
	for (const f of files) {
		const h = hostDoc.getText(`file:${f}`).toString();
		const g = guestDoc2.getText(`file:${f}`).toString();
		if (h !== g) {
			phase4Match = false;
			console.error(`  DIVERGED after rejoin on ${f}: host=${h.length} guest=${g.length}`);
		}
	}
	assert(phase4Match, 'all files converge after rejoin');
	console.log('  Guest rejoined, all files synced (including offline edits)');

	console.log('\nPhase 5: Post-rejoin concurrent editing (5 seconds)');
	const phase5Start = Date.now();
	let p5HostOps = 0;
	let p5GuestOps = 0;

	while (Date.now() - phase5Start < 5000) {
		const f = files[Math.floor(Math.random() * files.length)];
		const hostText = hostDoc.getText(`file:${f}`);
		const guestText = guestDoc2.getText(`file:${f}`);

		if (hostText.length > 5) {
			const pos = Math.floor(Math.random() * hostText.length);
			hostDoc.transact(() => hostText.insert(pos, '*'), 'local');
			p5HostOps++;
		}
		if (guestText.length > 5) {
			const pos = Math.floor(Math.random() * guestText.length);
			guestDoc2.transact(() => guestText.insert(pos, '#'), 'local');
			p5GuestOps++;
		}

		await sleep(15);
	}

	console.log(`  Host: ${p5HostOps} ops, Guest: ${p5GuestOps} ops`);
	await sleep(2000);

	let phase5Match = true;
	for (const f of files) {
		const h = hostDoc.getText(`file:${f}`).toString();
		const g = guestDoc2.getText(`file:${f}`).toString();
		if (h !== g) {
			phase5Match = false;
			console.error(`  DIVERGED post-rejoin on ${f}: host=${h.length} guest=${g.length}`);
		}
	}
	assert(phase5Match, 'all files converge after post-rejoin editing');

	console.log('\nPhase 6: Final verification');

	hostProv2.awareness.setLocalStateField('cursor', { anchor: 999, head: 999, name: 'Host' });
	guestProv2.awareness.setLocalStateField('cursor', { anchor: 888, head: 888, name: 'Guest' });
	await sleep(500);

	const guestSeesHost = guestProv2.awareness.getStates().get(hostDoc.clientID);
	const hostSeesGuest = hostProv2.awareness.getStates().get(guestDoc2.clientID);

	assert(guestSeesHost?.cursor?.anchor === 999, 'guest sees host cursor after full test');
	assert(hostSeesGuest?.cursor?.anchor === 888, 'host sees guest cursor after full test');

	let totalChars = 0;
	for (const f of files) {
		const h = hostDoc.getText(`file:${f}`);
		const g = guestDoc2.getText(`file:${f}`);
		assert(h.toString() === g.toString(), `final match: ${f}`);
		totalChars += h.length;
	}

	const totalOps = hostOps + guestOps + p5HostOps + p5GuestOps + 20;
	console.log(`\n  Total operations: ${totalOps}`);
	console.log(`  Total files: ${files.length}`);
	console.log(`  Total chars across all files: ${totalChars}`);
	console.log(`  Cursor updates: ${cursorUpdates}`);
	console.log(`  Reconnections: 1`);
	console.log(`  Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

	hostProv2.destroy();
	guestProv2.destroy();
	hostWs2.close();
	guestWs2.close();
	hostDoc.destroy();
	guestDoc2.destroy();

	printResults('endurance');
}

main().catch((err: Error) => { console.error('FATAL:', err); process.exit(1); });
