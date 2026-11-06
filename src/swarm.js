// The WebGL show: one Blender-modelled quadcopter per commit. Between formations every drone flies a
// choreographed curve, as in a real drone show: out of where it is, through a lift, into its slot from
// an approach side (a cubic Bézier "carrot" with a stiff spring following it, so a move that gets
// interrupted stays smooth). Glows are GL points (one vertex per drone: instanced quads are
// pathologically slow on software GL); hover, twinkle, trails and reflections run in the shaders, and
// once a formation has settled the CPU does no per-drone work. The camera flies to a pose per cue:
// each chapter's camera trucks along the skyline to that chapter's own weeks, angled and closer for
// small chapters; the skyline itself stays put in the world, so every move shows its depth.
import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, InstancedBufferGeometry,
  InstancedBufferAttribute, BufferAttribute, ShaderMaterial, Mesh, Points, AdditiveBlending,
  DoubleSide, Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const FOV = 45;
const D = 60;            // camera distance to the formation plane (z = 0) in the base pose
const CAM_Y = 0.25;      // eye height above the water (y = 0)
const DRONE = 0.18;      // drone mesh scale in world units
const PAD_STEP = 0.3;    // launch-grid spacing
const HOLD = 5.2;        // hero: seconds a formation holds before the swarm re-forms
const CAM0 = 0.3;        // intro: the camera starts to pull back from the launch pad
const INTRO = 2.75;      // intro: the camera reaches the show
const CAM_W = 2.0;       // camera spring (rad/s): a chapter-to-chapter flight takes about two seconds

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const fract = (x) => x - Math.floor(x);

const HOVER = /* glsl */`sin(uTime * 1.3 + seed * 6.2832) * 0.02`;

const DRONE_VS = /* glsl */`
attribute float part;
attribute vec3 iPos; attribute vec3 iVel; attribute vec3 iCol; attribute float iLum; attribute float seed;
uniform float uTime, uScale, uYaw;
varying vec3 vN, vC, vView; varying float vPart;
vec3 rot(vec3 p, vec3 ax, float a) { float c = cos(a), s = sin(a); return p * c + cross(ax, p) * s + ax * dot(ax, p) * (1.0 - c); }
void main() {
  vec3 p = position, n = normal;
  if (part > 0.5 && part < 1.5) {
    vec2 hub = vec2(sign(p.x), sign(p.z)) * 0.25;
    float a = uTime * 31.0 * sign(p.x * p.z) + iPos.x * 3.0;
    float c = cos(a), s = sin(a);
    vec2 d = p.xz - hub;
    p.xz = hub + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  }
  if (uYaw != 0.0) {
    float cy = cos(uYaw), sy = sin(uYaw);
    p.xz = vec2(cy * p.x - sy * p.z, sy * p.x + cy * p.z);
    n.xz = vec2(cy * n.x - sy * n.z, sy * n.x + cy * n.z);
  }
  vec3 v = vec3(iVel.x, 0.0, iVel.z);
  float sp = length(v);
  if (sp > 0.001) { vec3 ax = normalize(vec3(v.z, 0.0, -v.x)); float a = min(sp * 0.045, 0.42); p = rot(p, ax, a); n = rot(n, ax, a); }
  vec3 w = iPos + vec3(0.0, ${HOVER}, 0.0) + p * uScale;
  vec4 mv = modelViewMatrix * vec4(w, 1.0);
  vN = normalize(normalMatrix * n); vView = -mv.xyz; vC = iCol * (0.2 + 0.8 * min(iLum, 1.0)); vPart = part;
  gl_Position = projectionMatrix * mv;
}`;
const DRONE_FS = /* glsl */`
uniform vec3 uMoon, uDown;
varying vec3 vN, vC, vView; varying float vPart;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  if (vPart > 1.5) { gl_FragColor = vec4(vC * 1.5 + 0.12, 1.0); return; }
  vec3 base = vPart > 0.5 ? vec3(0.2, 0.22, 0.28) : vPart < -0.5 ? vec3(0.62, 0.64, 0.7) : vec3(0.1, 0.115, 0.16);
  float moon = max(dot(n, uMoon), 0.0);
  float under = max(dot(n, uDown), 0.0);
  float rim = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 3.0);
  float spec = pow(max(dot(reflect(-uMoon, n), normalize(vView)), 0.0), 24.0) * (vPart < -0.5 ? 0.9 : 0.35);
  vec3 c = base * (0.45 + 1.6 * moon * vec3(0.78, 0.84, 1.0)) + vC * under * 0.55 + rim * vec3(0.22, 0.27, 0.48) + spec * vec3(0.8, 0.86, 1.0);
  gl_FragColor = vec4(c, 1.0);
}`;
// glows: one point per drone; a moving drone draws a light streak behind it (long-exposure look).
// Reflections fade with depth below the horizon: on a phone the reflection of a formation high in the
// sky would otherwise land, upside down, near the bottom of the screen.
const GLOW_VS = /* glsl */`
attribute vec3 iCol; attribute float iLum; attribute vec3 iVel; attribute float seed;
uniform float uBase, uMinPx, uPxPerUnit, uMirror, uTime, uDpr, uMaxPt, uTrail, uTrailCap, uTrailFrac, uSweepT, uSweepW, uStretch, uHz;
uniform vec2 uView, uFade;
varying vec3 vC; varying float vA, vR, vS; varying vec2 vT;
void main() {
  vec3 p = position;
  p.y += ${HOVER} - 0.012;
  if (uMirror > 0.5) p.y = -p.y;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float depth = max(-mv.z, 0.05);
  float size = max(uBase * (0.6 + 0.4 * min(iLum, 1.6)), uMinPx * depth / uPxPerUnit);
  float px = size * uPxPerUnit / depth;
  vA = iLum; vC = iCol;
  // a formation locks in with a shimmer: a band of light sweeps across it once
  float sw = (uTime - uSweepT) / 1.1;
  if (sw > 0.0 && sw < 1.0 && iLum > 0.3) {
    float e = (position.x - mix(-uSweepW, uSweepW, sw)) / (uSweepW * 0.14);
    vA *= 1.0 + 0.9 * exp(-e * e);
  }
  vec2 T = vec2(0.0);
  float S = px;
  if (uMirror > 0.5) {
    vA *= smoothstep(0.15, 1.2, position.y);
    mv.x += sin(uTime * 1.6 + p.y * 1.7 + position.x * 0.6) * size * 0.35;
    S = px * uStretch;
  } else if (uTrail > 0.0 && fract(seed * 7.31) < uTrailFrac) {
    vec3 vv = mat3(viewMatrix) * iVel;
    vec2 sv = uPxPerUnit * (vv.xy * depth + mv.xy * vv.z) / (depth * depth);
    T = vec2(-sv.x, sv.y) * uTrail;
    float tl = length(T), cap = px * uTrailCap;
    if (tl > cap) T *= cap / tl;
    S = px + length(T);
  }
  float k = min(1.0, uMaxPt / max(S * uDpr, 1.0));
  vR = px * 0.5 * k; vT = T * k; vS = S * k;
  gl_Position = projectionMatrix * mv;
  if (uMirror > 0.5) vA *= 1.0 - smoothstep(uFade.x, uFade.y, (uHz - gl_Position.y / gl_Position.w) * 0.5);
  gl_Position.xy += vec2(vT.x / uView.x, -vT.y / uView.y) * gl_Position.w;
  gl_PointSize = vA < 0.004 ? 0.0 : vS * uDpr;
}`;
const GLOW_FS = /* glsl */`
uniform float uGain, uMirror, uStretch;
varying vec3 vC; varying float vA, vR, vS; varying vec2 vT;
void main() {
  vec2 q = (gl_PointCoord - 0.5) * vS;
  if (uMirror > 0.5) {
    vec2 uv = q / (vR * vec2(0.75, uStretch));
    float d2 = dot(uv, uv);
    if (d2 > 1.0) discard;
    float core = exp(-d2 * 16.0), halo = exp(-d2 * 4.0) * 0.28;
    gl_FragColor = vec4((vC * (core * 1.25 + halo) + vec3(core * 0.45 * vA)) * vA * uGain, 0.0);
    return;
  }
  vec2 h = q + vT * 0.5;
  float d2 = dot(h, h) / (vR * vR);
  float core = exp(-d2 * 16.0), halo = exp(-d2 * 4.0) * 0.28, streak = 0.0;
  float tt = dot(vT, vT);
  if (tt > 0.25) {
    float u = clamp(dot(h, vT) / tt, 0.0, 1.0);
    vec2 e = h - vT * u;
    streak = exp(-dot(e, e) / (vR * vR) * 9.0) * (1.0 - u) * 0.75;
  }
  if (core + halo + streak < 0.003) discard;
  vec3 c = vC * (core * 1.25 + halo + streak) + vec3((core * 0.45 + streak * 0.06) * vA);
  gl_FragColor = vec4(c * vA * uGain, 0.0);
}`;
const STAR_VS = /* glsl */`
attribute float seed;
uniform float uTime, uDpr;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vA = (0.35 + 0.65 * fract(seed * 7.13)) * (0.75 + 0.25 * sin(uTime * (0.6 + seed) + seed * 40.0));
  gl_PointSize = (1.0 + 1.4 * fract(seed * 3.7)) * uDpr;
  gl_Position = projectionMatrix * mv;
}`;
const STAR_FS = /* glsl */`
varying float vA;
void main() { vec2 d = gl_PointCoord - 0.5; gl_FragColor = vec4(vec3(0.8, 0.85, 1.0) * vA * smoothstep(0.5, 0.1, length(d)), 0.0); }`;

