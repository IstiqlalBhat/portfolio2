import './style.css';
import { chapters, repos, timeline, person, cta, headline } from './data/story.json';
import { buildCues, buildFleet, layout, formation } from './cues.js';

const story = { chapters, repos, timeline, person, cta, headline };
document.body.classList.remove('no-js');
const params = new URLSearchParams(location.search);
const canvas = document.getElementById('sky');
const cues = buildCues(story);
const fleet = buildFleet(story);
const sections = cues.map((c) => document.getElementById('cue-' + c.id));
const panels = sections.map((s) => s?.querySelector('.panel'));
const links = [...document.querySelectorAll('.cues a')];
const tip = document.getElementById('tip');
const chapterTitle = new Map(story.chapters.map((c) => [c.id, c.title]));
let engine = null;
let active = -1;

/** 'none' (no WebGL2), 'soft' (software rasteriser: SwiftShader, llvmpipe…) or 'gpu'. */
function gpuTier() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'none';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render|lavapipe/i.test(r) ? 'soft' : 'gpu';
  } catch { return 'none'; }
}
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const tier = reduce || params.has('flat') ? 'none' : gpuTier();
const show3d = tier !== 'none';
// the header waits for the take-off; it comes back at the end of the intro (or on the first scroll)
if (show3d) document.body.classList.add('intro');
const endIntro = () => document.body.classList.remove('intro');
setTimeout(endIntro, 9000);

function setActive(i) {
  if (i === active) return;
  active = i;
  document.body.dataset.cue = cues[i].id;
  links.forEach((a, k) => {
    if (k === i) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current');
    a.classList.toggle('done', k < i);
  });
  if (i > 0) endIntro();
  hideTip();
  engine?.setCue(i);
}

// panels fade out under the header, and on phones above the stage line so the formation stays in view
let L = layout(innerWidth, innerHeight);
let barBottom = 0;
const measureBar = () => { barBottom = (document.querySelector('.bar')?.getBoundingClientRect().bottom || 0) + 6; };
measureBar();
function fade() {
  const top = L.mobile ? Math.max(L.stage, barBottom) : barBottom;
  const rects = panels.map((p) => (p ? p.getBoundingClientRect() : null));
  panels.forEach((p, k) => {
    const r = rects[k];
    if (!r) return;
    const cut = top - r.top;
    if (cut > -64 && r.bottom > 0 && r.top < innerHeight) { p.classList.add('fading'); p.style.setProperty('--cut', Math.round(cut - 56) + 'px'); } else if (p.classList.contains('fading')) p.classList.remove('fading');
  });
}

let queued = false;
function pick() {
  queued = false;
  const y = innerHeight * 0.6;
  let idx = 0;
  sections.forEach((s, k) => { if (s && s.getBoundingClientRect().top < y) idx = k; });
  setActive(idx);
  fade();
}
addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(pick); } }, { passive: true });
addEventListener('resize', () => { L = layout(innerWidth, innerHeight); measureBar(); pick(); }, { passive: true });
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
  tip.style.top = Math.max(64, s.cy - s.r - th - 10) + 'px';
  engine?.highlight(r.id);
}
addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') probe(e.clientX, e.clientY); }, { passive: true });
addEventListener('pointerdown', (e) => {
  if (e.target.closest('a, summary, button, .panel')) return;
  probe(e.clientX, e.clientY);
}, { passive: true });

async function boot() {
  // the show's code and the drone model download while the display font settles
  const mod = show3d ? import('./swarm.js') : null;
  const glb = show3d ? fetch(new URL('./assets/drone.glb', document.baseURI)).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null) : null;
  await Promise.race([document.fonts.load('900 100px Archivo'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
  const ctx = { canvas, cues, fleet, layout, formation, params, tier, glb, onIntroEnd: endIntro };
  if (mod) {
    try { engine = await (await mod).start(ctx); } catch (e) { console.warn('WebGL show failed, using 2D', e); }
  }
  if (!engine) { endIntro(); engine = await (await import('./flat.js')).start(ctx); }
  const i = active; active = -1; setActive(i);
}
// first paint is the static page; the show loads right after
requestAnimationFrame(() => setTimeout(boot, 0));
