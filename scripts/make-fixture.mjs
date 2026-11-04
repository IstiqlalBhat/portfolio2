// Generates a CLEARLY FAKE story.json fixture for local development.
// The real src/data/story.json is produced elsewhere and overwrites this file.
// Usage: node scripts/make-fixture.mjs
import { writeFileSync } from 'node:fs';

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const lorem = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat'.split(' ');
const words = (n) => Array.from({ length: n }, () => pick(lorem)).join(' ');
const sentence = (n) => { const w = words(n); return w[0].toUpperCase() + w.slice(1) + '.'; };

const start = new Date('2023-01-02T00:00:00Z');
const end = new Date('2026-10-30T00:00:00Z');
const DAY = 86400000;
const totalDays = Math.round((end - start) / DAY);
const ym = (d) => d.toISOString().slice(0, 7);

const chapterDefs = [
  { id: 'fixture-one', title: 'Lorem Foundations', color: '#5eead4', from: 0, to: 0.18 },
  { id: 'fixture-two', title: 'Ipsum at Scale', color: '#818cf8', from: 0.18, to: 0.42 },
  { id: 'fixture-three', title: 'Dolor Pipelines', color: '#f472b6', from: 0.42, to: 0.63 },
  { id: 'fixture-four', title: 'Amet Agents', color: '#fbbf24', from: 0.63, to: 0.84 },
  { id: 'fixture-five', title: 'Consectetur Now', color: '#60a5fa', from: 0.84, to: 1 },
];
const stacks = ['Python', 'TypeScript', 'React', 'FastAPI', 'pgvector', 'Postgres', 'Docker', 'Next.js', 'LangChain', 'Go', 'Redis', 'three.js', 'Rust', 'Kubernetes'];

const repos = [];
const days = new Map(); // key day|repo -> count
let rid = 0;
chapterDefs.forEach((c, ci) => {
  const n = [5, 7, 6, 7, 5][ci];
  for (let k = 0; k < n; k++) {
    const pub = rnd() > 0.4;
    const id = rid++;
    const name = pub ? `fixture-repo-${id}` : `Private · ${words(2)} platform`;
    const a = c.from + (c.to - c.from) * rnd() * 0.6;
    const b = Math.min(1, a + (c.to - c.from) * (0.25 + rnd() * 0.9));
    const target = Math.round(30 + rnd() ** 2 * 260);
    let count = 0;
    for (let i = 0; i < target; i++) {
      // bursty: cluster around a few centres
      const centre = a + (b - a) * rnd();
      const t = Math.min(1, Math.max(0, centre + (rnd() - 0.5) * 0.02));
      const d = Math.round(t * totalDays);
      const key = d + '|' + id;
      days.set(key, (days.get(key) || 0) + 1);
      count++;
    }
    repos.push({
      id, label: name, public: pub, url: pub ? `https://github.com/example/${name}` : null,
      description: sentence(6 + Math.floor(rnd() * 5)),
      stack: Array.from(new Set([pick(stacks), pick(stacks), pick(stacks)])),
      chapter: c.id, commits: count,
    });
  }
});
const dayArr = [...days.entries()].map(([k, v]) => { const [d, r] = k.split('|').map(Number); return [d, r, v]; })
  .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
const total = dayArr.reduce((s, x) => s + x[2], 0);

const chapters = chapterDefs.map((c, i) => ({
  id: c.id, index: i + 1, title: c.title,
  period: { start: ym(new Date(start.getTime() + c.from * totalDays * DAY)), end: ym(new Date(start.getTime() + c.to * totalDays * DAY)) },
  kicker: sentence(8),
  narrative: [sentence(18), sentence(14), sentence(16)].join(' '),
  impact: [0, 1, 2].map(() => ({ claim: sentence(10 + Math.floor(rnd() * 6)), evidence: ['E0'] })),
  metrics: [
    { value: String(repos.filter((r) => r.chapter === c.id).reduce((s, r) => s + r.commits, 0)), label: 'commits' },
    { value: String(20 + Math.floor(rnd() * 120)), label: 'PRs merged' },
    { value: String(repos.filter((r) => r.chapter === c.id).length), label: 'repos' },
  ],
  stack: Array.from(new Set(Array.from({ length: 6 }, () => pick(stacks)))),
  repoIds: repos.filter((r) => r.chapter === c.id).map((r) => r.id),
  color: c.color,
}));

const story = {
  version: 1,
  generatedAt: new Date('2026-11-01T00:00:00Z').toISOString(),
  person: {
    name: 'Fixture Person', handle: 'example', role: 'Lorem Engineer',
    githubUrl: 'https://github.com/example',
    hook: 'FIXTURE: lorem ipsum dolor sit amet, consectetur adipiscing elit.',
    subhook: 'Placeholder data for layout testing. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua, ut enim ad minim veniam.',
  },
  headline: [
    { value: total.toLocaleString('en-US'), label: 'commits', evidence: 'fixture' },
    { value: '312', label: 'PRs merged', evidence: 'fixture' },
    { value: String(repos.length), label: 'repositories', evidence: 'fixture' },
    { value: '4 yrs', label: 'shipping', evidence: 'fixture' },
  ],
  repos,
  timeline: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), days: dayArr },
  chapters,
  skills: stacks.slice(0, 8).map((n, i) => ({ name: n, weight: +(1 - i * 0.1).toFixed(2) })),
  cta: { line: 'FIXTURE: lorem ipsum dolor sit amet — let us build something.', githubUrl: 'https://github.com/example' },
};
writeFileSync(new URL('../src/data/story.json', import.meta.url), JSON.stringify(story));
console.log('fixture written:', total, 'commits,', repos.length, 'repos,', dayArr.length, 'day rows');
