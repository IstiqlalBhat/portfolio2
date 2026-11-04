// WebGL "commit galaxy": every commit is a point of light placed by date along a
// spiral arm; repos cluster into constellations; camera flies chapter to chapter
// driven by scroll. Single Points draw for commits, procedural only.
import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, BufferAttribute, Points,
  ShaderMaterial, LineSegments, AdditiveBlending, Color, Vector3, Group, Mesh, Vector4,
} from './three-lite.js';
let story;
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
  { dpr: 1, stars: 500, nebula: 0, dust: 1200, near: 0, scaffold: 300, maxPoints: 3000 },
  { dpr: 1.5, stars: 1000, nebula: 70, dust: 2500, near: 110, scaffold: 720, maxPoints: 7000 },
  { dpr: 1.5, stars: 1800, nebula: 160, dust: 4500, near: 220, scaffold: 1000, maxPoints: 14000 },
];

const commitVert = /* glsl */ `
uniform float uTime, uReveal, uNow, uScale, uPR, uPulseR, uPulseA, uPulseCh, uFocus, uAper, uFinal;
uniform vec3 uPulseC;
uniform vec4 uCh[${MAXW}]; // per chapter: focus weight, world morph, world brightness
attribute vec3 aColor, aFin;
attribute vec4 aForm;
attribute float aT, aSize, aChap, aSeed;
varying vec3 vColor;
varying float vAlpha, vBloom, vBlur;
void main() {
  vec4 ch = uCh[int(aChap + 0.5)];
  float w = ch.x;
  // chapter "world": the focused chapter's commits leave the galaxy and assemble into its
  // own formation, earliest commits first (aForm.w = time rank inside the chapter)
  float mm = smoothstep(0.0, 1.0, clamp(ch.y * 1.8 - aForm.w * 0.8, 0.0, 1.0));
  // finale: the whole career resolves into one ring, oldest commits first
  float fm = smoothstep(0.0, 1.0, clamp(uFinal * 1.7 - aT * 0.7, 0.0, 1.0));
  vec3 p = mix(position, aForm.xyz, mm);
  p += vec3(sin(uTime * 0.7 + aSeed * 40.0), cos(uTime * 0.6 + aSeed * 23.0), sin(uTime * 0.5 + aSeed * 17.0)) * 0.1 * mm;
  p = mix(p, aFin, fm);
  // mid-flight points bow outward so the morph reads as a swarm, not a cross-fade
  float fly = mm * (1.0 - mm) + fm * (1.0 - fm);
  p += (vec3(aSeed, fract(aSeed * 7.31), fract(aSeed * 13.7)) - 0.5) * fly * 9.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float z = max(0.1, -mv.z);
  // scaffold motes (aSize < 0) are not commits: they only appear, faintly, to outline a formed world
  float scaf = step(aSize, 0.0);
  float fk = ch.z;
  float rev = smoothstep(aT - 0.004, aT + 0.012, uReveal);
  float front = exp(-pow((uReveal - aT) * 70.0, 2.0)) * step(uReveal, 1.01);
  float future = mix(1.0, 0.16, smoothstep(uNow + 0.003, uNow + 0.04, aT) * (1.0 - fm) * (1.0 - mm));
  float tw = 0.72 + 0.28 * sin(uTime * (0.8 + aSeed * 2.6) + aSeed * 61.0);
  float s = mix(abs(aSize), min(abs(aSize), 0.4), mm) * uScale / z * (1.0 + 1.6 * front) * (0.55 + 0.45 * w) * mix(1.0, 0.55 + 0.45 * fk, mm);
  float a = rev * future * tw * w * mix(1.0, fk, mm) * mix(1.0, 0.6, fm) * mix(1.0, 1.9 * mm, scaf);
  // commits streaming in: a light sweeps through the formed world (and the finale ring) in commit order
  float sw = aForm.w - fract(uTime * 0.09);
  float sf = aT - fract(uTime * 0.06);
  float stream = mm * exp(-sw * sw * 600.0) + fm * exp(-sf * sf * 1400.0);
  s *= 1.0 + 0.9 * stream;
  a *= 1.0 + 2.4 * stream;
  // arrival pulse: a shock-wave ring sweeping through the focused chapter's stars
  float same = 1.0 - step(0.5, abs(aChap - uPulseCh));
  float pd = distance(p, uPulseC) - uPulseR;
  float pulse = uPulseA * same * (exp(-pd * pd * 0.12) + 0.35);
  s *= 1.0 + 1.0 * pulse;
  a *= 1.0 + 2.0 * pulse;
  vBloom = clamp((w - 1.0) * 4.0, 0.0, 1.0) + 0.6 * pulse;
  s *= 1.0 + 0.25 * vBloom;
  a *= 1.0 / (1.0 + 0.6 * vBloom + 0.5 * mm);
  // depth of field: out-of-focus commits grow into soft discs and spread their light
  float coc = clamp(abs(z - uFocus) / z * uAper, 0.0, 1.0);
  float s2 = s + coc * 15.0 * uPR;
  a *= mix(1.0, (s * s + 9.0) / (s2 * s2 + 9.0), 0.8);
  // aerial perspective: distant structure dims and cools
  float far = smoothstep(uFocus * 1.25, uFocus * 3.2, z);
  a *= 1.0 - 0.55 * far;
  float ps = max(s2, 2.6 * uPR);
  a *= min(1.0, s2 / (2.6 * uPR));
  gl_PointSize = min(ps, 34.0 * uPR);
  vBlur = coc;
  vAlpha = a * (1.0 + 2.0 * front);
  vec3 c = mix(aColor, vec3(0.42, 0.52, 0.95) * dot(aColor, vec3(0.33)), far * 0.6);
  vColor = mix(c, vec3(1.0), min(1.0, 0.15 + 0.5 * front + 0.4 * pulse + 0.7 * stream));
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

const meteorVert = /* glsl */ `
attribute float aI;
uniform vec3 uHead, uDir;
uniform float uLen, uA, uPR;
varying float vA;
void main() {
  vec3 p = uHead - uDir * aI * uLen;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (3.2 - 2.4 * aI) * uPR;
  vA = uA * pow(1.0 - aI, 1.6);
  gl_Position = projectionMatrix * mv;
}`;
const meteorFrag = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, d)) * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a * 1.6, 1.0);
}`;

const commitFrag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha, vBloom, vBlur;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = dot(p, p) * 4.0;
  if (d > 1.0) discard;
  float core = exp(-d * mix(22.0, 3.0, vBlur));
  float halo = exp(-d * 4.0) * (0.38 + 0.18 * vBloom) * (1.0 - 0.6 * vBlur) + exp(-d * 1.4) * 0.08 * vBloom;
  float disc = vBlur * smoothstep(1.0, 0.75, d) * (0.55 + 0.25 * smoothstep(0.45, 0.9, d));
  float a = (core + halo + disc) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4((vColor * (core + halo + disc) + vec3(core * 0.55 * (1.0 - vBlur))) * vAlpha, 1.0);
}`;

// screen-size twinkling stars (far background)
const softVert = /* glsl */ `
uniform float uTime, uPR, uAlpha;
attribute vec3 aColor;
attribute float aSize, aSeed;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPR;
  vAlpha = uAlpha * (0.55 + 0.45 * sin(uTime * (0.5 + aSeed * 2.0) + aSeed * 90.0));
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

