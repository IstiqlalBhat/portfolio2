import './style.css';
import { chapters, repos, timeline, person, cta } from './data/story.json';
import { buildCues, buildFleet, layout, formation } from './cues.js';

const story = { chapters, repos, timeline, person, cta };
document.body.classList.remove('no-js');
const params = new URLSearchParams(location.search);
const canvas = document.getElementById('sky');
const cues = buildCues(story);
const fleet = buildFleet(story);
const sections = cues.map((c) => document.getElementById('cue-' + c.id));
const links = [...document.querySelectorAll('.cues a')];
const tip = document.getElementById('tip');
const chapterTitle = new Map(story.chapters.map((c) => [c.id, c.title]));
let engine = null;
let active = -1;

function setActive(i) {
  if (i === active) return;
  active = i;
  document.body.dataset.cue = cues[i].id;
  links.forEach((a, k) => {
    if (k === i) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current');
    a.classList.toggle('done', k < i);
  });
  hideTip();
  engine?.setCue(i);
}

let queued = false;
function pick() {
  queued = false;
  const y = innerHeight * 0.6;
  let idx = 0;
  sections.forEach((s, k) => { if (s && s.getBoundingClientRect().top < y) idx = k; });
  setActive(idx);
}
addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(pick); } }, { passive: true });
pick();

// fleet: what is this squadron?
function hideTip() { tip.hidden = true; engine?.highlight(null); }
function squadAt(x, y) {
  let best = null, bd = Infinity;
  for (const s of fleet.squads) {
    if (s.cx == null) continue;
    const d = Math.hypot(x - s.cx, y - s.cy) - s.r;
    if (d < bd) { bd = d; best = s; }
  }
  return bd < 14 ? best : null;
}
function probe(x, y) {
  if (cues[active]?.kind !== 'fleet') return;
  const s = squadAt(x, y);
  if (!s) { hideTip(); return; }
  const r = s.repo;
  tip.innerHTML = '';
  const b = document.createElement('b'); b.textContent = r.label;
  const d = document.createElement('span'); d.textContent = r.description;
  const m = document.createElement('i');
  m.textContent = `${s.count.toLocaleString('en-US')} ${s.count === 1 ? 'commit' : 'commits'}, ${chapterTitle.get(r.chapter) || ''}`;
  tip.append(b, d, m);
  tip.hidden = false;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = Math.max(12, Math.min(innerWidth - tw - 12, s.cx - tw / 2)) + 'px';
  tip.style.top = Math.max(56, s.cy - s.r - th - 10) + 'px';
  engine?.highlight(r.id);
}
addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') probe(e.clientX, e.clientY); }, { passive: true });
addEventListener('pointerdown', (e) => {
  if (e.target.closest('a, summary, button, .panel')) return;
  probe(e.clientX, e.clientY);
}, { passive: true });

function webgl() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

async function boot() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  await Promise.race([document.fonts.load('900 100px Archivo'), new Promise((r) => setTimeout(r, 1800))]).catch(() => {});
  const ctx = { canvas, cues, fleet, layout, formation, params };
  if (webgl() && !reduce && !params.has('flat')) {
    try { engine = await (await import('./swarm.js')).start(ctx); } catch (e) { console.warn('WebGL show failed, using 2D', e); }
  }
  if (!engine) engine = await (await import('./flat.js')).start(ctx);
  const i = active; active = -1; setActive(i);
}
// first paint is the static page; the show loads right after
requestAnimationFrame(() => setTimeout(boot, 0));
