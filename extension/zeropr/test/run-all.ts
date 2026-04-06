import { execFileSync } from 'child_process';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));
const suites = readdirSync(dir)
    .filter(f => f.endsWith('.test.ts'))
    .sort();

interface Result {
    name: string;
    status: 'PASS' | 'FAIL';
    duration: number;
}

const results: Result[] = [];

for (const suite of suites) {
    const name = suite.replace('.test.ts', '');
    const path = join(dir, suite);
    const start = Date.now();

    try {
        execFileSync('tsx', [path], { stdio: 'inherit', timeout: 120_000 });
        results.push({ name, status: 'PASS', duration: Date.now() - start });
    } catch {
        results.push({ name, status: 'FAIL', duration: Date.now() - start });
    }

    console.log('');
}

console.log('\nSummary');

const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;

for (const r of results) {
    const icon = r.status === 'PASS' ? 'OK' : 'FAIL';
    console.log(`  [${icon}] ${r.name} (${(r.duration / 1000).toFixed(1)}s)`);
}

console.log('');
console.log(`  ${passed} passed, ${failed} failed out of ${suites.length} suites`);

process.exit(failed > 0 ? 1 : 0);
