// WebGL "commit galaxy": every commit is a point of light placed by date along a
// spiral arm; repos cluster into constellations; camera flies chapter to chapter
// driven by scroll. Single Points draw for commits, procedural only.
import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, BufferAttribute, Points,
  ShaderMaterial, LineSegments, LineBasicMaterial, AdditiveBlending, Color, Vector3, Group,
} from 'three';
import story from './data/story.json';
import { chapterIndex, timeBounds, fmtDate } from './render.js';

const MAXW = 9; // chapter weight slots (<=7 chapters + "other")
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (x) => x * x * (3 - 2 * x);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

function qualityTier() {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;
  const small = Math.min(screen.width, screen.height) < 520;
  const forced = /[?&]q=([012])/.exec(location.search);
  if (forced) return +forced[1];
  if (cores <= 2 || mem <= 2) return 0;
  return small || cores <= 4 ? 1 : 2;
}
const TIERS = [
  { dpr: 1, stars: 500, nebula: 0, dust: 1200, maxPoints: 3000 },
  { dpr: 1.25, stars: 1000, nebula: 70, dust: 2500, maxPoints: 7000 },
  { dpr: 1.5, stars: 1800, nebula: 160, dust: 4500, maxPoints: 14000 },
];

const commitVert = /* glsl */ `
uniform float uTime, uReveal, uNow, uScale, uPR;
uniform float uW[${MAXW}];
attribute vec3 aColor;
attribute float aT, aSize, aChap, aSeed;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float rev = smoothstep(aT - 0.004, aT + 0.012, uReveal);
  float front = exp(-pow((uReveal - aT) * 70.0, 2.0)) * step(uReveal, 1.01);
  float future = mix(1.0, 0.16, smoothstep(uNow + 0.003, uNow + 0.04, aT));
  float w = uW[int(aChap + 0.5)];
  float tw = 0.72 + 0.28 * sin(uTime * (0.8 + aSeed * 2.6) + aSeed * 61.0);
  float s = aSize * uScale / max(0.1, -mv.z) * (1.0 + 1.6 * front) * (0.55 + 0.45 * w);
  float a = rev * future * tw * w;
  // keep sub-pixel points stable: never shrink below 2px, fade instead
  float ps = max(s, 2.6 * uPR);
  a *= min(1.0, s / (2.6 * uPR));
  gl_PointSize = min(ps, 30.0 * uPR);
  vAlpha = a * (1.0 + 2.0 * front);
  vColor = mix(aColor, vec3(1.0), 0.18 + 0.5 * front);
  gl_Position = projectionMatrix * mv;
}`;
const commitFrag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = dot(p, p) * 4.0;
  float core = exp(-d * 22.0);
  float halo = exp(-d * 4.0) * 0.38;
  float a = (core + halo) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4((vColor * (core + halo) + vec3(core * 0.55)) * vAlpha, 1.0);
}`;

const softVert = /* glsl */ `
uniform float uTime, uScale, uPR, uAlpha, uWorld;
attribute vec3 aColor;
attribute float aSize, aSeed;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float s = uWorld > 0.5 ? aSize * uScale / max(0.1, -mv.z) : aSize * uPR;
  gl_PointSize = min(s, 420.0 * uPR);
  vAlpha = uAlpha * (uWorld > 0.5 ? 1.0 : 0.55 + 0.45 * sin(uTime * (0.5 + aSeed * 2.0) + aSeed * 90.0));
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
}`;
const softFrag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = dot(p, p) * 4.0;
  float a = exp(-d * 5.0) * (1.0 - smoothstep(0.7, 1.0, d)) * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

export function start({ onFail }) {
  const canvas = document.getElementById('gl');
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  } catch (e) {
    onFail(e);
    return;
  }
  let tier = qualityTier();
  let Q = TIERS[tier];
  renderer.setClearColor(0x04050a, 1);

  const { chapters, repoChap } = chapterIndex(story);
  const { t0, span } = timeBounds(story);
  const NC = chapters.length;
  const chapColor = chapters.map((c) => new Color(c.color || '#9aa4b8'));
  const otherColor = new Color('#9aa4b8');
  const chapSlot = (ci) => Math.min(ci, MAXW - 1);

  // ---------- layout: spiral arm through time ----------
  const TURNS = 1.25, R0 = 3, R1 = 40;
  const tmp = new Vector3();
  function arm(t, out) {
    const th = 0.9 + t * TURNS * Math.PI * 2;
    const r = R0 + (R1 - R0) * Math.pow(t, 0.8);
    out.set(Math.cos(th) * r, (t - 0.5) * 7 + Math.sin(th * 2.0) * 1.2, Math.sin(th) * r);
    return th;
  }
  function lane(repoId, th, out) {
    const lr = (hash(repoId * 3 + 1) - 0.5) * 9;
    const ly = (hash(repoId * 3 + 2) - 0.5) * 5;
    out.set(Math.cos(th) * lr, ly, Math.sin(th) * lr);
    return out;
  }

  const days = story.timeline?.days || [];
  const totalCommits = days.reduce((s, d) => s + (d[2] || 0), 0);
  const ratio = Math.min(1, Q.maxPoints / Math.max(1, totalCommits));

  // repo mean time & chapter time ranges
  const repoStat = new Map();
  for (const [day, repo, n] of days) {
    const s = repoStat.get(repo) || { sum: 0, n: 0, first: Infinity };
    s.sum += (day / span) * n; s.n += n; s.first = Math.min(s.first, day / span);
    repoStat.set(repo, s);
  }
  const repoCenter = new Map();
  for (const [id, s] of repoStat) {
    const mt = s.sum / s.n;
    const c = new Vector3();
    const th = arm(mt, c);
    c.add(lane(id, th, tmp));
    repoCenter.set(id, c);
  }

  let count = 0;
  for (const d of days) count += Math.max(1, Math.round(d[2] * ratio));
  const nRepoNodes = repoStat.size;
  const N = count + nRepoNodes;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const aT = new Float32Array(N), aSize = new Float32Array(N), aChap = new Float32Array(N), aSeed = new Float32Array(N);

  const chapAcc = chapters.map(() => ({ c: new Vector3(), n: 0, pts: [] }));
  const repoAcc = new Map();
  const base = new Vector3(), ln = new Vector3();
  let k = 0;
  const white = new Color(1, 1, 1);
  const cc = new Color();
  for (let r = 0; r < days.length; r++) {
    const [day, repo, n] = days[r];
    const emit = Math.max(1, Math.round(n * ratio));
    const boost = Math.sqrt(n / emit);
    const ci = repoChap.has(repo) ? repoChap.get(repo) : NC;
    const center = repoCenter.get(repo);
    for (let j = 0; j < emit; j++) {
      const seed = hash(r * 13.37 + j * 7.1 + 0.5);
      const t = clamp((day + seed * 0.95) / span, 0, 1);
      const th = arm(t, base);
      base.add(lane(repo, th, ln));
      base.lerp(center, 0.42);
      const g = () => (hash(k * 3.1 + seed * 91 + 1) + hash(k * 5.7 + seed * 13 + 2) + hash(k * 1.3 + seed * 47 + 3) - 1.5);
      const sigma = 0.75 + 0.25 * Math.log2(1 + n);
      base.x += g() * sigma; base.y += g() * sigma * 0.6; base.z += g() * sigma;
      pos.set([base.x, base.y, base.z], k * 3);
      cc.copy(ci < NC ? chapColor[ci] : otherColor).lerp(white, hash(k + 0.31) * 0.35);
      col.set([cc.r, cc.g, cc.b], k * 3);
      aT[k] = t;
      aSize[k] = (0.2 + 0.1 * Math.log2(1 + n)) * boost * (0.7 + seed * 0.6);
      aChap[k] = chapSlot(ci);
      aSeed[k] = seed;
      if (ci < NC) { chapAcc[ci].c.add(base); chapAcc[ci].n++; if (chapAcc[ci].pts.length < 4000) chapAcc[ci].pts.push(base.clone()); }
      const ra = repoAcc.get(repo) || { c: new Vector3(), n: 0 };
      ra.c.add(base); ra.n++; repoAcc.set(repo, ra);
      k++;
    }
  }
  // constellation nodes: one bright star at each repo centroid
  const repoNode = new Map();
  for (const [id, ra] of repoAcc) {
    const c = ra.c.multiplyScalar(1 / ra.n);
    repoNode.set(id, c);
    const ci = repoChap.has(id) ? repoChap.get(id) : NC;
    pos.set([c.x, c.y, c.z], k * 3);
    cc.copy(ci < NC ? chapColor[ci] : otherColor).lerp(white, 0.55);
    col.set([cc.r, cc.g, cc.b], k * 3);
    aT[k] = repoStat.get(id).first;
    aSize[k] = 0.55 + Math.min(0.8, Math.log10(1 + ra.n) * 0.3);
    aChap[k] = chapSlot(ci);
    aSeed[k] = hash(id + 0.77);
    k++;
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new BufferAttribute(col, 3));
  geo.setAttribute('aT', new BufferAttribute(aT, 1));
  geo.setAttribute('aSize', new BufferAttribute(aSize, 1));
  geo.setAttribute('aChap', new BufferAttribute(aChap, 1));
  geo.setAttribute('aSeed', new BufferAttribute(aSeed, 1));
  const W = new Float32Array(MAXW).fill(1);
  const uniforms = {
    uTime: { value: 0 }, uReveal: { value: 0 }, uNow: { value: 1 }, uScale: { value: 400 },
    uPR: { value: 1 }, uW: { value: W },
  };
  const commitMat = new ShaderMaterial({
    uniforms, vertexShader: commitVert, fragmentShader: commitFrag,
    transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
  });
  const scene = new Scene();
  const galaxy = new Group();
  scene.add(galaxy);
  const commits = new Points(geo, commitMat);
  commits.frustumCulled = false;
  galaxy.add(commits);

  // ---------- constellation lines (MST of repo centroids per chapter) ----------
  const lineMats = [];
  chapters.forEach((c, ci) => {
    const nodes = [...repoNode.entries()].filter(([id]) => repoChap.get(id) === ci).map(([, v]) => v);
    if (nodes.length < 2) { lineMats.push(null); return; }
    const inTree = [0], seg = [];
    const best = nodes.map((v) => v.distanceTo(nodes[0])), from = nodes.map(() => 0);
    best[0] = Infinity;
    while (inTree.length < nodes.length) {
      let bi = -1, bd = Infinity;
      best.forEach((d, i) => { if (!inTree.includes(i) && d < bd) { bd = d; bi = i; } });
      inTree.push(bi);
      seg.push(nodes[from[bi]], nodes[bi]);
      nodes.forEach((v, i) => { if (!inTree.includes(i)) { const d = v.distanceTo(nodes[bi]); if (d < best[i]) { best[i] = d; from[i] = bi; } } });
    }
    const lg = new BufferGeometry().setFromPoints(seg);
    const lm = new LineBasicMaterial({ color: chapColor[ci], transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, depthTest: false });
    const ls = new LineSegments(lg, lm);
    ls.frustumCulled = false;
    galaxy.add(ls);
    lineMats.push(lm);
  });

  // ---------- background stars + nebula ----------
  function softPoints(n, fill, world, alpha) {
    const p = new Float32Array(n * 3), c = new Float32Array(n * 3), s = new Float32Array(n), sd = new Float32Array(n);
    for (let i = 0; i < n; i++) fill(i, p, c, s, sd);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(p, 3));
    g.setAttribute('aColor', new BufferAttribute(c, 3));
    g.setAttribute('aSize', new BufferAttribute(s, 1));
    g.setAttribute('aSeed', new BufferAttribute(sd, 1));
    const m = new ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uScale: uniforms.uScale, uPR: uniforms.uPR, uAlpha: { value: alpha }, uWorld: { value: world ? 1 : 0 } },
      vertexShader: softVert, fragmentShader: softFrag, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
    });
    const pts = new Points(g, m);
    pts.frustumCulled = false;
    return pts;
  }
  const stars = softPoints(Q.stars, (i, p, c, s, sd) => {
    const u = hash(i * 1.1 + 5) * 2 - 1, a = hash(i * 2.3 + 9) * Math.PI * 2, r = 160 + hash(i * 3.7) * 180;
    const q = Math.sqrt(1 - u * u);
    p.set([Math.cos(a) * q * r, u * r, Math.sin(a) * q * r], i * 3);
    const tint = hash(i * 4.4);
    c.set(tint > 0.8 ? [1, 0.85, 0.7] : tint > 0.5 ? [0.75, 0.85, 1] : [0.9, 0.92, 1], i * 3);
    s[i] = 1.2 + hash(i * 6.1) ** 3 * 3.5;
    sd[i] = hash(i * 8.8);
  }, false, 0.75);
  scene.add(stars);
  // galactic dust: faint non-commit particles tracing the spiral arms (structure only)
  const dust = softPoints(Q.dust, (i, p, c, s, sd) => {
    const t = Math.pow(hash(i * 0.913 + 4.2), 0.9);
    const th = arm(t, tmp);
    const spread = 2 + t * 7;
    const g = () => hash(i * 2.17 + 1) + hash(i * 3.31 + 2) + hash(i * 5.03 + 3) - 1.5;
    const mirror = hash(i * 7.7) < 0.35; // a fainter second arm
    if (mirror) { tmp.x = -tmp.x; tmp.z = -tmp.z; }
    tmp.x += Math.cos(th) * g() * spread; tmp.z += Math.sin(th) * g() * spread; tmp.y += g() * (1 + t * 2);
    p.set([tmp.x, tmp.y, tmp.z], i * 3);
    const warm = 1 - t;
    c.set([0.55 + warm * 0.35, 0.6 + warm * 0.2, 0.85 - warm * 0.15].map((v) => v * (mirror ? 0.6 : 1)), i * 3);
    s[i] = 1.3 + hash(i * 9.1) * 2.2;
    sd[i] = hash(i * 1.9);
  }, false, 0.8);
  galaxy.add(dust);
  let nebula = null;
  if (NC > 0) {
    nebula = softPoints(Q.nebula + 12, (i, p, c, s, sd) => {
      if (i < 12) { // warm core
        p.set([(hash(i) - 0.5) * 4, (hash(i + 3) - 0.5) * 2, (hash(i + 7) - 0.5) * 4], i * 3);
        c.set([1.6, 1.2, 0.9], i * 3); s[i] = 7 + hash(i + 1) * 10; sd[i] = 0; return;
      }
      const t = hash(i * 1.7 + 0.2);
      const th = arm(t, tmp);
      tmp.x += (hash(i * 2.9) - 0.5) * 10; tmp.y += (hash(i * 3.3) - 0.5) * 4; tmp.z += (hash(i * 4.1) - 0.5) * 10;
      void th;
      p.set([tmp.x, tmp.y, tmp.z], i * 3);
      // colour by chapter covering this time
      const day = t * span;
      let ci = -1, bestD = Infinity;
      for (const [d, repo] of days) { const dd = Math.abs(d - day); if (dd < bestD) { bestD = dd; ci = repoChap.has(repo) ? repoChap.get(repo) : -1; } if (d > day) break; }
      const col3 = ci >= 0 ? chapColor[ci] : otherColor;
      c.set([col3.r, col3.g, col3.b], i * 3);
      s[i] = 9 + hash(i * 5.5) * 16; sd[i] = hash(i * 6.6);
    }, true, 0.06);
    galaxy.add(nebula);
  }

  // ---------- camera keyframes ----------
  const camera = new PerspectiveCamera(50, 1, 0.5, 900);
  const chapEndT0 = (ci) => (ci + 0.5) / Math.max(1, NC);
  const chapInfo = chapAcc.map((a, ci) => {
    let c;
    if (a.n) c = a.c.clone().multiplyScalar(1 / a.n);
    else { c = new Vector3(); arm(chapEndT0(ci), c); }
    let rad = 4;
    if (a.pts.length) rad = Math.sqrt(a.pts.reduce((s, p) => s + p.distanceToSquared(c), 0) / a.pts.length);
    return { c, rad };
  });
  const chapEndT = chapters.map((c) => {
    const m = /^(\d{4})-(\d{2})/.exec(c.period?.end || '');
    if (!m) return 1;
    return clamp((Date.UTC(+m[1], +m[2], 0) - t0) / 86400000 / span, 0.02, 1);
  });

  let mobile = false;
  const keys = []; // {pos, look, ox, oy, t}
  function buildKeys() {
    keys.length = 0;
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    mobile = aspect < 0.9;
    const fit = mobile ? 1.55 / Math.max(0.45, aspect) * 0.62 : 1;
    keys.push({ pos: new Vector3(0, 60, 52).multiplyScalar(fit * (mobile ? 1 : 1.08)), look: new Vector3(0, -2, 0), ox: mobile ? 0 : 0.19, oy: mobile ? -0.28 : 0, t: 1 });
    chapters.forEach((c, ci) => {
      const { c: ctr, rad } = chapInfo[ci];
      const radial = new Vector3(ctr.x, 0, ctr.z);
      if (radial.lengthSq() < 1e-4) radial.set(1, 0, 0);
      radial.normalize();
      const tang = new Vector3(-radial.z, 0, radial.x);
      const dir = radial.clone().multiplyScalar(0.55).add(new Vector3(0, 0.62, 0)).add(tang.multiplyScalar(ci % 2 ? 0.45 : -0.45)).normalize();
      const D = (rad * 2.6 + 14) * (mobile ? 1.45 : 1);
      keys.push({ pos: ctr.clone().add(dir.multiplyScalar(D)), look: ctr.clone(), ox: mobile ? 0 : 0.22, oy: mobile ? -0.24 : 0, t: chapEndT[ci] });
    });
    keys.push({ pos: new Vector3(-10, -26, 74).multiplyScalar(mobile ? 1.5 : 1.05), look: new Vector3(0, 2, 0), ox: 0, oy: mobile ? -0.06 : -0.04, t: 1 });
  }

  // ---------- scroll mapping ----------
  const steps = [...document.querySelectorAll('.step')];
  let anchors = [];
  function measure() {
    const vh = window.innerHeight;
    const maxS = Math.max(1, document.documentElement.scrollHeight - vh);
    anchors = steps.map((el, i) => {
      if (i === 0) return 0;
      const top = el.getBoundingClientRect().top + window.scrollY;
      return Math.min(maxS, Math.max(0, top - vh * (mobile ? 0.05 : 0.2)));
    });
    for (let i = 1; i < anchors.length; i++) anchors[i] = Math.max(anchors[i], anchors[i - 1] + 1);
  }
  function progress() {
    const y = window.scrollY;
    if (y <= anchors[0]) return 0;
    for (let i = 1; i < anchors.length; i++) {
      if (y < anchors[i]) return i - 1 + (y - anchors[i - 1]) / (anchors[i] - anchors[i - 1]);
    }
    return anchors.length - 1;
  }

  // ---------- DOM hooks ----------
  const playhead = document.getElementById('playhead');
  const scrubDate = document.getElementById('scrub-date');
  const scrubTitle = document.getElementById('scrub-title');
  const marks = [...document.querySelectorAll('.scrubber .mark')];
  const labelsEl = document.getElementById('labels');
  const repoById = new Map((story.repos || []).map((r) => [r.id, r]));
  const labelSets = chapters.map((c, ci) => {
    const ids = [...repoNode.keys()].filter((id) => repoChap.get(id) === ci)
      .sort((a, b) => (repoAcc.get(b)?.n || 0) - (repoAcc.get(a)?.n || 0)).slice(0, 6);
    return ids.map((id, rank) => {
      const el = document.createElement('span');
      el.className = 'lbl';
      el.style.setProperty('--c', c.color || '#fff');
      const t = String(repoById.get(id)?.label ?? '');
      el.textContent = t.length > 30 ? t.slice(0, 29) + '…' : t;
      el.dataset.rank = rank;
      labelsEl.appendChild(el);
      return { el, id, rank };
    });
  });

  // hero count-up
  const nums = [...document.querySelectorAll('.hero .num')].map((el) => {
    const m = /^([^\d]*)([\d,]*\.?\d+)(.*)$/.exec(el.dataset.value || '');
    if (!m) return null;
    const dec = (m[2].split('.')[1] || '').length;
    return { el, pre: m[1], val: parseFloat(m[2].replace(/,/g, '')), post: m[3], dec, comma: m[2].includes(',') };
  }).filter(Boolean);
  const fmtNum = (n, d, comma) => comma ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : n.toFixed(d);

  // reveal-on-enter panels
  const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) e.target.classList.add('in'); }), { threshold: 0.12 });
  document.querySelectorAll('.panel, .cta-inner').forEach((el) => io.observe(el));

  // ---------- sizing ----------
  let vw = 0, vh = 0, dpr = 1;
  const view = { ox: 0, oy: 0 };
  function resize(force) {
    const w = window.innerWidth, h = window.innerHeight;
    if (!force && w === vw && Math.abs(h - vh) < 140) { measure(); return; }
    vw = w; vh = h;
    dpr = Math.min(window.devicePixelRatio || 1, Q.dpr);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    uniforms.uPR.value = dpr;
    uniforms.uScale.value = (h * dpr * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
    buildKeys();
    measure();
    applyView();
  }
  function applyView() {
    camera.setViewOffset(vw, vh, -view.ox * vw, -view.oy * vh, vw, vh);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', () => resize(false), { passive: true });
  if (document.fonts?.ready) document.fonts.ready.then(measure);
  window.addEventListener('load', measure);

  let mx = 0, my = 0, tmx = 0, tmy = 0;
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    tmx = e.clientX / vw - 0.5; tmy = e.clientY / vh - 0.5;
  }, { passive: true });

  // ---------- loop ----------
  const camPos = new Vector3(), camLook = new Vector3(), tPos = new Vector3(), tLook = new Vector3();
  const wTarget = new Float32Array(MAXW);
  let raf = 0, last = 0, time = 0, revealStart = -1, first = true;
  let nowT = 1, curStep = -1;
  let perfAcc = 0, perfN = 0, degraded = false;
  const startAt = performance.now();
  resize(true);

  function stepWeights(i, out) {
    if (i <= 0 || i > NC) { out.fill(1); return; }
    out.fill(0.34);
    out[chapSlot(i - 1)] = 1.25;
  }
  const wa = new Float32Array(MAXW), wb = new Float32Array(MAXW);

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now; time += dt;
    uniforms.uTime.value = time;

    // adaptive quality: if we can't hold ~40fps, drop resolution and nebula
    if (time > 2 && !degraded && !/[?&]q=/.test(location.search)) {
      perfAcc += dt; perfN++;
      if (perfN >= 90) {
        if (perfAcc / perfN > 1 / 40) {
          degraded = true; Q = TIERS[0];
          if (nebula) nebula.visible = false;
          resize(true);
        }
        perfAcc = 0; perfN = 0;
      }
    }

    // intro reveal: stars ignite chronologically
    const el = (now - startAt) / 1000 - 0.35;
    const rv = clamp(el / 3.4, 0, 1);
    const reveal = rv < 1 ? 1 - Math.pow(1 - rv, 2.2) : 1;
    uniforms.uReveal.value = rv < 1 ? reveal : 1.1;

    const P = clamp(progress(), 0, keys.length - 1);
    const i0 = Math.floor(P), i1 = Math.min(keys.length - 1, i0 + 1);
    const f = smooth(P - i0);
    const A = keys[i0], B = keys[i1];
    tPos.lerpVectors(A.pos, B.pos, f);
    tPos.y += Math.sin(Math.PI * f) * A.pos.distanceTo(B.pos) * 0.18;
    tLook.lerpVectors(A.look, B.look, f);
    // keyframes live in galaxy space; galaxy slowly rotates
    galaxy.rotation.y = time * 0.012;
    galaxy.updateMatrixWorld();
    tPos.applyMatrix4(galaxy.matrixWorld);
    tLook.applyMatrix4(galaxy.matrixWorld);
    mx = damp(mx, tmx, 2, dt); my = damp(my, tmy, 2, dt);
    tPos.x += mx * 4; tPos.y -= my * 3;

    if (first) {
      camPos.copy(tPos).multiplyScalar(1.6); camLook.copy(tLook); first = false;
      view.ox = (A.ox + (B.ox - A.ox) * f); view.oy = (A.oy + (B.oy - A.oy) * f);
      applyView();
    }
    const kk = rv < 1 ? 1.1 : 2.6;
    camPos.x = damp(camPos.x, tPos.x, kk, dt); camPos.y = damp(camPos.y, tPos.y, kk, dt); camPos.z = damp(camPos.z, tPos.z, kk, dt);
    camLook.x = damp(camLook.x, tLook.x, 3, dt); camLook.y = damp(camLook.y, tLook.y, 3, dt); camLook.z = damp(camLook.z, tLook.z, 3, dt);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    const tox = A.ox + (B.ox - A.ox) * f, toy = A.oy + (B.oy - A.oy) * f;
    if (Math.abs(tox - view.ox) + Math.abs(toy - view.oy) > 1e-4) {
      view.ox = damp(view.ox, tox, 3, dt); view.oy = damp(view.oy, toy, 3, dt); applyView();
    }

    // chapter focus weights + "now" time
    stepWeights(i0, wa); stepWeights(i1, wb);
    for (let i = 0; i < MAXW; i++) { wTarget[i] = wa[i] + (wb[i] - wa[i]) * f; W[i] = damp(W[i], wTarget[i], 4, dt); }
    const tNow = A.t + (B.t - A.t) * f;
    nowT = damp(nowT, tNow, 4, dt);
    const shown = rv < 1 ? Math.min(nowT, reveal) : nowT;
    uniforms.uNow.value = rv < 1 ? 1.1 : nowT;

    lineMats.forEach((m, ci) => {
      if (!m) return;
      const on = reveal >= (chapEndT[ci] - 0.05) ? 1 : 0;
      m.opacity = on * clamp(0.06 + (W[chapSlot(ci)] - 0.2) * 0.5, 0.03, 0.55);
    });

    // HUD
    playhead.style.left = `${(shown * 100).toFixed(3)}%`;
    scrubDate.textContent = fmtDate(t0 + shown * span * 86400000);
    const s = Math.round(P);
    if (s !== curStep) {
      curStep = s;
      scrubTitle.textContent = s === 0 ? (story.person?.name || '') : s <= NC ? `${String(s).padStart(2, '0')} · ${chapters[s - 1].title}` : (story.cta?.line ? 'Now' : '');
      marks.forEach((m) => m.classList.toggle('on', +m.dataset.step === s));
      document.documentElement.style.setProperty('--accent', s >= 1 && s <= NC ? chapters[s - 1].color : '#7dd3fc');
    }
    if (nums.length) {
      const q = clamp(el / 2.6, 0, 1), e = 1 - Math.pow(1 - q, 3);
      for (const n of nums) {
        if (n.done) continue;
        n.el.textContent = n.pre + fmtNum(n.val * e, n.dec, n.comma) + n.post;
        if (q >= 1) { n.el.textContent = n.el.dataset.value; n.done = true; }
      }
    }

    // constellation labels for the focused chapter
    const focusCh = Math.abs(P - s) < 0.42 && s >= 1 && s <= NC ? s - 1 : -1;
    const lblA = focusCh >= 0 ? 1 - Math.abs(P - s) / 0.42 : 0;
    labelSets.forEach((set, ci) => {
      for (const L of set) {
        const show = ci === focusCh && rv >= 1 && L.rank < (mobile ? 3 : 5);
        if (!show) { if (L.vis) { L.el.style.opacity = '0'; L.vis = false; } continue; }
        tmp.copy(repoNode.get(L.id)).applyMatrix4(galaxy.matrixWorld).project(camera);
        if (tmp.z > 1) { L.el.style.opacity = '0'; continue; }
        const x = (tmp.x * 0.5 + 0.5) * vw, y = (-tmp.y * 0.5 + 0.5) * vh;
        L.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        L.el.style.opacity = String(lblA);
        L.vis = true;
      }
    });

    renderer.render(scene, camera);
  }

  function play() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
  function pause() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); pause(); onFail('webgl context lost'); });

  // scrubber: tap anywhere on the track to jump to the nearest chapter at that date
  const track = document.querySelector('.scrub-track');
  track?.addEventListener('click', (e) => {
    if (e.target.closest('.mark')) return;
    const r = track.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    let best = 0, bd = Infinity;
    chapters.forEach((c, ci) => { const d = Math.abs(chapEndT[ci] - x); if (d < bd) { bd = d; best = ci; } });
    document.getElementById(`ch-${chapters[best].id}`)?.scrollIntoView({ behavior: 'smooth' });
  });

  document.documentElement.classList.add('ready');
  play();
}