function toFloat(attr, itemSize) {
  const out = new Float32Array(attr.count * itemSize);
  for (let i = 0; i < attr.count; i++) {
    out[i * itemSize] = attr.getX(i);
    if (itemSize > 1) out[i * itemSize + 1] = attr.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attr.getZ(i);
  }
  return out;
}

async function loadDrone(glb, url) {
  const buf = await (glb || fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)));
  if (!buf) throw new Error('no drone model');
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(buf, '');
  gltf.scene.updateMatrixWorld(true);
  const parts = { drone_frame: 0, drone_rotor: 1, drone_led: 2, drone_trim: -1 };
  const pos = [], nor = [], prt = [], idx = [];
  let base = 0;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    let id = 0;
    for (let p = o; p; p = p.parent) if (p.name in parts) { id = parts[p.name]; break; }
    const g = o.geometry.clone();
    g.setAttribute('position', new BufferAttribute(toFloat(g.attributes.position, 3), 3));
    g.setAttribute('normal', new BufferAttribute(toFloat(g.attributes.normal, 3), 3));
    g.applyMatrix4(o.matrixWorld);
    const n = g.attributes.position.count;
    for (const v of g.attributes.position.array) pos.push(v);
    for (const v of g.attributes.normal.array) nor.push(v);
    for (let i = 0; i < n; i++) prt.push(id);
    const index = g.index ? g.index.array : Array.from({ length: n }, (_, i) => i);
    for (const i of index) idx.push(i + base);
    base += n;
  });
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geo.setAttribute('part', new BufferAttribute(new Float32Array(prt), 1));
  geo.setIndex(idx);
  return geo;
}

// boot work runs in short tasks (on the page's thread the page stays responsive while the show assembles)
const yieldTask = () => new Promise((r) => (self.scheduler?.yield ? self.scheduler.yield().then(r) : setTimeout(r, 0)));
// the show runs in a worker (OffscreenCanvas) where the browser allows it, else on the page's thread
const raf = typeof requestAnimationFrame === 'function' ? (f) => requestAnimationFrame(f) : (f) => setTimeout(() => f(performance.now()), 16);
const whenIdle = typeof requestIdleCallback === 'function' ? (f) => requestIdleCallback(f, { timeout: 1500 }) : (f) => setTimeout(f, 50);

/**
 * view: { w, h, dpr, coarse } of the page; the caller forwards input and size changes through the
 * returned pointer() and resize(). onSquads(list) reports where the fleet's squadrons are drawn.
 */
