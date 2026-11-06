// Fails the build if total gzipped JS exceeds the 400 KB budget; reports 3D asset size.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = new URL('../dist/', import.meta.url).pathname;
// designs/ holds separately budgeted tournament previews; only the main site counts here.
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? (join(d, f) === join(dist, 'designs') ? [] : walk(join(d, f))) : [join(d, f)]));
const files = walk(dist);
let js = 0;
for (const f of files.filter((f) => f.endsWith('.js'))) {
  const gz = gzipSync(readFileSync(f), { level: 9 }).length;
  js += gz;
  console.log(`${(gz / 1024).toFixed(1).padStart(7)} KB gz  ${f.slice(dist.length)}`);
}
const glb = files.filter((f) => f.endsWith('.glb')).reduce((s, f) => s + statSync(f).size, 0);
console.log(`JS total ${(js / 1024).toFixed(1)} KB gz (budget 400) · 3D assets ${(glb / 1024).toFixed(1)} KB (budget 1536)`);
if (js > 400 * 1024 || glb > 1536 * 1024) { console.error('over budget'); process.exit(1); }
