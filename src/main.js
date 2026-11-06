import './style.css';
import story from './data/story.json';
import fontUrl from './fonts/archivo-latin-var.woff2?url';
import { buildCues, buildFleet, layout, formation, chapterZoom } from './cues.js';

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
 * Classifies the GPU on a throwaway canvas: 'soft' for software rasterisers (SwiftShader, llvmpipe…),
 * else 'gpu'; null without WebGL2. Multisampling is nearly free on a GPU but multiplies the fill cost
 * of a software rasteriser, so only GPUs on larger screens get it.
 */
const glOptions = (antialias) => ({ alpha: true, antialias, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
const coarse = () => matchMedia('(pointer: coarse)').matches;
function probeGL() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const soft = /swiftshader|llvmpipe|softpipe|software|basic render|lavapipe/i.test(r);
    const small = coarse() || Math.min(innerWidth, innerHeight) < 600;
    return { tier: soft ? 'soft' : 'gpu', antialias: !soft && !small };
  } catch { return null; }
}
const view = () => ({ w: innerWidth, h: innerHeight, dpr: window.devicePixelRatio || 1, coarse: coarse() });
const glbUrl = () => new URL('./assets/drone.glb', document.baseURI).href;
const freshCanvas = () => { const c = canvas.cloneNode(false); canvas.replaceWith(c); canvas = c; };
const onSquads = (list) => list.forEach(([cx, cy, r], k) => { const q = fleet.squads[k]; if (q) { q.cx = cx; q.cy = cy; q.r = r; } });

/**
 * The show renders in a worker on an OffscreenCanvas: the page's thread never waits on the GPU, so
 * scrolling and reading stay smooth while 3,415 drones fly. Resolves to a proxy engine, or null.
 */
function startWorker(probe) {
  return new Promise((resolve) => {
    let w = null, done = false;
    const fail = () => { if (done) return; done = true; try { w?.terminate(); } catch {} freshCanvas(); resolve(null); };
    try {
      w = new Worker(new URL('./show-worker.js', import.meta.url), { type: 'module' });
      const off = canvas.transferControlToOffscreen();
      // (no timeout: on a slow link the worker is merely late, and a fallback would download the show twice)
      w.onerror = fail;
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready' && !done) { done = true; resolve(proxy); }
        else if (m.type === 'failed') fail();
        else if (m.type === 'introEnd') endIntro();
        else if (m.type === 'squads') onSquads(m.s);
        else if (m.type === 'fps') window.__showFps = m.fps;
      };
      const proxy = {
        setCue: (i) => w.postMessage({ type: 'cue', i }),
        highlight: (id) => w.postMessage({ type: 'highlight', id }),
        pointer: (x, y) => w.postMessage({ type: 'pointer', x, y }),
        resize: (vw, vh, dpr) => w.postMessage({ type: 'resize', w: vw, h: vh, dpr }),
      };
      w.postMessage({ type: 'init', canvas: off, story, view: view(), tier: probe.tier, glOptions: glOptions(probe.antialias), search: location.search, fontUrl: new URL(fontUrl, document.baseURI).href, glbUrl: glbUrl() }, [off]);
    } catch { fail(); }
  });
}

/** Fallback where a worker cannot draw WebGL: the same show on the page's own thread. */
async function startInThread(probe) {
  try {
    const glb = fetch(glbUrl()).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    const gl = canvas.getContext('webgl2', glOptions(probe.antialias));
    if (!gl) return null;
    const mod = await import('./swarm.js');
    return await mod.start({ canvas, cues, fleet, layout, formation, chapterZoom, params, tier: probe.tier, gl, glb, glbUrl: glbUrl(), view: view(), onIntroEnd: endIntro, onSquads, onFps: params.has('debug') ? (fps) => { window.__showFps = fps; } : null });
  } catch (e) { console.warn('WebGL show failed, using 2D', e); freshCanvas(); return null; }
}
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const show3d = !reduce && !params.has('flat') && typeof WebGL2RenderingContext !== 'undefined';
// the header waits for the take-off (index.html sets the class before the first paint, so it never
// flashes); it comes back at the end of the intro (or on the first scroll)
const root = document.documentElement;
if (show3d) root.classList.add('intro'); else root.classList.remove('intro');
const endIntro = () => root.classList.remove('intro');
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
// the layout is computed in the first animation frame: reading the window size during module
// evaluation would force the page's first layout inside this script's task
let L = null;
let barBottom = 0;
// the record's time axis sits under the bar chart (same layout as the formation)
function placeAxis() {
  const c = L.chart;
  root.style.setProperty('--ax-x', c.x.toFixed(1) + 'px');
  root.style.setProperty('--ax-y', (c.y + c.h + (L.mobile ? 6 : 10)).toFixed(1) + 'px');
  root.style.setProperty('--ax-w', c.w.toFixed(1) + 'px');
}
const measureBar = () => { barBottom = (document.querySelector('.bar')?.getBoundingClientRect().bottom || 0) + 6; };
function fade() {
  const top = L.mobile ? Math.max(L.stage, barBottom) : barBottom;
  const rects = panels.map((p) => (p ? p.getBoundingClientRect() : null));
  panels.forEach((p, k) => {
    const r = rects[k];
    if (!r) return;
    const cut = top - r.top;
    if (cut > -48 && r.bottom > 0 && r.top < innerHeight) { p.classList.add('fading'); p.style.setProperty('--cut', Math.round(cut - 40) + 'px'); } else if (p.classList.contains('fading')) p.classList.remove('fading');
  });
}

let queued = false;
function pick() {
  queued = false;
  if (!L) { L = layout(innerWidth, innerHeight); placeAxis(); measureBar(); }
  const y = innerHeight * 0.6;
  let idx = 0;
  sections.forEach((s, k) => { if (s && s.getBoundingClientRect().top < y) idx = k; });
  setActive(idx);
  fade();
}
addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(pick); } }, { passive: true });
addEventListener('resize', () => { L = layout(innerWidth, innerHeight); placeAxis(); measureBar(); pick(); engine?.resize?.(innerWidth, innerHeight, window.devicePixelRatio || 1); }, { passive: true });
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
addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { probe(e.clientX, e.clientY); engine?.pointer?.(e.clientX, e.clientY); } }, { passive: true });
addEventListener('pointerdown', (e) => {
  engine?.pointer?.(e.clientX, e.clientY);
  if (e.target.closest('a, summary, button, .panel')) return;
  probe(e.clientX, e.clientY);
}, { passive: true });
addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) engine?.pointer?.(t.clientX, t.clientY); }, { passive: true });

async function boot() {
  // the display font (preloaded) comes first: the page and the drones' lettering use it; the show
  // follows right behind it
  await Promise.race([document.fonts.load('900 100px Archivo'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
  const probe = show3d ? probeGL() : null;
  if (probe && !params.has('inthread') && typeof OffscreenCanvas !== 'undefined' && canvas.transferControlToOffscreen) engine = await startWorker(probe);
  if (!engine && probe) engine = await startInThread(probe);
  if (engine) document.body.classList.add('show3d');
  else {
    endIntro();
    engine = await (await import('./flat.js')).start({ canvas, cues, fleet, layout, formation });
  }
  const i = active; active = -1; setActive(i);
}
// first paint is the static page; the show loads right after
requestAnimationFrame(() => setTimeout(boot, 0));