export async function start({ canvas, cues, fleet, layout, formation, chapterZoom, params, tier = 'gpu', gl: context = null, glb, glbUrl, view, onIntroEnd, onSquads, onFps }) {
  const soft = tier === 'soft' || params.has('soft');
  const lite = soft || view.coarse || Math.min(view.w, view.h) < 600;
  const renderer = new WebGLRenderer(context ? { canvas, context } : { canvas, antialias: !lite, alpha: true, powerPreference: 'high-performance' });
  renderer.debug.checkShaderErrors = !!params.has('debug');
  renderer.setClearColor(0x000000, 0);
  // software rasterisers pay per pixel: 1x (0.8x on wide screens) instead of the 1.5x cap
  let dpr = Math.min(view.dpr || 1, soft ? (view.w > 1000 ? 0.8 : 1) : 1.5);
  renderer.setPixelRatio(dpr);
  const gl = renderer.getContext();
  const maxPt = Math.max(16, (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) || [1, 64])[1]);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, view.w / view.h, 0.05, 900);
  const tanHalf = Math.tan((FOV / 2) * Math.PI / 180);

  const N = fleet.n;
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), tgt = new Float32Array(N * 3);
  const col = new Float32Array(N * 3), lum = new Float32Array(N), colT = new Float32Array(N * 3), lumT = new Float32Array(N);
  const omega = new Float32Array(N), launch = new Float32Array(N), seed = new Float32Array(N);
  const animated = new Uint8Array(N);
  // choreography: drone i follows the cubic Bézier P0 -> P0 + pa -> target + pb -> target,
  // starting at pt[i] and taking pd[i] seconds (pt = -inf: no path, it holds its slot)
  const p0 = new Float32Array(N * 3), pa = new Float32Array(N * 3), pb = new Float32Array(N * 3);
  const pt = new Float32Array(N).fill(-1e9), pd = new Float32Array(N).fill(1);
  let planEnd = 0, transit = false, lastKind = 'text';

  // launch grid on the water: oldest commits in the front row (nearest the opening close-up)
  const cols = Math.ceil(Math.sqrt(N));
  const rows = Math.ceil(N / cols);
  const padZ0 = 28;
  for (let i = 0; i < N; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    pos[i * 3] = (c - (cols - 1) / 2) * PAD_STEP; pos[i * 3 + 1] = 0.05; pos[i * 3 + 2] = padZ0 + ((rows - 1) / 2 - r) * PAD_STEP;
    launch[i] = 1e9;
    omega[i] = 7.5 + Math.random() * 2.5;
    seed[i] = Math.random();
    col[i * 3] = 1; col[i * 3 + 1] = 0.9; col[i * 3 + 2] = 0.75; lum[i] = 0.7;
  }
  const front = padZ0 + ((rows - 1) / 2) * PAD_STEP;
  // macro shot of the front-centre drone; a lens shift lifts it into the upper half (hero text sits below)
  const startPos = new Vector3(0.05, 0.2, front + 0.6), startLook = new Vector3(0, 0.05, front);

  // ---- glows (+ their reflections on the water): GL points sharing the drone state ----
  const dyn = (a) => { a.setUsage(35048); return a; }; // DYNAMIC_DRAW
  const gPos = dyn(new BufferAttribute(pos, 3)), gCol = dyn(new BufferAttribute(col, 3)), gLum = dyn(new BufferAttribute(lum, 1)), gVel = dyn(new BufferAttribute(vel, 3));
  const pts = new BufferGeometry();
  pts.setAttribute('position', gPos); pts.setAttribute('iCol', gCol); pts.setAttribute('iLum', gLum); pts.setAttribute('iVel', gVel);
  pts.setAttribute('seed', new BufferAttribute(seed, 1));
  const glowU = {
    uBase: { value: 0.1 }, uMinPx: { value: 2.6 }, uPxPerUnit: { value: 1 }, uTime: { value: 0 }, uDpr: { value: dpr },
    uMaxPt: { value: maxPt }, uTrail: { value: 0 }, uView: { value: [view.w, view.h] },
    uSweepT: { value: -100 }, uSweepW: { value: 40 }, uStretch: { value: soft ? 1.7 : 2.2 }, uTrailCap: { value: soft ? 3 : 6 },
    uHz: { value: -0.2 }, uFade: { value: [0.08, 0.22] },
    uTrailFrac: { value: 1 }, // share of drones that draw a streak
  };
  const mkGlow = (mirror, gain) => new Points(pts, new ShaderMaterial({
    vertexShader: GLOW_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, premultipliedAlpha: true,
    uniforms: { ...glowU, uMirror: { value: mirror }, uGain: { value: gain } },
  }));
  const glow = mkGlow(0, 1), mirror = mkGlow(1, 0.3);
  for (const m of [glow, mirror]) m.frustumCulled = false;
  glow.renderOrder = 3; mirror.renderOrder = 2;
  scene.add(mirror, glow);

  // stars
  let stars = null;
  {
    const n = lite ? 320 : 600, p = new Float32Array(n * 3), s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (Math.random() - 0.5) * 2.2, e = Math.pow(Math.random(), 0.8) * 0.75 + 0.02;
      p[i * 3] = Math.sin(a) * 500; p[i * 3 + 1] = Math.tan(e) * 500 * 0.9 + 4; p[i * 3 + 2] = -Math.cos(a) * 500 + D;
      s[i] = Math.random();
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(p, 3));
    g.setAttribute('seed', new BufferAttribute(s, 1));
    const m = new ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false, blending: AdditiveBlending, premultipliedAlpha: true, uniforms: { uTime: glowU.uTime, uDpr: glowU.uDpr } });
    stars = new Points(g, m);
    stars.frustumCulled = false;
    scene.add(stars);
  }

  await yieldTask();
  // drone meshes (instanced; the show starts on glows if the glTF is late). They only matter in the
  // opening close-up, so only a window of the launch pad nearest the camera is drawn as models
  // (everyone is always drawn as a light): a few hundred instances on a desktop, about a hundred on
  // a phone, three dozen on software GL. The window is copied into small buffers each frame.
  let drones = null;
  const meshRows = params.has('rows') ? +params.get('rows') : soft ? 3 : lite ? 6 : 10;
  const half = soft ? 5 : lite ? 8 : 14;
  const meshIdx = (() => {
    const mid = (cols - 1) / 2, list = [];
    for (let r = 0; r < meshRows; r++) for (let c = Math.max(0, Math.ceil(mid - half)); c <= Math.min(cols - 1, Math.floor(mid + half)); c++) if (r * cols + c < N) list.push(r * cols + c);
    return Int32Array.from(list);
  })();
  const meshCap = meshIdx.length;
  const iPos = dyn(new InstancedBufferAttribute(new Float32Array(meshCap * 3), 3)), iVel = dyn(new InstancedBufferAttribute(new Float32Array(meshCap * 3), 3));
  const iCol = dyn(new InstancedBufferAttribute(new Float32Array(meshCap * 3), 3)), iLum = dyn(new InstancedBufferAttribute(new Float32Array(meshCap), 1));
  const iSeed = new InstancedBufferAttribute(Float32Array.from(meshIdx, (i) => seed[i]), 1);
  function copyMesh() {
    const P = iPos.array, V = iVel.array, C = iCol.array, U = iLum.array;
    for (let k = 0; k < meshCap; k++) {
      const i = meshIdx[k];
      for (let c = 0; c < 3; c++) { P[k * 3 + c] = pos[i * 3 + c]; V[k * 3 + c] = vel[i * 3 + c]; C[k * 3 + c] = col[i * 3 + c]; }
      U[k] = lum[i];
    }
  }
  const droneU = { uTime: glowU.uTime, uScale: { value: DRONE }, uYaw: { value: 0 }, uMoon: { value: new Vector3() }, uDown: { value: new Vector3() } };
  // close-up: at the closing cue one drone from the record's newest day flies to the camera and shows
  // the model (still the same drone, so the sky keeps exactly one per commit)
  const H = N - 1;
  let near = null, nearGlow = null, closing = false;
  const nPos = dyn(new InstancedBufferAttribute(new Float32Array(3), 3)), nVel = dyn(new InstancedBufferAttribute(new Float32Array(3), 3));
  const nCol = dyn(new InstancedBufferAttribute(new Float32Array(3), 3)), nLum = new InstancedBufferAttribute(new Float32Array([1]), 1);
  const nSeed = new InstancedBufferAttribute(new Float32Array([seed[H]]), 1);
  const nearU = { ...droneU, uYaw: { value: 0 }, uScale: { value: DRONE * 1.25 } };
  {
    const g = new BufferGeometry();
    g.setAttribute('position', dyn(new BufferAttribute(nPos.array, 3)));
    g.setAttribute('iCol', dyn(new BufferAttribute(nCol.array, 3)));
    g.setAttribute('iLum', new BufferAttribute(new Float32Array([0.9]), 1));
    g.setAttribute('iVel', new BufferAttribute(new Float32Array(3), 3));
    g.setAttribute('seed', new BufferAttribute(nSeed.array, 1));
    nearGlow = new Points(g, new ShaderMaterial({
      vertexShader: GLOW_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, premultipliedAlpha: true,
      uniforms: { ...glowU, uBase: { value: 0.024 }, uMinPx: { value: 0 }, uTrail: { value: 0 }, uMirror: { value: 0 }, uGain: { value: 1 } },
    }));
    nearGlow.frustumCulled = false; nearGlow.visible = false; nearGlow.renderOrder = 5;
    scene.add(nearGlow);
  }
  const loaded = loadDrone(glb, glbUrl).then((geo) => {
    geo.setAttribute('iPos', iPos); geo.setAttribute('iVel', iVel); geo.setAttribute('iCol', iCol); geo.setAttribute('iLum', iLum);
    geo.setAttribute('seed', iSeed);
    geo.instanceCount = meshCap;
    drones = new Mesh(geo, new ShaderMaterial({ vertexShader: DRONE_VS, fragmentShader: DRONE_FS, side: DoubleSide, uniforms: droneU }));
    drones.frustumCulled = false;
    drones.renderOrder = 1;
    scene.add(drones);
    const g2 = new InstancedBufferGeometry();
    for (const a of ['position', 'normal', 'part']) g2.setAttribute(a, geo.getAttribute(a));
    g2.setIndex(geo.getIndex());
    g2.setAttribute('iPos', nPos); g2.setAttribute('iVel', nVel); g2.setAttribute('iCol', nCol); g2.setAttribute('iLum', nLum); g2.setAttribute('seed', nSeed);
    g2.instanceCount = 1;
    // drawn after the glows (transparent queue) so its body hides the formation behind it
    near = new Mesh(g2, new ShaderMaterial({ vertexShader: DRONE_VS, fragmentShader: DRONE_FS, side: DoubleSide, transparent: true, uniforms: nearU }));
    near.frustumCulled = false; near.visible = false; near.renderOrder = 4;
    scene.add(near);
  }).catch(() => {});

  // ---- camera poses and formations ----
  // A pose is a camera position + yaw; pitch and field of view never change, so the horizon stays on
  // the page's painted horizon. A formation is laid out in screen space for its cue's pose and
  // projected onto a vertical plane `dist` ahead of that camera.
  let L = null, cueI = 0, alt = false, formedAt = Infinity, highlight = null, unitsPerPx = 0.06, pitch = 0;
  let anim = null, animF = null, idle = false, trail = 0.06, glowK = 1, Hw = 50;
  const cache = new Map(), poses = new Map();
  const tmp = new Vector3();
  const basePose = { x: 0, y: CAM_Y, z: D, yaw: 0, dist: D };
  let baseBasis = null, chapX = [], backHalf = 20;
  function basisOf(p) {
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), a = L.w / L.h;
    const F = [-sy * cp, sp, -cy * cp], R = [cy, 0, -sy];
    const U = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
    return { x: p.x, y: p.y, z: p.z, F, R: R.map((v) => v * tanHalf * a), U: U.map((v) => v * tanHalf), hx: -sy, hz: -cy, dist: p.dist };
  }
  // screen (CSS px) -> point on the pose's formation plane; zo = depth offset toward the camera
  function toWorld(sx, sy, out, o, B, zo) {
    const nx = (sx / L.w) * 2 - 1, ny = 1 - (sy / L.h) * 2;
    const dx = B.F[0] + nx * B.R[0] + ny * B.U[0], dy = B.F[1] + nx * B.R[1] + ny * B.U[1], dz = B.F[2] + nx * B.R[2] + ny * B.U[2];
    const t = B.dist / (dx * B.hx + dz * B.hz);
    out[o] = B.x + dx * t - B.hx * zo;
    out[o + 1] = Math.max(0.15, B.y + dy * t);
    out[o + 2] = B.z + dz * t - B.hz * zo;
  }
  const chapterSize = (ch) => fleet.squads.reduce((s, q) => s + (q.chap === ch ? q.count : 0), 0);
  function poseFor(ci) {
    let p = poses.get(ci);
    if (p) return p;
    const c = cues[ci];
    p = basePose;
    if (c.kind === 'skyline') p = { ...basePose, z: D * 1.06, dist: D * 1.06 }; // a step back for the whole record
    else if (c.kind === 'chapter') {
      // fly to the chapter's own weeks on the skyline: closer for small chapters, angled
      // alternately left and right; on wide screens its weeks sit under the emblem (right of centre)
      const dist = D / chapterZoom(chapterSize(c.chapter));
      const side = c.chapter % 2 ? 1 : -1;
      const yaw = side * (L.mobile ? 0.05 : 0.1);
      const hx = -Math.sin(yaw), hz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const view = tanHalf * (L.w / L.h) * dist, lat = (L.mobile ? 0 : 0.4) * view;
      const room = Math.max(0, backHalf - view * 0.92);
      const qx = Math.max(-room + lat, Math.min(room + lat, chapX[c.chapter] || 0));
      p = { x: qx - dist * hx - lat * rx, y: CAM_Y + (side > 0 ? 0.6 : 0), z: -dist * hz - lat * rz, yaw, dist };
    }
    poses.set(ci, p);
    return p;
  }
  function getFormation(ci, a) {
    const key = ci * 2 + (a ? 1 : 0);
    let f = cache.get(key);
    if (!f) {
      const s = formation(cues[ci], fleet, L, a);
      const B = basisOf(poseFor(ci));
      if (cues[ci].kind === 'fleet') onSquads?.(fleet.squads.map((q) => [q.cx, q.cy, q.r]));
      const t = new Float32Array(N * 3), k = new Float32Array(N);
      let x0 = Infinity, x1 = -Infinity;
      for (let i = 0; i < N; i++) { const x = s.pos[i * 3]; if (x < x0) x0 = x; if (x > x1) x1 = x; }
      for (let i = 0; i < N; i++) {
        toWorld(s.pos[i * 3], s.pos[i * 3 + 1], t, i * 3, s.back && s.back[i] ? baseBasis : B, s.pos[i * 3 + 2]);
        k[i] = (s.pos[i * 3] - x0) / Math.max(1, x1 - x0);
      }
      f = { tgt: t, col: s.col, lum: s.lum, anim: s.anim || null, basis: B, key: k };
      cache.set(key, f);
    }
    return f;
  }
  const hl = (i, l) => (highlight == null ? l : fleet.repo[i] === highlight ? Math.min(1.2, l * 2.4) : l * 0.3);
  function applyAnim(now) {
    if (!anim) return;
    anim.update(now);
    const { ids, xyz } = anim, B = animF.basis;
    for (let k = 0; k < ids.length; k++) {
      const i = ids[k];
      toWorld(xyz[k * 3], xyz[k * 3 + 1], tgt, i * 3, B, xyz[k * 3 + 2]);
      lumT[i] = hl(i, anim.lum[k]);
    }
  }

  // per-drone curve for a cue change: when each drone sets off (a wave in a meaningful order), how
  // long it flies, how it lifts out and from which side it comes in. Lengths are in units of the
  // view's height at the formation plane, so phones and desktops get the same choreography.
  function plan(now, f) {
    const c = cues[cueI], kind = c.kind;
    transit = kind === 'text' && c.tone !== 'chrono' && lastKind !== 'text';
    lastKind = kind;
    let c0 = 0, c1 = 1;
    if (kind === 'chapter') {
      c0 = Infinity; c1 = -Infinity;
      for (let i = 0; i < N; i++) if (fleet.chap[i] === c.chapter) { c0 = Math.min(c0, fleet.day[i]); c1 = Math.max(c1, fleet.day[i]); }
    }
    const nSq = Math.max(1, fleet.squads.length);
    planEnd = now;
    for (let i = 0; i < N; i++) {
      const i3 = i * 3, r = seed[i], r2 = fract(r * 13.37);
      const dx = tgt[i3] - pos[i3], dy = tgt[i3 + 1] - pos[i3 + 1], dz = tgt[i3 + 2] - pos[i3 + 2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 0.04 || launch[i] > now + 1e3) { pt[i] = -1e9; continue; }
      const s = Math.min(1, dist / (0.3 * Hw));
      let key = 0, d0 = 0, spread = 0.5, dur = 1.15, lx = 0, ly = 0.08, lz = 0, bx = 0, by = 0.08, bz = 0;
      if (kind === 'text') { key = f.key[i]; spread = 0.55; dur = 1.2; ly = 0.11 + 0.05 * r; lz = (r2 - 0.5) * 0.1; by = 0.08; }
      else if (kind === 'skyline') { key = fleet.day[i] / fleet.span; spread = 1.0; dur = 1.05; ly = 0.03; by = 0.13; }
      else if (kind === 'chapter') {
        if (fleet.chap[i] === c.chapter) { key = (fleet.day[i] - c0) / Math.max(1, c1 - c0); d0 = 0.1; spread = 0.75; dur = 1.3; ly = 0.13; by = -0.09; lz = (r2 - 0.5) * 0.08; }
        else { key = fleet.day[i] / fleet.span; spread = 0.45; dur = 1.0; ly = 0.02; by = 0.1; }
      } else if (kind === 'fleet') {
        key = (fleet.sIdx.get(fleet.repo[i]) || 0) / nSq; spread = 0.6; dur = 1.3; ly = 0.08;
        // swirl in: approach from the side, all turning the same way
        bx = -dy / Math.max(1e-3, dist) * 0.07; by = dx / Math.max(1e-3, dist) * 0.07;
      }
      pt[i] = now + d0 + key * spread + r * 0.08;
      pd[i] = dur * (0.9 + 0.2 * r2);
      if (launch[i] > pt[i]) launch[i] = pt[i]; // still on the pad (an early scroll): it lifts off into this move
      p0[i3] = pos[i3] + vel[i3] * 0.1; p0[i3 + 1] = pos[i3 + 1] + vel[i3 + 1] * 0.1; p0[i3 + 2] = pos[i3 + 2] + vel[i3 + 2] * 0.1;
      const hs = Hw * s;
      pa[i3] = vel[i3] * 0.2 + lx * hs; pa[i3 + 1] = vel[i3 + 1] * 0.2 + ly * hs; pa[i3 + 2] = vel[i3 + 2] * 0.2 + lz * hs;
      pb[i3] = bx * hs; pb[i3 + 1] = by * hs; pb[i3 + 2] = bz * hs;
      planEnd = Math.max(planEnd, pt[i] + pd[i]);
    }
  }
  // take-off: launches roll left to right across the name, so it writes itself; every drone lifts
  // straight up off the pad, turns in its chapter's colour and comes in from that chapter's side:
  // seven coloured streams that resolve into the warm-white name.
  function planIntro(f) {
    const K = fleet.colors.length, Ww = Hw * L.w / L.h;
    transit = true; lastKind = 'text';
    planEnd = 0;
    for (let i = 0; i < N; i++) {
      const i3 = i * 3, r = seed[i], r2 = fract(r * 13.37), k = fleet.chap[i];
      const ph = Math.PI * (0.93 - 0.86 * k / Math.max(1, K - 1));
      launch[i] = 0.12 + f.key[i] * 0.85 + r * 0.12;
      pt[i] = launch[i]; pd[i] = 1.3 + 0.28 * r2;
      p0[i3] = pos[i3]; p0[i3 + 1] = pos[i3 + 1]; p0[i3 + 2] = pos[i3 + 2];
      pa[i3] = 0; pa[i3 + 1] = Hw * (0.2 + 0.08 * r2); pa[i3 + 2] = -Hw * 0.04;
      pb[i3] = Math.cos(ph) * Ww * 0.2; pb[i3 + 1] = -Hw * (0.08 + 0.12 * Math.sin(ph)); pb[i3 + 2] = ((k % 3) - 1) * Hw * 0.14;
      planEnd = Math.max(planEnd, pt[i] + pd[i]);
    }
  }
  function retarget(flock) {
    const f = getFormation(cueI, alt);
    tgt.set(f.tgt); colT.set(f.col);
    for (let i = 0; i < N; i++) lumT[i] = hl(i, f.lum[i]);
    anim = f.anim; animF = f;
    animated.fill(0);
    if (anim) for (const i of anim.ids) animated[i] = 1;
    const now = clock();
    if (flock) { applyAnim(now); plan(now, f); }
    formedAt = flock ? planEnd + 0.3 : now;
    glowU.uSweepT.value = flock ? formedAt - 0.25 : -100;
    trail = cues[cueI].finale ? 0.32 : cues[cueI].kind === 'fleet' ? 0.16 : 0.07;
    const k = cues[cueI].kind;
    // small chapters (framed close) also get bigger lights, so a few dozen drones still read as a shape
    glowK = k === 'skyline' ? (L.mobile ? 1 : 0.85) : k === 'chapter' ? 1 + 0.5 * clamp01(1 - chapterSize(cues[cueI].chapter) / 650) : 1;
    idle = false;
  }
  function resize() {
    const w = view.w, h = view.h;
    L = layout(w, h);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const tanTilt = (L.hz - 0.5) * 2 * tanHalf;
    pitch = Math.atan(tanTilt);
    unitsPerPx = (2 * Math.hypot(D, D * tanTilt) * tanHalf) / L.h;
    L.upp = unitsPerPx;
    Hw = 2 * D * tanHalf;
    poses.clear();
    baseBasis = basisOf(basePose);
    // where each chapter's weeks stand on the backdrop skyline (world x), for its camera
    const weeks = Math.ceil((fleet.span + 1) / 7), colW = L.sky.w / weeks, sx = new Float64Array(fleet.colors.length), sn = new Float64Array(fleet.colors.length);
    for (let i = 0; i < N; i++) { const c = fleet.chap[i]; sx[c] += L.sky.x + (Math.floor(fleet.day[i] / 7) + 0.5) * colW; sn[c]++; }
    const o = new Float32Array(3);
    chapX = Array.from(sx, (v, c) => { toWorld(sn[c] ? v / sn[c] : L.w / 2, L.sky.y, o, 0, baseBasis, 0); return o[0]; });
    toWorld(L.sky.x + L.sky.w, L.sky.y, o, 0, baseBasis, 0);
    backHalf = o[0];
    glowU.uPxPerUnit.value = h / (2 * tanHalf);
    glowU.uView.value = [w, h];
    glowU.uSweepW.value = (w * unitsPerPx) / 2;
    glowU.uHz.value = 1 - 2 * L.hz;
    glowU.uFade.value = L.mobile ? [0.07, 0.2] : [0.1, 0.26];
    cache.clear();
    retarget(false);
  }

  // ---- input (forwarded by the page) ----
  const pointer = { x: 0, y: 0, t: -1e9, nx: 0, ny: 0 };
  const P = new Vector3();
  const onPoint = (x, y) => { pointer.x = x; pointer.y = y; pointer.t = clock(); pointer.nx = x / view.w - 0.5; pointer.ny = y / view.h - 0.5; idle = false; };

  // the intro starts once the drone model is in (or after 1.5 s without it)
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 1500))]);
  let t0 = performance.now();
  const clock = () => (performance.now() - t0) / 1000;
  let opening = params.has('still') ? 0 : 1; // 1 while the camera is still flying the intro
  let introEnd = params.has('still') ? 0 : INTRO;
  let introDone = false;
  const macro = params.has('macro'); // ?macro holds the opening close-up (for inspecting the model)
  let last = 0, lastDraw = -1;
  let slow = 0, frames = 0, drawn = 0, fpsN = 0, fpsT = 0;
  // the camera rides a critically damped spring toward its cue's pose
  const cam = { x: 0, y: CAM_Y, z: D, yaw: 0, vx: 0, vy: 0, vz: 0, vyaw: 0 };
  let camMoving = false;
  const camPos = new Vector3(), camLook = new Vector3();

  function step(dt, now) {
    // the pointer scatters the swarm, except on the fleet where it inspects squadrons
    const ptrOn = now - pointer.t < 1.4 && now > introEnd && cues[cueI].kind !== 'fleet';
    if (ptrOn) {
      tmp.set((pointer.x / view.w) * 2 - 1, -(pointer.y / view.h) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
      // where the pointer's ray meets the current formation's plane
      const B = animF?.basis || baseBasis, C = camera.position;
      const t = (B.dist - ((C.x - B.x) * B.hx + (C.z - B.z) * B.hz)) / (tmp.x * B.hx + tmp.z * B.hz);
      P.copy(C).addScaledVector(tmp, Math.max(0, t));
    }
    const pr = L.mobile ? 2.6 : 3.4;
    const colK = Math.min(1, dt * 2.5);
    // drones at rest are skipped unless something global moves everyone (an animated formation
    // only keeps its own drones busy)
    let busy = ptrOn || opening || closing || !!anim || now < planEnd + 0.25;
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      if (now < launch[i]) { lum[i] += (0.45 - lum[i]) * colK; continue; } // parked on the pad, rotors spinning
      let px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
      let vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2];
      // the carrot: where the choreography wants this drone right now
      let cx = tgt[i3], cy = tgt[i3 + 1], cz = tgt[i3 + 2];
      const u = (now - pt[i]) / pd[i];
      const fast = closing && i === H;
      // stiff while it follows a curve (and for half a second after), soft at rest so the pointer can push it
      const follow = fast ? 1 : u < 1 ? 1 : clamp01(1.5 - (u - 1) * pd[i] * 2.5);
      if (u < 1) {
        const e = u <= 0 ? 0 : u * u * (3 - 2 * u);
        const a = 1 - e, b01 = a * a * (a + 3 * e), b1 = 3 * a * a * e, b2 = 3 * a * e * e, b23 = e * e * (3 * a + e);
        cx = b01 * p0[i3] + b1 * pa[i3] + b23 * cx + b2 * pb[i3];
        cy = b01 * p0[i3 + 1] + b1 * pa[i3 + 1] + b23 * cy + b2 * pb[i3 + 1];
        cz = b01 * p0[i3 + 2] + b1 * pa[i3 + 2] + b23 * cz + b2 * pb[i3 + 2];
      } else if (!follow && !ptrOn && !animated[i] && !fast) {
        // in formation and nothing is pulling: snap the last fraction of a pixel and rest
        const ex = cx - px, ey = cy - py, ez = cz - pz;
        if (ex * ex + ey * ey + ez * ez < 4e-4 && vx * vx + vy * vy + vz * vz < 4e-3) {
          pos[i3] = cx; pos[i3 + 1] = cy; pos[i3 + 2] = cz;
          vel[i3] = 0; vel[i3 + 1] = 0; vel[i3 + 2] = 0;
          const dc = Math.abs(colT[i3] - col[i3]) + Math.abs(colT[i3 + 1] - col[i3 + 1]) + Math.abs(colT[i3 + 2] - col[i3 + 2]) + Math.abs(lumT[i] - lum[i]);
          if (dc < 0.01) { col[i3] = colT[i3]; col[i3 + 1] = colT[i3 + 1]; col[i3 + 2] = colT[i3 + 2]; lum[i] = lumT[i]; continue; }
        }
      }
      busy = true;
      const om = omega[i] * (0.4 + 0.6 * follow) * (fast ? 0.5 : 1), k = om * om, c = 2 * om;
      let ax = (cx - px) * k - vx * c, ay = (cy - py) * k - vy * c, az = (cz - pz) * k - vz * c;
      if (ptrOn) {
        const dx = px - P.x, dy = py - P.y, d = Math.hypot(dx, dy) + 1e-4;
        if (d < pr) { const s = (1 - d / pr); const kk = s * s * 160 / d; ax += dx * kk; ay += dy * kk; az -= s * 20; }
      }
      // clamp acceleration and speed, integrate (generous while following a curve)
      const am = Math.hypot(ax, ay, az), AM = follow > 0 ? 420 : 90;
      if (am > AM) { ax *= AM / am; ay *= AM / am; az *= AM / am; }
      vx += ax * dt; vy += ay * dt; vz += az * dt;
      const sp = Math.hypot(vx, vy, vz), VM = fast ? 75 : follow > 0 ? 90 : 34;
      if (sp > VM) { vx *= VM / sp; vy *= VM / sp; vz *= VM / sp; }
      pos[i3] = px + vx * dt; pos[i3 + 1] = Math.max(0.05, py + vy * dt); pos[i3 + 2] = pz + vz * dt;
      vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
      // in flight a drone shows its chapter's colour, and takes the formation's colour as it lands
      if (transit && u < 0.88) {
        // (not brighter than its slot: where thousands of streaks cross, saturated colours would clip to white)
        const rgb = fleet.colors[fleet.chap[i]];
        col[i3] += (rgb[0] - col[i3]) * colK; col[i3 + 1] += (rgb[1] - col[i3 + 1]) * colK; col[i3 + 2] += (rgb[2] - col[i3 + 2]) * colK;
        lum[i] += (0.85 - lum[i]) * colK;
      } else {
        if (animated[i] && u >= 1) lum[i] = lumT[i]; else lum[i] += (lumT[i] - lum[i]) * colK;
        col[i3] += (colT[i3] - col[i3]) * colK; col[i3 + 1] += (colT[i3 + 1] - col[i3 + 1]) * colK; col[i3 + 2] += (colT[i3 + 2] - col[i3 + 2]) * colK;
      }
    }
    return busy;
  }

  function frame() {
    raf(frame);
    const now = clock();
    // hero alternates name and hook
    if (cues[cueI].alt && now > formedAt + (alt ? HOLD : HOLD + 1.8) && now > introEnd) { alt = !alt; retarget(true); }
    // frame budget: software GL and settled formations run at 30 fps; on software GL a settled
    // formation under a still camera is not redrawn at all (the drift pauses) so the page goes quiet
    if (soft && idle && !camMoving && lastDraw > 0 && now - pointer.t > 1.4) return;
    const cap = soft || idle ? 1 / 30 : 0;
    if (cap && now - lastDraw < cap - 0.004) return;
    lastDraw = now;
    const dt = Math.min(0.1, Math.max(1 / 240, now - last));
    last = now;
    glowU.uTime.value = now;

    closing = cues[cueI].id === 'cta' && !opening;
    if (closing) { closeUp(now); idle = false; }
    if (!idle) {
      applyAnim(now);
      // at most two sub-steps: a slow frame plays in slow motion instead of snowballing
      const sub = dt > 1 / 20 ? 2 : 1;
      let busy = false;
      for (let s = 0; s < sub; s++) busy = step(dt / sub, now) || busy;
      if (!busy) idle = true;
      gPos.needsUpdate = true; gCol.needsUpdate = true; gLum.needsUpdate = true; gVel.needsUpdate = true;
    }

    // camera: the intro flight from the launch pad, then a spring toward the cue's pose
    const k = macro ? 0 : opening ? easeInOut(clamp01((now - CAM0) / (introEnd - CAM0 - 0.1))) : 1;
    if (opening && k >= 1) opening = 0;
    if (!introDone && !opening && now >= introEnd) { introDone = true; onIntroEnd?.(); warm(); }
    const tp = poseFor(cueI);
    if (opening) { cam.x = tp.x; cam.y = tp.y; cam.z = tp.z; cam.yaw = tp.yaw; cam.vx = cam.vy = cam.vz = cam.vyaw = 0; camMoving = false; } else {
      const w2 = CAM_W * CAM_W, c2 = 2 * CAM_W;
      cam.vx += ((tp.x - cam.x) * w2 - cam.vx * c2) * dt; cam.x += cam.vx * dt;
      cam.vy += ((tp.y - cam.y) * w2 - cam.vy * c2) * dt; cam.y += cam.vy * dt;
      cam.vz += ((tp.z - cam.z) * w2 - cam.vz * c2) * dt; cam.z += cam.vz * dt;
      cam.vyaw += ((tp.yaw - cam.yaw) * w2 - cam.vyaw * c2) * dt; cam.yaw += cam.vyaw * dt;
      camMoving = Math.abs(tp.x - cam.x) + Math.abs(tp.y - cam.y) + Math.abs(tp.z - cam.z) > 0.02 || Math.abs(cam.vx) + Math.abs(cam.vy) + Math.abs(cam.vz) > 0.02 || Math.abs(tp.yaw - cam.yaw) > 1e-4;
    }
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cpz = Math.cos(pitch), spz = Math.sin(pitch);
    // a slow drift (and the pointer) sways the camera sideways, which shows the depth
    const drift = (Math.sin(now * 0.11) * 0.9 + pointer.nx * 1.4) * k;
    const bob = (Math.sin(now * 0.07) * 0.25 - pointer.ny * 0.6) * k;
    camPos.set(cam.x + drift * cy, cam.y + bob, cam.z - drift * sy);
    camLook.set(camPos.x - sy * cpz * D, camPos.y + spz * D, camPos.z - cy * cpz * D);
    const lift = (1 - k) * (L.mobile ? 0.22 : 0.1) * L.h;
    if (lift > 0.5) camera.setViewOffset(L.w, L.h, 0, lift, L.w, L.h); else if (camera.view && camera.view.enabled) camera.clearViewOffset();
    camera.position.lerpVectors(startPos, camPos, k);
    tmp.lerpVectors(startLook, camLook, k);
    camera.lookAt(tmp);
    camera.updateMatrixWorld();
    glowU.uTrail.value = opening ? trail * (0.35 + 0.65 * k) : trail;
    const show = unitsPerPx * L.spacing * (L.mobile ? 2.35 : 2.7);
    const gk = opening ? 1 : glowK;
    glowU.uBase.value += ((0.045 + (show * gk - 0.045) * k) - glowU.uBase.value) * (opening ? 1 : Math.min(1, dt * 3));
    if (drones) {
      drones.visible = k < (soft ? 0.45 : 0.6);
      if (drones.visible) {
        droneU.uMoon.value.set(-0.45, 0.8, 0.4).normalize().transformDirection(camera.matrixWorldInverse);
        droneU.uDown.value.set(0, -1, 0).transformDirection(camera.matrixWorldInverse);
        droneU.uScale.value = DRONE * (1 + k * 0.4);
        copyMesh();
        iPos.needsUpdate = true; iVel.needsUpdate = true; iCol.needsUpdate = true; iLum.needsUpdate = true;
      }
    }
    if (near) {
      const h3 = H * 3;
      const dist = Math.hypot(pos[h3] - camera.position.x, pos[h3 + 1] - camera.position.y, pos[h3 + 2] - camera.position.z);
      near.visible = nearGlow.visible = dist < 10;
      if (near.visible) {
        nPos.array.set(pos.subarray(h3, h3 + 3)); nCol.array.set(col.subarray(h3, h3 + 3));
        nVel.array[0] = Math.sin(now * 0.7) * 3 + vel[h3]; nVel.array[1] = 0; nVel.array[2] = Math.cos(now * 0.5) * 2 + vel[h3 + 2];
        nearU.uYaw.value = now * 0.35;
        nPos.needsUpdate = nVel.needsUpdate = nCol.needsUpdate = true;
        nearGlow.geometry.attributes.position.needsUpdate = nearGlow.geometry.attributes.iCol.needsUpdate = true;
        if (!drones.visible) {
          droneU.uMoon.value.set(-0.45, 0.8, 0.4).normalize().transformDirection(camera.matrixWorldInverse);
          droneU.uDown.value.set(0, -1, 0).transformDirection(camera.matrixWorldInverse);
        }
      }
    }
    // the first frames bring in one kind of object at a time: a software rasteriser compiles each
    // pipeline on its first draw, and spread over frames that never adds up to one long stall
    if (drawn < 6) { drawn++; stars.visible = drawn > 2; if (drones && drawn < 5) drones.visible = false; }
    renderer.render(scene, camera);
    if (onFps) { fpsN++; if (now - fpsT > 2) { onFps(+(fpsN / (now - fpsT)).toFixed(1)); fpsN = 0; fpsT = now; } }

    // adapt: drop to 1x pixels if a phone struggles after the intro
    if (!opening && !idle && dpr > 1 && frames < 240) {
      frames++;
      if (dt > 1 / 40) slow++;
      if (frames === 240 && slow > 120) { dpr = 1; renderer.setPixelRatio(1); glowU.uDpr.value = 1; resize(); }
    }
  }

  // the close-up spot rides with the camera (it drifts): on wide screens right of the closing words,
  // on phones between the words and the reading panel, clear of both
  const ce = camera.matrixWorld.elements;
  function closeUp(now) {
    const d = L.mobile ? 1.45 : 0.8, ax = L.mobile ? 0.02 : 0.58, ay = L.mobile ? 0.31 : -0.38;
    const th = tanHalf, asp = camera.aspect;
    const bob = Math.sin(now * 1.1) * 0.012, sway = Math.sin(now * 0.6) * 0.02;
    const h3 = H * 3;
    for (let c = 0; c < 3; c++) tgt[h3 + c] = camera.position.getComponent(c) + d * (-ce[8 + c] + ax * th * asp * ce[c] + ay * th * ce[4 + c]) + (c === 0 ? sway : c === 1 ? bob : 0);
    const dist = Math.hypot(pos[h3] - camera.position.x, pos[h3 + 1] - camera.position.y, pos[h3 + 2] - camera.position.z);
    lumT[H] = Math.min(1, Math.max(0, (dist - 3) / 8));
    animated[H] = 1;
    pt[H] = -1e9; // no curve: it heads straight for the camera
  }

  // precompute every formation in idle time, nearest cues first, so a cue change is a copy
  let warming = false;
  function warm() {
    if (warming) return;
    warming = true;
    const ric = whenIdle;
    const tick = () => {
      const todo = [];
      cues.forEach((c, ci) => { for (const a of c.alt ? [false, true] : [false]) if (!cache.has(ci * 2 + (a ? 1 : 0))) todo.push([ci, a]); });
      if (!todo.length) { warming = false; return; }
      todo.sort((p, q) => Math.abs(p[0] - cueI - 0.4) - Math.abs(q[0] - cueI - 0.4));
      getFormation(todo[0][0], todo[0][1]);
      ric(tick);
    };
    ric(tick);
  }

  await yieldTask();
  resize();
  await yieldTask();
  planIntro(getFormation(0, false));
  await yieldTask();
  // shaders compile in parallel where the driver allows it, so the first frame draws without a stall
  if (renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(scene, camera).catch(() => {});
  else renderer.compile(scene, camera);
  await yieldTask();
  t0 = performance.now();
  last = 0;
  formedAt = planEnd + 0.3;
  if (macro) launch.fill(1e9);
  if (params.has('still')) {
    for (let i = 0; i < N; i++) { launch[i] = -10; pt[i] = -1e9; pos.set([tgt[i * 3], tgt[i * 3 + 1], tgt[i * 3 + 2]], i * 3); col.set(colT.subarray(i * 3, i * 3 + 3), i * 3); lum[i] = lumT[i]; }
    transit = false; planEnd = 0; formedAt = 0;
  }
  glowU.uSweepT.value = params.has('still') ? -100 : formedAt - 0.25;
  raf(frame);

  if (params.has('debug')) self.__swarm = { pos, tgt, vel, camera, H, L: () => L, cam, poseFor, cue: () => cueI };
  return {
    pointer(x, y) { onPoint(x, y); },
    resize(w, h, d) {
      view.w = w; view.h = h;
      // a lower pixel cap applies at once (a higher one would undo the adaptive drop)
      const nd = d ? Math.min(d, soft ? (w > 1000 ? 0.8 : 1) : 1.5) : dpr;
      if (nd < dpr) { dpr = nd; renderer.setPixelRatio(dpr); glowU.uDpr.value = dpr; }
      resize(); if (introDone) warm();
    },
    setCue(i) {
      if (i === cueI) return;
      cueI = i; alt = false; highlight = null;
      if (opening) { introEnd = Math.max(clock() + 0.9, 1.4); }
      retarget(true);
    },
    highlight(repoId) {
      if (repoId === highlight) return;
      highlight = repoId;
      const f = getFormation(cueI, alt);
      for (let i = 0; i < N; i++) lumT[i] = hl(i, f.lum[i]);
      idle = false;
    },
  };
}