// world-size dust / nebula / near-field motes with depth of field (parallax depth cue)
const bokehVert = /* glsl */ `
uniform float uTime, uScale, uPR, uAlpha, uFocus, uAper, uMaxPx, uNear;
attribute vec3 aColor;
attribute float aSize, aSeed;
varying vec3 vColor;
varying float vAlpha, vBlur;
void main() {
  vec3 p = position + vec3(sin(uTime * 0.11 + aSeed * 30.0), sin(uTime * 0.13 + aSeed * 50.0), cos(uTime * 0.09 + aSeed * 70.0)) * 0.6 * uNear;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float z = max(0.2, -mv.z);
  float s = aSize * uScale / z;
  float coc = clamp(abs(z - uFocus) / z * uAper, 0.0, 1.2);
  float s2 = min(s + coc * uMaxPx * 0.6 * uPR, uMaxPx * uPR);
  vAlpha = uAlpha * mix(1.0, (s * s + 16.0) / (s2 * s2 + 16.0), 0.65 * uNear + 0.25) * smoothstep(1.5, 6.0, z);
  vBlur = min(1.0, coc);
  gl_PointSize = max(s2, 1.5 * uPR);
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
}`;
const bokehFrag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha, vBlur;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = dot(p, p) * 4.0;
  if (d > 1.0) discard;
  float a = mix(exp(-d * 5.0), smoothstep(1.0, 0.7, d) * (0.6 + 0.4 * d), vBlur * 0.8) * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

