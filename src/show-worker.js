// The show's worker: renders the drone swarm on an OffscreenCanvas, so the page's own thread never
// waits on the GPU (scrolling, reading and input stay free while the swarm flies). The page sends the
// story, its size and the canvas; afterwards it forwards cue changes, pointer and resize events.
import { buildCues, buildFleet, layout, formation, chapterZoom } from './cues.js';
import { start } from './swarm.js';

let engine = null, pending = [];
const post = (m) => self.postMessage(m);

async function loadFont(url) {
  // the drones letter the name in the page's display font; workers keep their own font list
  if (!url || typeof FontFace === 'undefined' || !self.fonts) return;
  try {
    const f = new FontFace('Archivo', `url(${url})`, { weight: '100 900', stretch: '62% 125%', style: 'normal' });
    self.fonts.add(f);
    await Promise.race([f.load(), new Promise((r) => setTimeout(r, 2000))]);
  } catch { /* the lettering falls back to a heavy system face */ }
}

function handle(m) {
  if (m.type === 'cue') engine.setCue(m.i);
  else if (m.type === 'highlight') engine.highlight(m.id);
  else if (m.type === 'pointer') engine.pointer(m.x, m.y);
  else if (m.type === 'resize') engine.resize(m.w, m.h, m.dpr);
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type !== 'init') { if (engine) handle(m); else pending.push(m); return; }
  try {
    const glb = fetch(m.glbUrl).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    await loadFont(m.fontUrl);
    const gl = m.canvas.getContext('webgl2', m.glOptions);
    if (!gl) throw new Error('no WebGL2 in the worker');
    const cues = buildCues(m.story), fleet = buildFleet(m.story);
    engine = await start({
      canvas: m.canvas, cues, fleet, layout, formation, chapterZoom, params: new URLSearchParams(m.search), tier: m.tier, gl, glb, glbUrl: m.glbUrl, view: m.view,
      onIntroEnd: () => post({ type: 'introEnd' }),
      onSquads: (s) => post({ type: 'squads', s }),
      // ?debug: the page can read the show's own frame rate (window.__showFps)
      onFps: m.search.includes('debug') ? (fps) => post({ type: 'fps', fps }) : null,
    });
    for (const q of pending) handle(q);
    pending = [];
    post({ type: 'ready' });
  } catch (err) {
    post({ type: 'failed', error: String(err && err.message || err) });
  }
};
