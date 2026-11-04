// Fails the build if total gzipped JS in dist/ exceeds the budget.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET = 400 * 1024;
const dist = new URL('../dist/', import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(m?js)$/.test(f)) files.push(p);
  }
})(dist);
let total = 0;
for (const f of files) {
  const raw = readFileSync(f);
  const gz = gzipSync(raw, { level: 9 }).length;
  total += gz;
  console.log(`${(raw.length / 1024).toFixed(1).padStart(8)} KB raw ${(gz / 1024).toFixed(1).padStart(8)} KB gz  ${f.slice(dist.length)}`);
}
console.log(`Total JS gzipped: ${(total / 1024).toFixed(1)} KB (budget ${BUDGET / 1024} KB)`);
if (!files.length) { console.error('size-check: no JS found in dist/'); process.exit(1); }
if (total > BUDGET) { console.error('size-check: FAIL — over budget'); process.exit(1); }
console.log('size-check: OK');