// full-screen colour grade: deep-space gradient tinted by the focused world, vignette, dither
const bgVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const bgFrag = /* glsl */ `
uniform vec3 uTintA, uTintB;
uniform vec2 uCore;
uniform float uAsp, uTime, uGlow;
varying vec2 vUv;
float h(vec2 q) { return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 asp = vec2(uAsp, 1.0);
  float r = length((vUv - uCore) * asp);
  vec3 col = vec3(0.010, 0.012, 0.028);
  col += uTintA * (0.075 * exp(-r * r * 4.0) + 0.022 * exp(-r * 1.8)) * uGlow;
  col += uTintB * 0.03 * exp(-length((vUv - vec2(0.9, 0.95)) * asp) * 2.2);
  col += vec3(0.05, 0.03, 0.09) * exp(-length((vUv - vec2(0.05, 0.1)) * asp) * 2.0);
  col *= 1.0 - 0.6 * smoothstep(0.35, 1.25, length((vUv - 0.5) * asp * 1.15));
  col += (h(gl_FragCoord.xy + fract(uTime) * 37.0) - 0.5) * (1.5 / 255.0);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------- chapter "worlds": each chapter's commits assemble into a shape of what it was ----------
// local unit-disc coordinates; u = time rank within chapter, a/b/c = per-point randoms
const SHAPES = {
  // ledger: a chain of blocks
  blocks(u, a, b, c, out) {
    const nb = 6, i = Math.min(nb - 1, Math.floor(u * nb));
    const hs0 = 0.25;
    const cx = [-0.62, 0, 0.62][i % 3] * (Math.floor(i / 3) % 2 ? -1 : 1), cy = i < 3 ? 0.36 : -0.36;
    const hs = hs0;
    if (c < 0.12) { // links between consecutive blocks
      const j = Math.min(nb - 2, i), t = a;
      const x0 = [-0.62, 0, 0.62][j % 3] * (Math.floor(j / 3) % 2 ? -1 : 1), y0 = j < 3 ? 0.36 : -0.36;
      const j1 = j + 1, x1 = [-0.62, 0, 0.62][j1 % 3] * (Math.floor(j1 / 3) % 2 ? -1 : 1), y1 = j1 < 3 ? 0.36 : -0.36;
      return out.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0);
    }
    const e = Math.floor(b * 12), t = a * 2 - 1;
    const ax = e >> 2, s1 = e & 1 ? 1 : -1, s2 = e & 2 ? 1 : -1;
    let x = ax === 0 ? t : s1, y = ax === 1 ? t : ax === 0 ? s1 : s2, z = ax === 2 ? t : s2;
    // isometric tilt so the cubes read as 3D
    const ry = 0.62, rx = 0.5;
    let x1 = x * Math.cos(ry) + z * Math.sin(ry), z1 = -x * Math.sin(ry) + z * Math.cos(ry);
    const y1 = y * Math.cos(rx) - z1 * Math.sin(rx); z1 = y * Math.sin(rx) + z1 * Math.cos(rx);
    return out.set(cx + x1 * hs, cy + y1 * hs, z1 * hs);
  },
  // build pipelines: a double helix with rungs
  helix(u, a, b, c, out) {
    const y = u * 2 - 1, th = u * Math.PI * 7;
    const strand = b < 0.5 ? 0 : Math.PI;
    if (c < 0.18) { const t = a * 2 - 1; return out.set(Math.cos(th) * 0.32 * t, y * 0.95, Math.sin(th) * 0.32 * t); }
    const r = 0.32 + (a - 0.5) * 0.05;
    return out.set(Math.cos(th + strand) * r, y * 0.95, Math.sin(th + strand) * r);
  },
  // voice: a waveform of vertical bars
  wave(u, a, b, c, out) {
    const bars = 40, i = Math.min(bars - 1, Math.floor(u * bars)), x = (i + 0.5) / bars * 2 - 1;
    const env = Math.exp(-x * x * 2.2) * (0.35 + 0.65 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.63)));
    const h = 0.08 + 0.72 * env;
    return out.set(x * 0.95, (a * 2 - 1) * h, (b - 0.5) * 0.06);
  },
  // vision: an iris inside a detection box
  eye(u, a, b, c, out) {
    if (c < 0.2) { // corner brackets of the bounding box
      const k = Math.floor(b * 8), corner = k >> 1, sx = corner & 1 ? 1 : -1, sy = corner & 2 ? 1 : -1;
      const L = 0.28 * a;
      return k & 1 ? out.set(sx * (0.92 - L), sy * 0.92, 0) : out.set(sx * 0.92, sy * (0.92 - L), 0);
    }
    if (c < 0.32) { const th = b * Math.PI * 2, r = 0.19 + (a - 0.5) * 0.02; return out.set(Math.cos(th) * r, Math.sin(th) * r, 0); }
    const fib = Math.floor(b * 90), th = (fib / 90) * Math.PI * 2 + (a - 0.5) * 0.03;
    const r = 0.24 + Math.pow(u * 0.5 + a * 0.5, 0.8) * 0.5;
    return out.set(Math.cos(th) * r, Math.sin(th) * r, (c - 0.5) * 0.05);
  },
  // infrastructure: stacked layers, built bottom-up over time
  stack(u, a, b, c, out) {
    const L = Math.min(3, Math.floor(u * 4));
    // each layer: a crisp square outline with a centre cross (the commits trace its edges)
    const H = 0.6, t = (a * 2 - 1) * H;
    let gx, gz;
    if (c < 0.22) { gx = b < 0.5 ? t : 0; gz = b < 0.5 ? 0 : t; } else {
      const e = Math.floor(b * 4);
      gx = e === 0 ? t : e === 1 ? H : e === 2 ? -t : -H; gz = e === 0 ? -H : e === 1 ? t : e === 2 ? H : -t;
    }
    const y = -0.78 + L * 0.52;
    const rx = 0.4, ry = 0.62;
    const x1 = gx * Math.cos(ry) + gz * Math.sin(ry), z1 = -gx * Math.sin(ry) + gz * Math.cos(ry);
    return out.set(x1, y * Math.cos(rx) - z1 * Math.sin(rx), y * Math.sin(rx) + z1 * Math.cos(rx));
  },
  // listening: concentric wavefronts spreading from a source
  ripples(u, a, b, c, out) {
    const ring = Math.min(6, Math.floor(u * 7)), r = 0.14 + ring * 0.135 + (a - 0.5) * 0.02;
    const th = b * Math.PI * 2;
    return out.set(Math.cos(th) * r, Math.sin(th) * r * 0.92, Math.sin(th * 3 + ring) * 0.06);
  },
  // agent OS: a kernel with agents on crossed orbits (atom-like, readable face-on)
  orbits(u, a, b, c, out) {
    if (c < 0.14) { const t = a * 2 - 1, q = Math.sqrt(1 - t * t), th = b * Math.PI * 2, r = 0.12; return out.set(Math.cos(th) * q * r, t * r, Math.sin(th) * q * r); }
    const k = Math.min(3, Math.floor(u * 4)), th = b * Math.PI * 2;
    const R = 0.9 - (k % 2) * 0.12, ecc = 0.36;
    const yaw = [0.0, 1.05, 2.1, 0.52][k];
    const x = Math.cos(th) * R, y = Math.sin(th) * R * ecc, z = Math.sin(th) * R * 0.3;
    return out.set(x * Math.cos(yaw) - y * Math.sin(yaw), x * Math.sin(yaw) + y * Math.cos(yaw), z);
  },
};
const SHAPE_ORDER = ['blocks', 'helix', 'wave', 'eye', 'stack', 'ripples', 'orbits'];
function shapeFor(c, ci) {
  const k = `${c.id || ''} ${c.title || ''}`.toLowerCase();
  if (/ledger|carbon|chain|block/.test(k)) return 'blocks';
  if (/listen|hear|transcri/.test(k)) return 'ripples';
  if (/voice|memory|speech/.test(k)) return 'wave';
  if (/vision|eye|inventory|object|image/.test(k)) return 'eye';
  if (/aws|infra|rebuild|cloud|terraform/.test(k)) return 'stack';
  if (/agent|operating|os\b/.test(k)) return 'orbits';
  if (/night|build|pipeline|ci\b/.test(k)) return 'helix';
  return SHAPE_ORDER[ci % SHAPE_ORDER.length];
}

export async function start({ onFail }) {
  story = (await import('./data/story.json')).default;
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
  // software GL (SwiftShader/llvmpipe etc.) pays a pixel readback on every frame: go lean
  let software = false;
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch { /* ignore */ }
  let tier = devTier() >= 0 ? devTier() : software ? 0 : qualityTier();
  let Q = software ? { ...TIERS[0], dpr: 0.75, scaffold: 140 } : TIERS[tier];
  if (!software && tier === 2) document.documentElement.classList.add('hq');
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
  const nScaf = NC * Q.scaffold;
  const N = count + nRepoNodes + nScaf;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const aT = new Float32Array(N), aSize = new Float32Array(N), aChap = new Float32Array(N), aSeed = new Float32Array(N);
  const aForm = new Float32Array(N * 4), aFin = new Float32Array(N * 3);
  const ptChap = new Int16Array(N);

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
      ptChap[k] = ci;
      if (ci < NC) { chapAcc[ci].c.add(base); chapAcc[ci].n++; if (chapAcc[ci].pts.length < 4000) chapAcc[ci].pts.push(base.clone()); }
      const ra = repoAcc.get(repo) || { c: new Vector3(), n: 0 };
      ra.c.add(base); ra.n++; repoAcc.set(repo, ra);
      k++;
    }
  }
  // constellation nodes: one bright star at each repo centroid
  const chapEndT0 = (ci) => (ci + 0.5) / Math.max(1, NC);
  const repoNode = new Map(), repoIdx = new Map();
  for (const [id, ra] of repoAcc) {
    const c = ra.c.multiplyScalar(1 / ra.n);
    repoNode.set(id, c);
    repoIdx.set(id, k);
    const ci = repoChap.has(id) ? repoChap.get(id) : NC;
    pos.set([c.x, c.y, c.z], k * 3);
    cc.copy(ci < NC ? chapColor[ci] : otherColor).lerp(white, 0.55);
    col.set([cc.r, cc.g, cc.b], k * 3);
    aT[k] = repoStat.get(id).first;
    aSize[k] = 0.55 + Math.min(0.8, Math.log10(1 + ra.n) * 0.3);
    aChap[k] = chapSlot(ci);
    aSeed[k] = hash(id + 0.77);
    ptChap[k] = ci;
    k++;
  }
  // scaffold: faint non-commit motes per chapter, hidden in the galaxy, outlining its formed world
  const chapPts = chapters.map(() => []);
  for (let i = 0; i < count; i++) if (ptChap[i] < NC) chapPts[ptChap[i]].push(i);
  for (let ci = 0; ci < NC; ci++) {
    if (maybeYield()) await yieldNow();
    const src = chapPts[ci];
    for (let j = 0; j < Q.scaffold; j++) {
      const h1 = hash(ci * 101.3 + j * 1.71 + 0.3), h2 = hash(ci * 57.1 + j * 2.93 + 0.7);
      const from = src.length ? src[Math.floor(h1 * src.length)] : -1;
      if (from >= 0) {
        pos.set([pos[from * 3] + (h2 - 0.5) * 2, pos[from * 3 + 1] + (hash(j * 3.3 + ci) - 0.5), pos[from * 3 + 2] + (hash(j * 4.7 + ci) - 0.5) * 2], k * 3);
        aT[k] = clamp(aT[from] + (h2 - 0.5) * 0.01, 0, 1);
      } else { arm(chapEndT0(ci), tmp); pos.set([tmp.x, tmp.y, tmp.z], k * 3); aT[k] = chapEndT0(ci); }
      cc.copy(chapColor[ci]).lerp(white, 0.4);
      col.set([cc.r, cc.g, cc.b], k * 3);
      aSize[k] = -(0.12 + h2 * 0.08);
      aChap[k] = chapSlot(ci);
      aSeed[k] = hash(k * 0.37 + 0.5);
      ptChap[k] = ci;
      k++;
    }
  }
  await yieldNow();

  // ---------- chapter centres, viewing directions, worlds ----------
  const chapInfo = chapAcc.map((a, ci) => {
    let c;
    if (a.n) c = a.c.clone().multiplyScalar(1 / a.n);
    else { c = new Vector3(); arm(chapEndT0(ci), c); }
    let rad = 4;
    if (a.pts.length) rad = Math.sqrt(a.pts.reduce((s, p) => s + p.distanceToSquared(c), 0) / a.pts.length);
    const radial = new Vector3(c.x, 0, c.z);
    if (radial.lengthSq() < 1e-4) radial.set(1, 0, 0);
    radial.normalize();
    const tang = new Vector3(-radial.z, 0, radial.x);
    const dir = radial.clone().multiplyScalar(0.55).add(new Vector3(0, 0.62, 0)).add(tang.multiplyScalar(ci % 2 ? 0.45 : -0.45)).normalize();
    const D = rad * 2.6 + 14;
    return { c, rad, dir, D };
  });
  const UP = new Vector3(0, 1, 0);
  const basis = (f) => {
    const r = new Vector3().crossVectors(UP, f).normalize();
    return { r, u: new Vector3().crossVectors(f, r).normalize(), f };
  };
  // per-chapter time ranks
  const byChap = chapters.map(() => []);
  for (let i = 0; i < N; i++) if (ptChap[i] < NC) byChap[ptChap[i]].push(i);
  const nodeForm = new Map();
  const lp = new Vector3();
  for (let ci = 0; ci < NC; ci++) {
    const c = chapters[ci];
    await yieldNow();
    const idx = byChap[ci].sort((a, b) => aT[a] - aT[b]);
    const { c: ctr, dir, D } = chapInfo[ci];
    const B = basis(dir);
    const S = 0.3 * D * 1.12;
    const shape = SHAPES[shapeFor(c, ci)];
    idx.forEach((i, rank) => {
      const u = idx.length > 1 ? rank / (idx.length - 1) : 0;
      shape(u, hash(i * 1.37 + 0.11), hash(i * 2.71 + 0.53), hash(i * 3.97 + 0.29), lp);
      const x = ctr.x + (B.r.x * lp.x + B.u.x * lp.y + B.f.x * lp.z) * S;
      const y = ctr.y + (B.r.y * lp.x + B.u.y * lp.y + B.f.y * lp.z) * S;
      const z = ctr.z + (B.r.z * lp.x + B.u.z * lp.y + B.f.z * lp.z) * S;
      aForm.set([x, y, z, u], i * 4);
    });
  }
  for (const [id, i] of repoIdx) if (ptChap[i] < NC) nodeForm.set(id, new Vector3(aForm[i * 4], aForm[i * 4 + 1], aForm[i * 4 + 2]));
  for (let i = 0; i < N; i++) if (ptChap[i] >= NC) aForm.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], 0], i * 4);

  // ---------- finale: the whole career as one ring, clockwise from the top ----------
  const finDir = new Vector3(0.18, 0.5, 1).normalize();
  // ring angle: mostly commit-weighted (a full, even ring), still monotonic in time
  const ringT = (t) => {
    const x = clamp(t, 0, 1) * (cdf.length - 2), i = Math.floor(x), f = x - i;
    return 0.25 * t + 0.75 * (cdf[i] + (cdf[i + 1] - cdf[i]) * f) / cdfMax;
  };
  const FB = basis(finDir);
  const RF = 22, tilt = 0.42;
  const fy = FB.u.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(FB.f, Math.sin(tilt));
  const fz = FB.f.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(FB.u, -Math.sin(tilt));
  await yieldNow();
  for (let i = 0; i < N; i++) {
    if ((i & 511) === 0 && maybeYield()) await yieldNow();
    const node = i >= count && i < count + nRepoNodes;
    const th = Math.PI / 2 - (0.03 + ringT(aT[i]) * 0.94) * Math.PI * 2;
    const ci = ptChap[i];
    const g = hash(i * 0.71 + 3) + hash(i * 1.93 + 5) + hash(i * 2.77 + 7) - 1.5;
    const R = node ? RF * 0.88 : RF * (1 + g * 0.05 + (ci < NC ? ((ci % 3) - 1) * 0.03 : 0));
    const h = (hash(i * 4.1 + 9) - 0.5) * (node ? 0 : 1.6);
    const cx = Math.cos(th) * R, sy = Math.sin(th) * R;
    aFin.set([FB.r.x * cx + fy.x * sy + fz.x * h, FB.r.y * cx + fy.y * sy + fz.y * h, FB.r.z * cx + fy.z * sy + fz.z * h], i * 3);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new BufferAttribute(col, 3));
  geo.setAttribute('aT', new BufferAttribute(aT, 1));
  geo.setAttribute('aSize', new BufferAttribute(aSize, 1));
  geo.setAttribute('aChap', new BufferAttribute(aChap, 1));
  geo.setAttribute('aSeed', new BufferAttribute(aSeed, 1));
  geo.setAttribute('aForm', new BufferAttribute(aForm, 4));
  geo.setAttribute('aFin', new BufferAttribute(aFin, 3));
  const W = new Float32Array(MAXW).fill(1);
  const M = new Float32Array(MAXW);
  // per-world brightness: dense chapters spread their light so formations stay crisp, not white-out
  const FK = new Float32Array(MAXW).fill(1);
  byChap.forEach((idx, ci) => { FK[chapSlot(ci)] = clamp(Math.sqrt(520 / Math.max(1, idx.length)), 0.4, 1); });
  const CH = Array.from({ length: MAXW }, () => new Vector4());
  const packCh = () => { for (let i = 0; i < MAXW; i++) CH[i].set(W[i], M[i], FK[i], 0); };
  packCh();
  const uniforms = {
    uTime: { value: 0 }, uReveal: { value: 0 }, uNow: { value: 1 }, uScale: { value: 400 },
    uPR: { value: 1 }, uCh: { value: CH }, uFinal: { value: 0 },
    uFocus: { value: 60 }, uAper: { value: 0.6 },
    uPulseC: { value: new Vector3() }, uPulseR: { value: 0 }, uPulseA: { value: 0 }, uPulseCh: { value: -5 },
  };
  const commitMat = new ShaderMaterial({
    uniforms, vertexShader: commitVert, fragmentShader: commitFrag,
    transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
  });
  const scene = new Scene();
  const galaxy = new Group();
  scene.add(galaxy);

  // colour-graded deep-space backdrop (one cheap full-screen triangle)
  const bgGeo = new BufferGeometry();
  bgGeo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const bgU = { uTintA: { value: new Color('#5b6cff') }, uTintB: { value: new Color('#2ec4d6') }, uCore: { value: { x: 0.5, y: 0.6 } }, uAsp: { value: 1 }, uTime: uniforms.uTime, uGlow: { value: 1 } };
  const bg = new Mesh(bgGeo, new ShaderMaterial({ uniforms: bgU, vertexShader: bgVert, fragmentShader: bgFrag, depthTest: false, depthWrite: false }));
  bg.frustumCulled = false;
  bg.renderOrder = -10;
  scene.add(bg);

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
    const nv = seg.length, lpos = new Float32Array(nv * 3), lf = new Float32Array(nv * 3), lo = new Float32Array(nv), le = new Float32Array(nv);
    const nSeg = nv / 2;
    for (let i = 0; i < nv; i++) {
      const sIdx = i >> 1, fr = seg[sIdx * 2];
      lpos.set([seg[i].x, seg[i].y, seg[i].z], i * 3);
      lf.set([fr.x, fr.y, fr.z], i * 3);
      lo[i] = (sIdx / Math.max(1, nSeg)) * 0.667;
      le[i] = i & 1;
    }
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(lpos, 3));
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

  // ---------- shooting star (trail computed in the vertex shader; no buffer updates) ----------
  const MN = 36;
  const mGeo = new BufferGeometry();
  mGeo.setAttribute('position', new BufferAttribute(new Float32Array(MN * 3), 3));
  mGeo.setAttribute('aI', new BufferAttribute(Float32Array.from({ length: MN }, (_, i) => i / (MN - 1)), 1));
  const meteorU = { uHead: { value: new Vector3() }, uDir: { value: new Vector3(1, 0, 0) }, uLen: { value: 14 }, uA: { value: 0 }, uPR: uniforms.uPR, uColor: { value: new Color(1, 1, 1) } };
  const meteor = new Points(mGeo, new ShaderMaterial({
    uniforms: meteorU, vertexShader: meteorVert, fragmentShader: meteorFrag,
    transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: false,
  }));
  meteor.frustumCulled = false;
  meteor.visible = false;
  galaxy.add(meteor);
  const mState = { t: 9, life: 1.3, from: new Vector3(), vel: new Vector3(), next: 5 };
  function launchMeteor(target, color) {
    const dir = new Vector3(hash(time * 3.1) - 0.5, (hash(time * 5.3) - 0.5) * 0.4, hash(time * 7.7) - 0.5).normalize();
    const c = target || new Vector3((hash(time) - 0.5) * 50, (hash(time * 1.7) - 0.5) * 10, (hash(time * 2.3) - 0.5) * 50);
    mState.from.copy(c).addScaledVector(dir, -22);
    mState.vel.copy(dir).multiplyScalar(36);
    mState.t = 0;
    meteorU.uDir.value.copy(dir);
    meteorU.uColor.value.copy(color || white).lerp(white, 0.4);
    meteor.visible = true;
  }

  // ---------- background stars, galactic dust, nebula, near-field motes ----------
  async function pointLayer(n, fill, vert, frag, extra) {
    const p = new Float32Array(n * 3), c = new Float32Array(n * 3), s = new Float32Array(n), sd = new Float32Array(n);
    for (let i = 0; i < n; i++) { if ((i & 255) === 0 && maybeYield()) await yieldNow(); fill(i, p, c, s, sd); }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(p, 3));
    g.setAttribute('aColor', new BufferAttribute(c, 3));
    g.setAttribute('aSize', new BufferAttribute(s, 1));
    g.setAttribute('aSeed', new BufferAttribute(sd, 1));
    const m = new ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uScale: uniforms.uScale, uPR: uniforms.uPR, uFocus: uniforms.uFocus, ...extra },
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
    });
    const pts = new Points(g, m);
    pts.frustumCulled = false;
    return pts;
  }
  const stars = await pointLayer(Q.stars, (i, p, c, s, sd) => {
    const u = hash(i * 1.1 + 5) * 2 - 1, a = hash(i * 2.3 + 9) * Math.PI * 2, r = 160 + hash(i * 3.7) * 180;
    const q = Math.sqrt(1 - u * u);
    p.set([Math.cos(a) * q * r, u * r, Math.sin(a) * q * r], i * 3);
    const tint = hash(i * 4.4);
    c.set(tint > 0.8 ? [1, 0.85, 0.7] : tint > 0.5 ? [0.75, 0.85, 1] : [0.9, 0.92, 1], i * 3);
    s[i] = 1.2 + hash(i * 6.1) ** 3 * 3.5;
    sd[i] = hash(i * 8.8);
  }, softVert, softFrag, { uAlpha: { value: 0.75 } });
  scene.add(stars);
  // galactic dust: faint non-commit particles tracing the spiral arms (structure only)
  const dustU = { uAlpha: { value: 0.85 }, uAper: { value: 0.6 }, uMaxPx: { value: 16 }, uNear: { value: 0 } };
  const dust = await pointLayer(Q.dust, (i, p, c, s, sd) => {
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
    s[i] = 0.07 + hash(i * 9.1) * 0.09;
    sd[i] = hash(i * 1.9);
  }, bokehVert, bokehFrag, dustU);
  galaxy.add(dust);
  let nebula = null, nebulaU = null;
  if (NC > 0) {
    nebula = await pointLayer(Q.nebula + 14, (i, p, c, s, sd) => {
      if (i < 14) { // warm core
        p.set([(hash(i) - 0.5) * 4, (hash(i + 3) - 0.5) * 2, (hash(i + 7) - 0.5) * 4], i * 3);
        c.set([1.4, 1.0, 0.75], i * 3); s[i] = 5 + hash(i + 1) * 9; sd[i] = 0; return;
      }
      const t = hash(i * 1.7 + 0.2);
      arm(warp(t), tmp);
      tmp.x += (hash(i * 2.9) - 0.5) * 10; tmp.y += (hash(i * 3.3) - 0.5) * 4; tmp.z += (hash(i * 4.1) - 0.5) * 10;
      p.set([tmp.x, tmp.y, tmp.z], i * 3);
      // colour by chapter covering this time
      const day = t * span;
      let ci = -1, bestD = Infinity;
      for (const [d, repo] of days) { const dd = Math.abs(d - day); if (dd < bestD) { bestD = dd; ci = repoChap.has(repo) ? repoChap.get(repo) : -1; } if (d > day) break; }
      const col3 = ci >= 0 ? chapColor[ci] : otherColor;
      c.set([col3.r, col3.g, col3.b], i * 3);
      s[i] = 9 + hash(i * 5.5) * 16; sd[i] = hash(i * 6.6);
    }, bokehVert, bokehFrag, nebulaU = { uAlpha: { value: 0.07 }, uAper: { value: 0 }, uMaxPx: { value: 380 }, uNear: { value: 0 } });
    galaxy.add(nebula);
  }
  // near-field motes: sparse soft discs throughout the volume; they drift past the lens as the
  // camera flies, which is what sells depth and scale on a phone
  let motes = null;
  if (Q.near) {
    motes = await pointLayer(Q.near, (i, p, c, s, sd) => {
      const a = hash(i * 3.3 + 1) * Math.PI * 2, r = 8 + Math.sqrt(hash(i * 5.1 + 2)) * 85;
      p.set([Math.cos(a) * r, (hash(i * 7.9 + 3) - 0.5) * (14 + r * 0.5), Math.sin(a) * r], i * 3);
      const ci = Math.floor(hash(i * 2.2) * Math.max(1, NC));
      cc.copy(chapColor[ci] || otherColor).lerp(white, 0.45);
      c.set([cc.r, cc.g, cc.b], i * 3);
      s[i] = 0.12 + hash(i * 6.6) * 0.22; sd[i] = hash(i * 9.4);
    }, bokehVert, bokehFrag, { uAlpha: { value: 0.55 }, uAper: { value: 1.1 }, uMaxPx: { value: 70 }, uNear: { value: 1 } });
    galaxy.add(motes);
  }

  await yieldNow();
  // ---------- camera keyframes ----------
  const camera = new PerspectiveCamera(50, 1, 0.5, 900);
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
  const heroTint = new Color('#6a5cff'), impactTint = new Color('#4f8cff'), ctaTint = new Color('#ff9e5e');
  let mobile = false;
  const keys = []; // {pos, look, ox, oy, t, show, ap, tint}
  function buildKeys() {
    keys.length = 0;
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    mobile = aspect < 0.9;
    const fit = mobile ? 1.55 / Math.max(0.45, aspect) * 0.62 : 1;
    // hero: the galaxy fills the phone screen above the name and bleeds off the edges
    const hd = mobile ? 92 * Math.min(1.25, 0.5 / Math.max(0.4, aspect)) : 80;
    const hel = mobile ? 0.98 : 0.82;
    const hero = { pos: new Vector3(0, Math.sin(hel), Math.cos(hel)).multiplyScalar(hd), look: new Vector3(0, -2, 0), ox: mobile ? 0 : 0.2, oy: mobile ? -0.24 : 0, t: 1, show: 1, ap: 0.55, tint: heroTint };
    const impact = { pos: new Vector3(46, 22, -40).multiplyScalar(fit * (mobile ? 0.9 : 0.95)), look: new Vector3(0, 0, 0), ox: mobile ? 0 : 0.24, oy: mobile ? -0.3 : 0, t: 1, show: 1, ap: 0.7, tint: impactTint };
    const cd = mobile ? RF / (0.466 * Math.max(0.42, aspect)) / 0.92 : RF / 0.466 / 0.94;
    const cta = { pos: finDir.clone().multiplyScalar(cd), look: new Vector3(0, 0, 0), ox: 0, oy: mobile ? 0.02 : 0, t: 1, show: 1, ap: 0.12, tint: ctaTint };
    const chapKeys = [];
    chapters.forEach((c, ci) => {
      const { c: ctr, dir, D } = chapInfo[ci];
      chapKeys.push({ pos: ctr.clone().addScaledVector(dir, D * (mobile ? 1.75 : 1.12)), look: ctr.clone(), ox: mobile ? 0 : 0.22, oy: mobile ? -0.26 : 0, t: chapEndT[ci], show: (Math.min(chapStartT[ci], chapEndT[ci]) + chapEndT[ci]) / 2, ap: 1.0, tint: chapColor[ci] });
    });
    steps.forEach((el, i) => {
      const kd = stepKind[i];
      keys.push(kd === 'hero' ? hero : kd === 'impact' ? impact : kd === 'cta' ? cta : chapKeys[stepCh[i]] || hero);
    });
  }

  // ---------- scroll mapping ----------
  const fadeSecs = [...document.querySelectorAll('.chapter, .impact-sec')].map((sec) => ({ sec, panel: sec.querySelector('.panel, .impact-inner'), top: 0, bottom: 0 }));
  let holds = [];
  let panelRight = 0;
  function measure() {
    const vh = window.innerHeight;
    const pr = document.querySelector('.chapter .panel')?.getBoundingClientRect();
    panelRight = !mobile && pr ? pr.right + 8 : 0;
    const maxS = Math.max(1, document.documentElement.scrollHeight - vh);
    for (const F of fadeSecs) { const r = F.sec.getBoundingClientRect(); F.top = r.top + window.scrollY; F.bottom = r.bottom + window.scrollY; }
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
  const root = document.documentElement;
  const playhead = document.getElementById('playhead');
  const scrubDate = document.getElementById('scrub-date');
  const scrubTitle = document.getElementById('scrub-title');
  const marks = [...document.querySelectorAll('.scrubber [data-ch]')];
  const range = document.getElementById('scrub-range');
  const endTxt = fmtDate(t0 + span * 86400000);
  const fullSpanTxt = `${fmtDate(t0)} – ${endTxt}`;
  let lastDate = '', lastRange = -2, trackW = 0;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const periodTxt = chapters.map((c) => {
    const f = (str) => { const m = /^(\d{4})-(\d{2})/.exec(str || ''); return m ? [+m[1], +m[2] - 1] : null; };
    const a = f(c.period?.start), b = f(c.period?.end);
    if (!a || !b) return a ? `${MON[a[1]]} ${a[0]}` : '';
    if (a[0] === b[0]) return a[1] === b[1] ? `${MON[a[1]]} ${a[0]}` : `${MON[a[1]]}–${MON[b[1]]} ${a[0]}`;
    return `${MON[a[1]]} ${a[0]} – ${MON[b[1]]} ${b[0]}`;
  });
  const labelsEl = document.getElementById('labels');
  const repoById = new Map((story.repos || []).map((r) => [r.id, r]));
  const placed = [];
  const labelSets = chapters.map((c, ci) => {
    const hasFeatured = (story.repos || []).some((r) => typeof r.featured === 'boolean');
    const ids = [...repoNode.keys()].filter((id) => repoChap.get(id) === ci)
      .filter((id) => { const r = repoById.get(id); return !hasFeatured || (r && (r.featured || (r.public && r.url))); })
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
      labelsEl.appendChild(el);
      return { el, id, rank, w: 0 };
    });
  });
  // measure every label once, in one read pass (never inside the frame loop)
  // (12px monospace: ~7.25px per glyph + 18px padding) estimated, so boot never forces a layout
  labelSets.flat().forEach((L) => { L.w = 20 + L.el.textContent.length * 7.25; });

  await yieldNow();
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
    bgU.uAsp.value = w / h;
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
  if (window.ResizeObserver) {
    let mq = 0;
    new ResizeObserver(() => { if (!mq) mq = requestAnimationFrame(() => { mq = 0; measure(); }); }).observe(document.getElementById('story'));
  }

  let mx = 0, my = 0, tmx = 0, tmy = 0;
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    tmx = e.clientX / vw - 0.5; tmy = e.clientY / vh - 0.5;
  }, { passive: true });

  // ---------- loop ----------
  const camPos = new Vector3(), camLook = new Vector3(), tPos = new Vector3(), tLook = new Vector3();
  const wTarget = new Float32Array(MAXW);
  const tint = new Color().copy(heroTint), tintT = new Color();
  let raf = 0, last = 0, time = 0, first = true;
  let nowT = 1, showT = 1, curStep = -1, arrivedCh = -1, pulseT = 9, ap = 0.55, scrolled = false;
  const lineDraw = chapters.map(() => 1);
  let perfAcc = 0, perfN = 0, degraded = false;
  let startAt = performance.now();
  await yieldNow();
  resize(true);

  function stepWeights(i, out) {
    const ch = stepCh[i];
    if (ch < 0) { out.fill(1); return; }
    out.fill(0.24);
    out[chapSlot(ch)] = 1.25;
  }
  const wa = new Float32Array(MAXW), wb = new Float32Array(MAXW);

  let prevRaf = 0, tick = 0, settled = false, lastY = -1, interacted = false, revealDone = false;
  const markInteract = () => { interacted = true; };
  for (const ev of ['scroll', 'pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel']) window.addEventListener(ev, markInteract, { passive: true, once: true });
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const rafDt = prevRaf ? (now - prevRaf) / 1000 : 0.016;
    prevRaf = now;
    tick++;
    // before the visitor interacts (and once the intro is done) idle at a lower rate; once the
    // camera and worlds have settled, ~30fps keeps twinkle/streams alive at half the cost
    const idleSkip = (!interacted && revealDone ? 3 : settled ? 2 : 1) * (software ? 3 : 1);
    if (window.scrollY === lastY && tick % idleSkip !== 0) return;
    lastY = window.scrollY;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now; time += dt;
    uniforms.uTime.value = time;
    // (reads first, before any DOM writes this frame) fade panels as they leave the top
    // section geometry is cached by measure(): no forced style/layout inside the frame
    const sy = window.scrollY;
    for (const F of fadeSecs) {
      const r = { top: F.top - sy, bottom: F.bottom - sy };
      if (r.bottom < -50 || r.top > vh) continue;
      // class toggle + CSS transition (compositor-driven) instead of per-frame inline opacity
      const gone = r.bottom < vh * 0.42;
      if (F.gone !== gone && F.panel) { F.gone = gone; F.panel.classList.toggle('gone', gone); }
    }
    const sc = window.scrollY > vh * 0.12;
    if (sc !== scrolled) { scrolled = sc; root.classList.toggle('scrolled', sc); }

    // adaptive quality: if we can't hold ~40fps, drop resolution and the heavier layers
    if (time > 2 && !degraded && devTier() < 0) {
      perfAcc += rafDt; perfN++;
      if (perfN >= 90) {
        if (perfAcc / perfN > 1 / 40) {
          degraded = true; Q = { ...TIERS[0] };
          if (nebula) nebula.visible = false;
          if (motes) motes.visible = false;
          document.documentElement.classList.remove('hq');
          resize(true);
        }
        perfAcc = 0; perfN = 0;
      }
    }

    // intro: stars ignite chronologically, from the core outward along the arm
    const el = (now - startAt) / 1000 - 0.15;
    const rv = clamp(el / 2.6, 0, 1);
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

    // cinematic intro: the camera swings in on an arc from low and far while the stars ignite
    const qi = clamp(el / 3.4, 0, 1);
    if (qi < 1 && P < 0.5) {
      const e = 1 - Math.pow(1 - qi, 3);
      const v = tmp.copy(tPos).sub(tLook);
      const ang = (1 - e) * 1.6, ca = Math.cos(ang), sa = Math.sin(ang);
      const vx = v.x * ca - v.z * sa, vz = v.x * sa + v.z * ca;
      v.set(vx, v.y * (0.3 + 0.7 * e), vz).multiplyScalar(1 + (1 - e) * 0.6);
      tPos.copy(tLook).add(v);
    }
    if (first) {
      camPos.copy(tPos); camLook.copy(tLook); first = false;
      view.ox = (A.ox + (B.ox - A.ox) * f); view.oy = (A.oy + (B.oy - A.oy) * f);
      applyView();
    }
    const kk = qi < 1 && P < 0.5 ? 8 : 2.6;
    camPos.x = damp(camPos.x, tPos.x, kk, dt); camPos.y = damp(camPos.y, tPos.y, kk, dt); camPos.z = damp(camPos.z, tPos.z, kk, dt);
    camLook.x = damp(camLook.x, tLook.x, 3, dt); camLook.y = damp(camLook.y, tLook.y, 3, dt); camLook.z = damp(camLook.z, tLook.z, 3, dt);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    // on phones the flight happens in the lower part of the screen (panels exit at the top)
    const tox = A.ox + (B.ox - A.ox) * f, toy = A.oy + (B.oy - A.oy) * f + (mobile && i0 !== i1 ? Math.sin(Math.PI * f) * 0.42 : 0);
    if (Math.abs(tox - view.ox) + Math.abs(toy - view.oy) > 1e-4) {
      view.ox = damp(view.ox, tox, 3, dt); view.oy = damp(view.oy, toy, 3, dt); applyView();
    }
    // focus + colour grade follow the camera's subject
    uniforms.uFocus.value = camPos.distanceTo(camLook);
    ap = damp(ap, A.ap + (B.ap - A.ap) * f, 3, dt);
    uniforms.uAper.value = ap;
    dustU.uAper.value = ap * 0.8;
    tintT.copy(A.tint).lerp(B.tint, f);
    tint.r = damp(tint.r, tintT.r, 2.5, dt); tint.g = damp(tint.g, tintT.g, 2.5, dt); tint.b = damp(tint.b, tintT.b, 2.5, dt);
    bgU.uTintA.value.copy(tint);
    tmp.copy(camLook).project(camera);
    bgU.uCore.value.x = tmp.x * 0.5 + 0.5; bgU.uCore.value.y = tmp.y * 0.5 + 0.5;

    // chapter focus weights, world morphs, finale + "now" time
    stepWeights(i0, wa); stepWeights(i1, wb);
    for (let i = 0; i < MAXW; i++) { wTarget[i] = wa[i] + (wb[i] - wa[i]) * f; W[i] = damp(W[i], wTarget[i], 4, dt); }
    let busy = false;
    for (let ci = 0; ci < NC && ci < MAXW; ci++) {
      const x = (stepCh[i0] === ci ? 1 - f : 0) + (stepCh[i1] === ci ? f : 0);
      const tgt = rv < 1 ? 0 : clamp((x - 0.45) / 0.45, 0, 1);
      const sl = chapSlot(ci);
      M[sl] = Math.abs(M[sl] - tgt) < 0.002 ? tgt : damp(M[sl], tgt, tgt > M[sl] ? 1.5 : 2.4, dt);
      if (M[sl] !== tgt) busy = true;
    }
    const xf = (stepKind[i0] === 'cta' ? 1 - f : 0) + (stepKind[i1] === 'cta' ? f : 0);
    const ftg = clamp((xf - 0.35) / 0.5, 0, 1);
    const fin = uniforms.uFinal.value;
    uniforms.uFinal.value = Math.abs(fin - ftg) < 0.002 ? ftg : damp(fin, ftg, ftg > fin ? 1.2 : 2.4, dt);
    if (uniforms.uFinal.value !== ftg) busy = true;
    let mMax = 0;
    for (let i = 0; i < MAXW; i++) mMax = Math.max(mMax, M[i]);
    dustU.uAlpha.value = 0.85 * (1 - 0.6 * uniforms.uFinal.value) * (1 - 0.35 * mMax);
    if (nebulaU) nebulaU.uAlpha.value = 0.07 * (1 - 0.85 * mMax);
    const tNow = A.t + (B.t - A.t) * f;
    nowT = damp(nowT, tNow, 4, dt);
    const showTarget = A.show + (B.show - A.show) * f;
    showT = Math.abs(showT - showTarget) < 0.001 ? showTarget : damp(showT, showTarget, 5, dt);
    const shown = rv < 1 ? Math.min(showT, reveal) : showT;
    uniforms.uNow.value = rv < 1 ? 1.1 : nowT;

    lineMats.forEach((m, ci) => {
      if (!m) return;
      const on = reveal >= (chapEndT[ci] - 0.05) ? 1 : 0;
      const focused = ci === arrivedCh;
      lineDraw[ci] = focused ? Math.min(1, lineDraw[ci] + dt / 1.8) : 1;
      m.uniforms.uDraw.value = lineDraw[ci];
      const away = (1 - M[chapSlot(ci)]) * (1 - uniforms.uFinal.value);
      m.uniforms.uOpacity.value = on * away * (focused ? 0.75 : clamp(0.06 + (W[chapSlot(ci)] - 0.2) * 0.5, 0.03, 0.55));
    });

    // HUD
    playhead.style.transform = `translateX(${(shown * trackW).toFixed(1)}px)`;
    const s = Math.round(P);
    const activeCh = Math.abs(P - s) < 0.35 ? stepCh[s] : -1;
    const kindS = Math.abs(P - s) < 0.35 ? stepKind[s] : '';
    const dateTxt = rv < 1 ? fmtDate(t0 + shown * span * 86400000)
      : activeCh >= 0 ? periodTxt[activeCh]
        : kindS === 'impact' ? fullSpanTxt
          : kindS === 'hero' || kindS === 'cta' ? `Now · ${endTxt}`
            : fmtDate(t0 + shown * span * 86400000);
    if (dateTxt !== lastDate) { scrubDate.textContent = dateTxt; lastDate = dateTxt; }
    const rangeKey = activeCh >= 0 ? activeCh : kindS === 'impact' && rv >= 1 ? -9 : -1;
    if (rangeKey !== lastRange) {
      lastRange = rangeKey;
      if (range) {
        if (rangeKey === -9) {
          range.style.transform = 'translateX(0) scaleX(1)'; range.style.opacity = '1';
        } else if (activeCh >= 0) {
          const a0 = Math.min(chapStartT[activeCh], chapEndT[activeCh]);
          range.style.transform = `translateX(${(a0 * 100).toFixed(2)}%) scaleX(${Math.max(0.006, chapEndT[activeCh] - a0).toFixed(4)})`;
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
        launchMeteor(chapInfo[arr].c, chapColor[arr]);
        ring.position.copy(chapInfo[arr].c);
        ringU.uColor.value.copy(chapColor[arr]);
        ringU.uSize.value = chapInfo[arr].rad * 7 + 18;
        uniforms.uPulseCh.value = chapSlot(arr);
      }
    }
    pulseT += dt;
    mState.next -= dt;
    if (mState.next <= 0 && rv >= 1) { launchMeteor(null, null); mState.next = 7 + hash(time) * 6; }
    if (mState.t < mState.life) {
      mState.t += dt;
      const kq = mState.t / mState.life;
      meteorU.uHead.value.copy(mState.from).addScaledVector(mState.vel, mState.t);
      meteorU.uA.value = Math.sin(Math.PI * clamp(kq, 0, 1)) * 0.9;
      meteorU.uLen.value = 6 + 12 * Math.min(1, kq * 3);
    } else if (meteor.visible) meteor.visible = false;
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

    // repo labels ride on the focused chapter's formed world
    const focusCh = Math.abs(P - s) < 0.42 ? stepCh[s] : -1;
    const lblA = focusCh >= 0 ? (1 - Math.abs(P - s) / 0.42) * smooth(clamp((M[chapSlot(focusCh)] - 0.85) / 0.15, 0, 1)) : 0;
    placed.length = 0;
    labelSets.forEach((set, ci) => {
      for (const L of set) {
        const show = ci === focusCh && rv >= 1 && lblA > 0.01 && L.rank < (mobile ? 3 : 5);
        if (!show) { if (L.vis) { L.el.style.opacity = '0'; L.vis = false; } continue; }
        tmp.copy(nodeForm.get(L.id) || repoNode.get(L.id)).applyMatrix4(galaxy.matrixWorld).project(camera);
        const x = (tmp.x * 0.5 + 0.5) * vw, y = (-tmp.y * 0.5 + 0.5) * vh;
        const bw = L.w, bh = 24, by = y - 12;
        const flip = x + bw > vw - 6;
        let bx = flip ? x - bw : x;
        if (flip !== !!L.flip) { L.flip = flip; L.el.classList.toggle('flip', flip); }
        if (bx < 6) bx = 6;
        if (bx + bw > vw - 6) bx = vw - 6 - bw;
        const clash = tmp.z > 1 || x < 0 || x > vw || bx < panelRight || y < 8 || y > vh - 90 ||
          placed.some((q) => bx < q.x + q.w && bx + bw > q.x && by < q.y + q.h && by + bh > q.y);
        if (clash) { if (L.vis) { L.el.style.opacity = '0'; L.vis = false; } continue; }
        placed.push({ x: bx, y: by, w: bw, h: bh });
        L.el.style.transform = `translate(${bx.toFixed(1)}px, ${y.toFixed(1)}px)`;
        const o = lblA.toFixed(2);
        if (L.o !== o) { L.o = o; L.el.style.opacity = o; }
        L.vis = true;
      }
    });

    revealDone = rv >= 1 && el > 3.5;
    settled = rv >= 1 && !busy && pulseT > 1.7 && mState.t >= mState.life && camPos.distanceToSquared(tPos) < 0.002 && Math.abs(nowT - tNow) < 0.002;
    packCh();
    renderer.render(scene, camera);
    if (!root.classList.contains('gl-on')) root.classList.add('gl-on');
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

  // compile one program per task so no single task blocks for long
  await yieldNow();
  const parallel = !!renderer.compileAsync && renderer.extensions.has('KHR_parallel_shader_compile');
  const objs = [];
  scene.traverse((o) => { if (o.material) objs.push(o); });
  for (const o of objs) {
    try {
      if (parallel) await renderer.compileAsync(o, camera, scene);
      else renderer.compile(o, camera, scene);
      // warm-up draw: forces program link + buffer upload for this object in its own task
      // (skipped on software GL, where every draw also costs a full-canvas readback/commit)
      if (!software) { await yieldNow(); const v = o.visible; o.visible = true; renderer.render(o, camera); o.visible = v; }
      else {
        // force the (otherwise lazy) program link now, in this task, without a draw
        const gl = renderer.getContext();
        for (const pr of renderer.info.programs || []) if (pr.program && !pr._linked) { pr._linked = true; gl.getProgramParameter(pr.program, gl.LINK_STATUS); }
      }
    } catch { /* lazy compile on first frame */ }
    await yieldNow();
  }
  // panels below the fold rise in when they enter (per-element class: no global restyle)
  for (const el of revealEls) if (el.getBoundingClientRect().top > window.innerHeight) el.classList.add('pre');
  startAt = performance.now();
  play();
  // lay out the off-screen story sections in idle slices (one per slice) during the intro,
  // so the first visit to each chapter never pays a first-time layout mid-scroll
  const idle = window.requestIdleCallback || ((cb) => setTimeout(() => cb({ timeRemaining: () => 8 }), 120));
  const pending = fadeSecs.map((F) => F.sec);
  const next = () => {
    const sec = pending.shift();
    if (!sec) { measure(); return; }
    sec.classList.add('cv-on');
    void sec.offsetHeight;
    idle(next, { timeout: 1500 });
  };
  idle(next, { timeout: 2500 });
}
