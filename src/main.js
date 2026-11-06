import './style.css';
import story from './data/story.json';
import { buildCues, buildFleet, layout, formation } from './cues.js';

document.body.classList.remove('no-js');
const params = new URLSearchParams(location.search);
let canvas = document.getElementById('sky');
const cues = buildCues(story);
const fleet = buildFleet(story);
const sections = cues.map((c) => document.getElementById('cue-' + c.id));
const panels = sections.map((s) => s?.querySelector('.panel'));
const links = [...document.querySelectorAll('.cues a')];
const tip = document.getElementById('tip');
const chapterTitle = new Map(story.chapters.map((c) => [c.id, c.title]));
let engine = null;
let active = -1;

/**
 * Opens the show's WebGL2 context on the real canvas (three.js reuses it) and classifies the GPU:
 * 'soft' for software rasterisers (SwiftShader, llvmpipe…), else 'gpu'; 'none' without WebGL2.
 */
function openGL(cv) {
  try {
    const small = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
    const gl = cv.getContext('webgl2', { alpha: true, antialias: !small, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) return { tier: 'none', gl: null };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    return { tier: /swiftshader|llvmpipe|softpipe|software|basic render|lavapipe/i.test(r) ? 'soft' : 'gpu', gl };
  } catch { return { tier: 'none', gl: null }; }
}
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const show3d = !reduce && !params.has('flat') && typeof WebGL2RenderingContext !== 'undefined';
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
requestAnimationFrame(measureBar);
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
requestAnimationFrame(pick);

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
  const { tier, gl } = mod ? openGL(canvas) : { tier: 'none', gl: null };
  const ctx = { canvas, cues, fleet, layout, formation, params, tier, gl, glb, onIntroEnd: endIntro };
  if (mod && gl) {
    try { engine = await (await mod).start(ctx); document.body.classList.add('show3d'); } catch (e) { console.warn('WebGL show failed, using 2D', e); }
  }
  if (!engine) {
    endIntro();
    if (gl) { const c = canvas.cloneNode(false); canvas.replaceWith(c); canvas = c; } // a canvas holds one context type
    engine = await (await import('./flat.js')).start({ ...ctx, canvas });
  }
  const i = active; active = -1; setActive(i);
}
// first paint is the static page; the show loads right after
requestAnimationFrame(() => setTimeout(boot, 0));
