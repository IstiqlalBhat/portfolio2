// WebGL "commit galaxy": every commit is a point of light placed by date along a
// spiral arm; repos cluster into constellations; camera flies chapter to chapter
// driven by scroll. Single Points draw for commits, procedural only.
import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, BufferAttribute, Points,
  ShaderMaterial, LineSegments, AdditiveBlending, Color, Vector3, Group,
} from 'three';
import story from './data/story.json';
import { chapterIndex, timeBounds, fmtDate } from './render.js';

// cooperative yielding so building the scene never blocks the main thread for long
let sliceStart = 0;
const yieldNow = () => new Promise((r) => {
  if (globalThis.scheduler?.yield) globalThis.scheduler.yield().then(r); else setTimeout(r, 0);
}).then(() => { sliceStart = performance.now(); });
const maybeYield = () => (performance.now() - sliceStart > 8 ? yieldNow() : null);

const MAXW = 9; // chapter weight slots (<=7 chapters + "other")
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (x) => x * x * (3 - 2 * x);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// Test hook only: a localStorage key (never set for normal visitors) pins a tier.
function devTier() {
  try { const v = localStorage.getItem('p2-dev-tier'); return v === '0' || v === '1' || v === '2' ? +v : -1; } catch { return -1; }
}
function qualityTier() {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;
  const small = Math.min(screen.width, screen.height) < 520;
  const forced = devTier();
  if (forced >= 0) return forced;
  if (cores <= 2 || mem <= 2) return 0;
  return small || cores <= 4 ? 1 : 2;
}
const TIERS = [
  { dpr: 1, stars: 500, nebula: 0, dust: 1200, maxPoints: 3000 },
  { dpr: 1.25, stars: 1000, nebula: 70, dust: 2500, maxPoints: 7000 },
  { dpr: 1.5, stars: 1800, nebula: 160, dust: 4500, maxPoints: 14000 },
];

const commitVert = /* glsl */ `
uniform float uTime, uReveal, uNow, uScale, uPR, uPulseR, uPulseA, uPulseCh;
uniform vec3 uPulseC;
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
  // arrival pulse: a shock-wave ring sweeping through the focused chapter's stars
  float same = 1.0 - step(0.5, abs(aChap - uPulseCh));
  float pd = distance(position, uPulseC) - uPulseR;
  float pulse = uPulseA * same * (exp(-pd * pd * 0.12) + 0.35);
  s *= 1.0 + 1.3 * pulse;
  a *= 1.0 + 2.2 * pulse;
  // keep sub-pixel points stable: never shrink below 2px, fade instead
  float ps = max(s, 2.6 * uPR);
  a *= min(1.0, s / (2.6 * uPR));
  gl_PointSize = min(ps, 30.0 * uPR);
  vAlpha = a * (1.0 + 2.0 * front);
  vColor = mix(aColor, vec3(1.0), min(1.0, 0.18 + 0.5 * front + 0.45 * pulse));
  gl_Position = projectionMatrix * mv;
}`;
const lineVert = /* glsl */ `
attribute vec3 aFrom;
attribute float aOrd, aEnd;
uniform float uDraw;
void main() {
  float k = clamp((uDraw - aOrd) * 3.0, 0.0, 1.0);
  vec3 p = aEnd > 0.5 ? mix(aFrom, position, k) : position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const lineFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
void main() { gl_FragColor = vec4(uColor * uOpacity, 1.0); }`;

const ringVert = /* glsl */ `
uniform float uScale, uSize;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(uSize * uScale / max(0.1, -mv.z), 2048.0);
  gl_Position = projectionMatrix * mv;
}`;
const ringFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uP;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float r = 0.15 + 0.85 * uP;
  float ring = exp(-pow((d - r) * 16.0, 2.0)) + 0.35 * exp(-pow((d - r * 0.82) * 9.0, 2.0));
  float a = ring * (1.0 - uP) * (1.0 - smoothstep(0.96, 1.0, d));
  if (a < 0.003) discard;
  gl_FragColor = vec4((uColor + vec3(0.25)) * a * 1.4, 1.0);
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

export async function start({ onFail }) {
  await yieldNow();
  const canvas = document.getElementById('gl');
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  } catch (e) {
    onFail(e);
    return;
  }
  await yieldNow();
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
  const TURNS = 1.25, R0 = 4, R1 = 34;
  const tmp = new Vector3();
  function arm(t, out) {
    const th = 0.9 + t * TURNS * Math.PI * 2;
    const r = R0 + (R1 - R0) * Math.pow(t, 0.8);
    out.set(Math.cos(th) * r, (t - 0.5) * 7 + Math.sin(th * 2.0) * 1.2, Math.sin(th) * r);
    return th;
  }
  // chapters that overlap in time get their own band beside the arm
  function lane(repoId, th, out) {
    const ci = repoChap.has(repoId) ? repoChap.get(repoId) : -1;
    const bandR = ci < 0 ? 0 : ((ci % 3) - 1) * 6.5;
    const bandY = ci < 0 ? 0 : ((ci % 2) * 2 - 1) * 2.2;
    const lr = bandR + (hash(repoId * 3 + 1) - 0.5) * 5;
    const ly = bandY + (hash(repoId * 3 + 2) - 0.5) * 3;
    out.set(Math.cos(th) * lr, ly, Math.sin(th) * lr);
    return out;
  }

  const days = story.timeline?.days || [];
  // position warp: blend linear time with the commit CDF so dense periods get room
  const cdf = new Float32Array(Math.ceil(span) + 2);
  for (const [day, , n] of days) cdf[clamp(Math.floor(day), 0, cdf.length - 1)] += n;
  for (let i = 1; i < cdf.length; i++) cdf[i] += cdf[i - 1];
  const cdfMax = cdf[cdf.length - 1] || 1;
  const warp = (t) => {
    const x = clamp(t, 0, 1) * (cdf.length - 2), i = Math.floor(x), f = x - i;
    const c = (cdf[i] + (cdf[i + 1] - cdf[i]) * f) / cdfMax;
    return 0.6 * t + 0.4 * c;
  };
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
    const th = arm(warp(mt), c);
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
    if (maybeYield()) await yieldNow();
    const [day, repo, n] = days[r];
    const emit = Math.max(1, Math.round(n * ratio));
    const boost = Math.sqrt(n / emit);
    const ci = repoChap.has(repo) ? repoChap.get(repo) : NC;
    const center = repoCenter.get(repo);
    for (let j = 0; j < emit; j++) {
      const seed = hash(r * 13.37 + j * 7.1 + 0.5);
      const t = clamp((day + seed * 0.95) / span, 0, 1);
      const th = arm(warp(clamp((day + 0.5) / span, 0, 1)), base);
      base.add(lane(repo, th, ln));
      base.lerp(center, 0.55);
      const g = (ax) => (hash(k * 3.1 + seed * 91 + ax * 17.3 + 1) + hash(k * 5.7 + seed * 13 + ax * 29.1 + 2) + hash(k * 1.3 + seed * 47 + ax * 41.7 + 3) - 1.5);
      const sigma = (1.1 + 0.3 * Math.log2(1 + n)) * (1 + 0.4 * Math.log10(1 + (repoStat.get(repo)?.n || 1)));
      base.x += g(1) * sigma; base.y += g(2) * sigma * 0.6; base.z += g(3) * sigma;
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
    uPulseC: { value: new Vector3() }, uPulseR: { value: 0 }, uPulseA: { value: 0 }, uPulseCh: { value: -5 },
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
  await yieldNow();
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
    const nv = seg.length, lp = new Float32Array(nv * 3), lf = new Float32Array(nv * 3), lo = new Float32Array(nv), le = new Float32Array(nv);
    const nSeg = nv / 2;
    for (let i = 0; i < nv; i++) {
      const sIdx = i >> 1, from = seg[sIdx * 2];
      lp.set([seg[i].x, seg[i].y, seg[i].z], i * 3);
      lf.set([from.x, from.y, from.z], i * 3);
      lo[i] = (sIdx / Math.max(1, nSeg)) * 0.667;
      le[i] = i & 1;
    }
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(lp, 3));
    lg.setAttribute('aFrom', new BufferAttribute(lf, 3));
    lg.setAttribute('aOrd', new BufferAttribute(lo, 1));
    lg.setAttribute('aEnd', new BufferAttribute(le, 1));
    const lm = new ShaderMaterial({
      uniforms: { uColor: { value: chapColor[ci] }, uOpacity: { value: 0 }, uDraw: { value: 1 } },
      vertexShader: lineVert, fragmentShader: lineFrag,
      transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: false,
    });
    const ls = new LineSegments(lg, lm);
    ls.frustumCulled = false;
    galaxy.add(ls);
    lineMats.push(lm);
  });

  // ---------- arrival shockwave (single sprite) ----------
  const ringU = { uScale: uniforms.uScale, uSize: { value: 40 }, uColor: { value: new Color() }, uP: { value: 1 } };
  const ringGeo = new BufferGeometry();
  ringGeo.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
  const ring = new Points(ringGeo, new ShaderMaterial({
    uniforms: ringU, vertexShader: ringVert, fragmentShader: ringFrag,
    transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: false,
  }));
  ring.frustumCulled = false;
  ring.visible = false;
  galaxy.add(ring);

  // ---------- background stars + nebula ----------
  async function softPoints(n, fill, world, alpha) {
    const p = new Float32Array(n * 3), c = new Float32Array(n * 3), s = new Float32Array(n), sd = new Float32Array(n);
    for (let i = 0; i < n; i++) { if ((i & 255) === 0 && maybeYield()) await yieldNow(); fill(i, p, c, s, sd); }
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
  const stars = await softPoints(Q.stars, (i, p, c, s, sd) => {
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
  const dust = await softPoints(Q.dust, (i, p, c, s, sd) => {
    const t = Math.pow(hash(i * 0.913 + 4.2), 0.9);
    const th = arm(t, tmp);
    const spread = 2 + t * 7;
    const g = (ax) => hash(i * 2.17 + ax * 13.1 + 1) + hash(i * 3.31 + ax * 23.7 + 2) + hash(i * 5.03 + ax * 37.9 + 3) - 1.5;
    const mirror = hash(i * 7.7) < 0.35; // a fainter second arm
    if (mirror) { tmp.x = -tmp.x; tmp.z = -tmp.z; }
    const gr = g(1) * spread, gt = g(2) * spread * 0.6;
    tmp.x += Math.cos(th) * gr - Math.sin(th) * gt; tmp.z += Math.sin(th) * gr + Math.cos(th) * gt; tmp.y += g(3) * (1 + t * 2);
    p.set([tmp.x, tmp.y, tmp.z], i * 3);
    const warm = 1 - t;
    c.set([0.55 + warm * 0.35, 0.6 + warm * 0.2, 0.85 - warm * 0.15].map((v) => v * (mirror ? 0.6 : 1)), i * 3);
    s[i] = 1.3 + hash(i * 9.1) * 2.2;
    sd[i] = hash(i * 1.9);
  }, false, 0.8);
  galaxy.add(dust);
  let nebula = null;
  if (NC > 0) {
    nebula = await softPoints(Q.nebula + 12, (i, p, c, s, sd) => {
      if (i < 12) { // warm core
        p.set([(hash(i) - 0.5) * 4, (hash(i + 3) - 0.5) * 2, (hash(i + 7) - 0.5) * 4], i * 3);
        c.set([1.6, 1.2, 0.9], i * 3); s[i] = 7 + hash(i + 1) * 10; sd[i] = 0; return;
      }
      const t = hash(i * 1.7 + 0.2);
      const th = arm(warp(t), tmp);
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

  await yieldNow();
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
  const ymT = (str, end) => {
    const m = /^(\d{4})-(\d{2})/.exec(str || '');
    if (!m) return null;
    return clamp(((end ? Date.UTC(+m[1], +m[2], 0) : Date.UTC(+m[1], +m[2] - 1, 1)) - t0) / 86400000 / span, 0, 1);
  };
  const chapStartT = chapters.map((c, ci) => ymT(c.period?.start, false) ?? ci / Math.max(1, NC));
  const chapEndT = chapters.map((c) => {
    const m = /^(\d{4})-(\d{2})/.exec(c.period?.end || '');
    if (!m) return 1;
    return clamp((Date.UTC(+m[1], +m[2], 0) - t0) / 86400000 / span, 0.02, 1);
  });

  const steps = [...document.querySelectorAll('.step')];
  const stepKind = steps.map((el) => el.dataset.kind || 'chapter');
  const stepCh = steps.map((el) => (el.dataset.ch != null && chapters[+el.dataset.ch] ? +el.dataset.ch : -1));
  let mobile = false;
  const keys = []; // {pos, look, ox, oy, t}
  function buildKeys() {
    keys.length = 0;
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    mobile = aspect < 0.9;
    const fit = mobile ? 1.55 / Math.max(0.45, aspect) * 0.62 : 1;
    const hero = { pos: new Vector3(0, 60, 52).multiplyScalar(fit * (mobile ? 1.05 : 1.2)), look: new Vector3(0, -2, 0), ox: mobile ? 0 : 0.17, oy: mobile ? -0.2 : 0, t: 1, show: 1 };
    const impact = { pos: new Vector3(46, 22, -40).multiplyScalar(fit * (mobile ? 0.9 : 0.95)), look: new Vector3(0, 0, 0), ox: mobile ? 0 : 0.24, oy: mobile ? -0.3 : 0, t: 1, show: 1 };
    const cta = { pos: new Vector3(-10, -26, 74).multiplyScalar(mobile ? 1.5 : 1.05), look: new Vector3(0, 2, 0), ox: 0, oy: mobile ? -0.06 : -0.04, t: 1, show: 1 };
    const chapKeys = [];
    chapters.forEach((c, ci) => {
      const { c: ctr, rad } = chapInfo[ci];
      const radial = new Vector3(ctr.x, 0, ctr.z);
      if (radial.lengthSq() < 1e-4) radial.set(1, 0, 0);
      radial.normalize();
      const tang = new Vector3(-radial.z, 0, radial.x);
      const dir = radial.clone().multiplyScalar(0.55).add(new Vector3(0, 0.62, 0)).add(tang.multiplyScalar(ci % 2 ? 0.45 : -0.45)).normalize();
      const D = (rad * 2.6 + 14) * (mobile ? 1.75 : 1.12);
      chapKeys.push({ pos: ctr.clone().add(dir.multiplyScalar(D)), look: ctr.clone(), ox: mobile ? 0 : 0.22, oy: mobile ? -0.26 : 0, t: chapEndT[ci], show: (Math.min(chapStartT[ci], chapEndT[ci]) + chapEndT[ci]) / 2 });
    });
    steps.forEach((el, i) => {
      const k = stepKind[i];
      keys.push(k === 'hero' ? hero : k === 'impact' ? impact : k === 'cta' ? cta : chapKeys[stepCh[i]] || hero);
    });
  }

  // ---------- scroll mapping ----------
  let holds = [];
  let panelRight = 0;
  function measure() {
    const vh = window.innerHeight;
    const pr = document.querySelector('.chapter .panel')?.getBoundingClientRect();
    panelRight = !mobile && pr ? pr.right + 8 : 0;
    const maxS = Math.max(1, document.documentElement.scrollHeight - vh);
    // each step holds the camera while its panel is read, and the flight happens in the gap
    holds = steps.map((el, i) => {
      const r = el.getBoundingClientRect();
      const top = r.top + window.scrollY, bottom = r.bottom + window.scrollY;
      const hs = i === 0 ? 0 : Math.min(maxS, Math.max(0, top - vh * (mobile ? 0.05 : 0.2)));
      const he = i === 0 ? 0 : Math.min(maxS, Math.max(hs, bottom - vh * 0.92));
      return [hs, he];
    });
    for (let i = 1; i < holds.length; i++) {
      holds[i][0] = Math.max(holds[i][0], holds[i - 1][1] + 1);
      holds[i][1] = Math.max(holds[i][1], holds[i][0]);
    }
  }
  function progress() {
    const y = window.scrollY;
    for (let i = 0; i < holds.length; i++) {
      const [hs, he] = holds[i];
      if (y <= he) return y >= hs || i === 0 ? i : i - 1 + (y - holds[i - 1][1]) / Math.max(1, hs - holds[i - 1][1]);
    }
    return holds.length - 1;
  }

  // ---------- DOM hooks ----------
  const playhead = document.getElementById('playhead');
  const scrubDate = document.getElementById('scrub-date');
  const scrubTitle = document.getElementById('scrub-title');
  const marks = [...document.querySelectorAll('.scrubber [data-ch]')];
  const range = document.getElementById('scrub-range');
  const fadeSecs = [...document.querySelectorAll('.chapter, .impact-sec')];
  let lastDate = '', lastRange = -2, trackW = 0, lastNum = 0;
  const periodTxt = chapters.map((c) => {
    const f = (str) => { const m = /^(\d{4})-(\d{2})/.exec(str || ''); return m ? fmtDate(Date.UTC(+m[1], +m[2] - 1, 1)) : ''; };
    const a = f(c.period?.start), b = f(c.period?.end);
    return a === b ? a : `${a} – ${b}`;
  });
  const labelsEl = document.getElementById('labels');
  const placed = [];
  const repoById = new Map((story.repos || []).map((r) => [r.id, r]));
  const labelSets = chapters.map((c, ci) => {
    const ids = [...repoNode.keys()].filter((id) => repoChap.get(id) === ci)
      .sort((a, b) => (repoAcc.get(b)?.n || 0) - (repoAcc.get(a)?.n || 0)).slice(0, 6);
    return ids.map((id, rank) => {
      const el = document.createElement('span');
      el.className = 'lbl';
      el.style.setProperty('--c', c.color || '#fff');
      const r = repoById.get(id);
      let t = String(r?.label ?? '').replace(/^Private\s*·\s*/, '');
      if (t.length > 30) t = t.slice(0, 29) + '…';
      el.textContent = t;
      if (r && !r.public) el.classList.add('priv');
      el.dataset.rank = rank;
      labelsEl.appendChild(el);
      return { el, id, rank, w: 14 + t.length * 6.7 };
    });
  });

  await yieldNow();
  // hero count-up
  const nums = [...document.querySelectorAll('.hero .num')].map((el) => {
    const m = /^([^\d]*)([\d,]*\.?\d+)(.*)$/.exec(el.dataset.value || '');
    if (!m) return null;
    const dec = (m[2].split('.')[1] || '').length;
    return { el, pre: m[1], val: parseFloat(m[2].replace(/,/g, '')), post: m[3], dec, comma: m[2].includes(',') };
  }).filter(Boolean);
  const fmtNum = (n, d, comma) => comma ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : n.toFixed(d);

  // reveal-on-enter panels
  const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) e.target.classList.remove('pre'); }), { threshold: 0.12 });
  const revealEls = [...document.querySelectorAll('.panel, .cta-inner, .impact-inner')];
  revealEls.forEach((el) => io.observe(el));
  const scrubEl = document.querySelector('.scrubber');

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
    measureTrack();
    applyView();
  }
  function measureTrack() { trackW = document.querySelector('.scrub-track')?.clientWidth || 0; }
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
  let nowT = 1, showT = 1, curStep = -1, arrivedCh = -1, pulseT = 9;
  const lineDraw = chapters.map(() => 1);
  let perfAcc = 0, perfN = 0, degraded = false;
  let startAt = performance.now();
  await yieldNow();
  resize(true);

  function stepWeights(i, out) {
    const ch = stepCh[i];
    if (ch < 0) { out.fill(1); return; }
    out.fill(0.34);
    out[chapSlot(ch)] = 1.25;
  }
  const wa = new Float32Array(MAXW), wb = new Float32Array(MAXW);

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now; time += dt;
    uniforms.uTime.value = time;
    // (reads first, before any DOM writes this frame) fade panels as they leave the top so the flight between chapters stays visible
    for (const sec of fadeSecs) {
      const r = sec.getBoundingClientRect();
      if (r.bottom < -50 || r.top > vh) continue;
      const o = clamp((r.bottom - vh * 0.18) / (vh * 0.5), 0, 1);
      const v = o.toFixed(2);
      if (sec._o !== v) { sec._o = v; sec.style.opacity = v; }
    }

    // adaptive quality: if we can't hold ~40fps, drop resolution and nebula
    if (time > 2 && !degraded && devTier() < 0) {
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
    // on phones the flight happens in the lower part of the screen (panels exit at the top)
    const tox = A.ox + (B.ox - A.ox) * f, toy = A.oy + (B.oy - A.oy) * f + (mobile && i0 !== i1 ? Math.sin(Math.PI * f) * 0.42 : 0);
    if (Math.abs(tox - view.ox) + Math.abs(toy - view.oy) > 1e-4) {
      view.ox = damp(view.ox, tox, 3, dt); view.oy = damp(view.oy, toy, 3, dt); applyView();
    }

    // chapter focus weights + "now" time
    stepWeights(i0, wa); stepWeights(i1, wb);
    for (let i = 0; i < MAXW; i++) { wTarget[i] = wa[i] + (wb[i] - wa[i]) * f; W[i] = damp(W[i], wTarget[i], 4, dt); }
    const tNow = A.t + (B.t - A.t) * f;
    nowT = damp(nowT, tNow, 4, dt);
    showT = damp(showT, A.show + (B.show - A.show) * f, 5, dt);
    const shown = rv < 1 ? Math.min(showT, reveal) : showT;
    uniforms.uNow.value = rv < 1 ? 1.1 : nowT;

    lineMats.forEach((m, ci) => {
      if (!m) return;
      const on = reveal >= (chapEndT[ci] - 0.05) ? 1 : 0;
      const focused = ci === arrivedCh;
      lineDraw[ci] = focused ? Math.min(1, lineDraw[ci] + dt / 1.8) : 1;
      m.uniforms.uDraw.value = lineDraw[ci];
      m.uniforms.uOpacity.value = on * (focused ? 0.75 : clamp(0.06 + (W[chapSlot(ci)] - 0.2) * 0.5, 0.03, 0.55));
    });

    // HUD
    playhead.style.transform = `translateX(${(shown * trackW).toFixed(1)}px)`;
    const s = Math.round(P);
    const activeCh = Math.abs(P - s) < 0.35 ? stepCh[s] : -1;
    const dateTxt = activeCh >= 0 && rv >= 1 ? periodTxt[activeCh] : fmtDate(t0 + shown * span * 86400000);
    if (dateTxt !== lastDate) { scrubDate.textContent = dateTxt; lastDate = dateTxt; }
    if (activeCh !== lastRange) {
      lastRange = activeCh;
      if (range) {
        if (activeCh >= 0) {
          const a0 = Math.min(chapStartT[activeCh], chapEndT[activeCh]);
          range.style.left = `${(a0 * 100).toFixed(2)}%`;
          range.style.width = `${Math.max(0.6, (chapEndT[activeCh] - a0) * 100).toFixed(2)}%`;
          range.style.opacity = '1';
        } else range.style.opacity = '0';
      }
    }
    // arrival: when a chapter becomes focused, fire the pulse and redraw its constellation
    const arr = Math.abs(P - s) < 0.2 ? stepCh[s] : -1;
    if (arr !== arrivedCh) {
      arrivedCh = arr;
      if (arr >= 0 && rv >= 1) {
        pulseT = 0; lineDraw[arr] = 0;
        uniforms.uPulseC.value.copy(chapInfo[arr].c);
        ring.position.copy(chapInfo[arr].c);
        ringU.uColor.value.copy(chapColor[arr]);
        ringU.uSize.value = chapInfo[arr].rad * 7 + 18;
        uniforms.uPulseCh.value = chapSlot(arr);
      }
    }
    pulseT += dt;
    uniforms.uPulseR.value = pulseT * 20;
    uniforms.uPulseA.value = pulseT < 4 ? Math.exp(-pulseT * 1.2) : 0;
    ring.visible = pulseT < 1.6;
    ringU.uP.value = clamp(1 - Math.pow(1 - pulseT / 1.6, 2.2), 0, 1);


    if (s !== curStep) {
      curStep = s;
      const ch = stepCh[s], kind = stepKind[s];
      scrubTitle.textContent = ch >= 0 ? `${String(ch + 1).padStart(2, '0')} · ${chapters[ch].title}`
        : kind === 'impact' ? (story.impact?.title || '') : kind === 'cta' ? 'Now' : (story.person?.name || '');
      marks.forEach((m) => m.classList.toggle('on', +m.dataset.ch === ch));
      scrubEl?.style.setProperty('--accent', ch >= 0 ? chapters[ch].color : '#7dd3fc');
    }
    if (nums.length && now - lastNum > 60) {
      lastNum = now;
      const q = clamp(el / 2.6, 0, 1), e = 1 - Math.pow(1 - q, 3);
      for (const n of nums) {
        if (n.done) continue;
        n.el.textContent = n.pre + fmtNum(n.val * e, n.dec, n.comma) + n.post;
        if (q >= 1) { n.el.textContent = n.el.dataset.value; n.done = true; }
      }
    }

    // constellation labels for the focused chapter
    const focusCh = Math.abs(P - s) < 0.42 ? stepCh[s] : -1;
    const lblA = focusCh >= 0 ? 1 - Math.abs(P - s) / 0.42 : 0;
    placed.length = 0;
    labelSets.forEach((set, ci) => {
      for (const L of set) {
        const show = ci === focusCh && rv >= 1 && L.rank < (mobile ? 3 : 5);
        if (!show) { if (L.vis) { L.el.style.opacity = '0'; L.vis = false; } continue; }
        tmp.copy(repoNode.get(L.id)).applyMatrix4(galaxy.matrixWorld).project(camera);
        const x = (tmp.x * 0.5 + 0.5) * vw, y = (-tmp.y * 0.5 + 0.5) * vh;
        // skip off-screen labels and ones that would collide with a higher-ranked label
        const bw = L.w, bh = 16, bx = Math.min(x, vw - bw - 6), by = y - 8;
        const clash = tmp.z > 1 || x < 0 || x > vw || bx < panelRight || y < 8 || y > vh - 90 ||
          placed.some((q) => bx < q.x + q.w && bx + bw > q.x && by < q.y + q.h && by + bh > q.y);
        if (clash) { if (L.vis) { L.el.style.opacity = '0'; L.vis = false; } continue; }
        placed.push({ x: bx, y: by, w: bw, h: bh });
        L.el.style.transform = `translate(${bx.toFixed(1)}px, ${y.toFixed(1)}px)`;
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
    chapters.forEach((c, ci) => { const d = Math.abs((chapStartT[ci] + chapEndT[ci]) / 2 - x); if (d < bd) { bd = d; best = ci; } });
    document.getElementById(`ch-${chapters[best].id}`)?.scrollIntoView({ behavior: 'smooth' });
  });

  // compile shaders without blocking where the driver supports parallel compile
  await yieldNow();
  // compile one program per task so no single task blocks for long
  const parallel = !!renderer.compileAsync && renderer.extensions.has('KHR_parallel_shader_compile');
  const objs = [];
  scene.traverse((o) => { if (o.material) objs.push(o); });
  for (const o of objs) {
    try {
      if (parallel) await renderer.compileAsync(o, camera, scene);
      else renderer.compile(o, camera, scene);
      await yieldNow();
      // warm-up draw: forces program link + buffer upload for this object in its own task
      renderer.render(o, camera);
    } catch { /* lazy compile on first frame */ }
    await yieldNow();
  }
  // panels below the fold rise in when they enter (per-element class: no global restyle)
  for (const el of revealEls) if (el.getBoundingClientRect().top > window.innerHeight) el.classList.add('pre');
  startAt = performance.now();
  play();
}
