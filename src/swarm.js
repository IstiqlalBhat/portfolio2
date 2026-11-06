// The WebGL show: one Blender-modelled quadcopter per commit, flocking (boids) between formations.
// Glows are GL points (one vertex per drone: instanced quads are pathologically slow on software GL),
// hover and twinkle run in the shaders, and once a formation has settled the CPU does no per-drone
// work at all. Drone meshes are instanced and drawn only when the camera is close to them.
import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, InstancedBufferGeometry,
  InstancedBufferAttribute, BufferAttribute, ShaderMaterial, Mesh, Points, AdditiveBlending,
  DoubleSide, Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const FOV = 45;
const D = 60;            // camera distance to the formation plane (z = 0)
const CAM_Y = 0.25;      // eye height above the water (y = 0)
const DRONE = 0.18;      // drone mesh scale in world units
const PAD_STEP = 0.3;    // launch-grid spacing
const FLOCK = 0.55;      // seconds of free flocking between formations
const RAMP = 1.0;        // seconds for a drone to blend from flocking into formation
const SPREAD = 0.45;     // per-drone random delay before it blends in
const HOLD = 5.2;        // hero: seconds a formation holds before the swarm re-forms
const CAM0 = 0.45;       // intro: camera starts to rise
const FIRST = 0.8;       // intro: the first formation starts pulling

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

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
// glows: one point per drone; a moving drone draws a light streak behind it (long-exposure look)
const GLOW_VS = /* glsl */`
attribute vec3 iCol; attribute float iLum; attribute vec3 iVel; attribute float seed;
uniform float uBase, uMinPx, uPxPerUnit, uMirror, uTime, uDpr, uMaxPt, uTrail, uSweepT, uSweepW;
uniform vec2 uView;
varying vec3 vC; varying float vA, vR, vS; varying vec2 vT;
void main() {
  vec3 p = position;
  p.y += ${HOVER} - 0.012;
  if (uMirror > 0.5) p.y = -p.y;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float depth = max(-mv.z, 0.05);
  float size = max(uBase * (0.6 + 0.4 * iLum), uMinPx * depth / uPxPerUnit);
  float px = size * uPxPerUnit / depth;
  vA = iLum; vC = iCol;
  // a formation locks in with a shimmer: a band of light sweeps across it once
  float sw = (uTime - uSweepT) / 1.1;
  if (sw > 0.0 && sw < 1.0 && iLum > 0.5) {
    float e = (position.x - mix(-uSweepW, uSweepW, sw)) / (uSweepW * 0.14);
    vA *= 1.0 + 0.9 * exp(-e * e);
  }
  vec2 T = vec2(0.0);
  float S = px;
  if (uMirror > 0.5) {
    vA *= smoothstep(0.15, 1.2, position.y);
    mv.x += sin(uTime * 1.6 + p.y * 1.7 + position.x * 0.6) * size * 0.35;
    S = px * 2.2;
  } else if (uTrail > 0.0) {
    vec3 vv = mat3(viewMatrix) * iVel;
    vec2 sv = uPxPerUnit * (vv.xy * depth + mv.xy * vv.z) / (depth * depth);
    T = vec2(-sv.x, sv.y) * uTrail;
    float tl = length(T), cap = px * 6.0;
    if (tl > cap) T *= cap / tl;
    S = px + length(T);
  }
  float k = min(1.0, uMaxPt / max(S * uDpr, 1.0));
  vR = px * 0.5 * k; vT = T * k; vS = S * k;
  gl_Position = projectionMatrix * mv;
  gl_Position.xy += vec2(vT.x / uView.x, -vT.y / uView.y) * gl_Position.w;
  gl_PointSize = vA < 0.004 ? 0.0 : vS * uDpr;
}`;
const GLOW_FS = /* glsl */`
uniform float uGain, uMirror;
varying vec3 vC; varying float vA, vR, vS; varying vec2 vT;
void main() {
  vec2 q = (gl_PointCoord - 0.5) * vS;
  if (uMirror > 0.5) {
    vec2 uv = q / (vR * vec2(0.75, 2.2));
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
  vec3 c = vC * (core * 1.25 + halo + streak) + vec3((core * 0.45 + streak * 0.15) * vA);
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

async function loadDrone(glb) {
  const buf = await (glb || fetch(new URL('./assets/drone.glb', document.baseURI)).then((r) => (r.ok ? r.arrayBuffer() : null)));
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

const yieldTask = () => new Promise((r) => setTimeout(r, 0)); // keeps boot work in short tasks

export async function start({ canvas, cues, fleet, layout, formation, params, tier = 'gpu', gl: context = null, glb, onIntroEnd }) {
  const soft = tier === 'soft' || params.has('soft');
  const lite = soft || matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
  const renderer = new WebGLRenderer(context ? { canvas, context } : { canvas, antialias: !lite, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  let dpr = Math.min(window.devicePixelRatio || 1, soft ? 1 : 1.5);
  renderer.setPixelRatio(dpr);
  const gl = renderer.getContext();
  const maxPt = Math.max(16, (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) || [1, 64])[1]);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, innerWidth / innerHeight, 0.05, 900);
  const showCam = new PerspectiveCamera(FOV, innerWidth / innerHeight, 0.05, 900);
  const showPos = new Vector3(), showLook = new Vector3();

  const N = fleet.n;
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), tgt = new Float32Array(N * 3);
  const col = new Float32Array(N * 3), lum = new Float32Array(N), colT = new Float32Array(N * 3), lumT = new Float32Array(N);
  const delay = new Float32Array(N), omega = new Float32Array(N), launch = new Float32Array(N), seed = new Float32Array(N);
  const animated = new Uint8Array(N);
  // boids neighbour sums, refreshed for half the flock per step (alternating)
  const nb = new Float32Array(N * 9), nbOk = new Uint8Array(N);

  // launch grid: oldest commits in the front row; the back rows lift first, so the close-up drone
  // in the front row is the last to go and the take-off rolls toward the camera
  const cols = Math.ceil(Math.sqrt(N));
  const rows = Math.ceil(N / cols);
  const padZ0 = 28;
  for (let i = 0; i < N; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    pos[i * 3] = (c - (cols - 1) / 2) * PAD_STEP; pos[i * 3 + 1] = 0.05; pos[i * 3 + 2] = padZ0 + ((rows - 1) / 2 - r) * PAD_STEP;
    launch[i] = 0.25 + (1 - r / Math.max(1, rows - 1)) * 0.8 + Math.random() * 0.15;
    omega[i] = 2.6 + Math.random() * 1.1;
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
    uMaxPt: { value: maxPt }, uTrail: { value: 0 }, uView: { value: [innerWidth, innerHeight] },
    uSweepT: { value: -100 }, uSweepW: { value: 40 },
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
    const stars = new Points(g, m);
    stars.frustumCulled = false;
    scene.add(stars);
  }

  await yieldTask();
  // drone meshes (instanced; the show starts on glows if the glTF is late)
  let drones = null;
  // GPUs draw the first rows straight from the shared state; software GL (where every instance is
  // expensive) draws only a window of the nearest drones, copied into small buffers each frame
  const meshRows = params.has('rows') ? +params.get('rows') : soft ? 3 : 12;
  let meshIdx = null;
  if (soft) {
    const half = 5, mid = (cols - 1) / 2, list = [];
    for (let r = 0; r < meshRows; r++) for (let c = Math.max(0, Math.ceil(mid - half)); c <= Math.min(cols - 1, Math.floor(mid + half)); c++) if (r * cols + c < N) list.push(r * cols + c);
    meshIdx = Int32Array.from(list);
  }
  const meshCap = meshIdx ? meshIdx.length : Math.min(N, cols * meshRows);
  const sub = (a, k) => (meshIdx ? new Float32Array(meshIdx.length * k) : a);
  const iPos = dyn(new InstancedBufferAttribute(sub(pos, 3), 3)), iVel = dyn(new InstancedBufferAttribute(sub(vel, 3), 3));
  const iCol = dyn(new InstancedBufferAttribute(sub(col, 3), 3)), iLum = dyn(new InstancedBufferAttribute(sub(lum, 1), 1));
  const iSeed = new InstancedBufferAttribute(meshIdx ? Float32Array.from(meshIdx, (i) => seed[i]) : seed, 1);
  function copyMesh() {
    if (!meshIdx) return;
    const P = iPos.array, V = iVel.array, C = iCol.array, U = iLum.array;
    for (let k = 0; k < meshIdx.length; k++) {
      const i = meshIdx[k];
      for (let c = 0; c < 3; c++) { P[k * 3 + c] = pos[i * 3 + c]; V[k * 3 + c] = vel[i * 3 + c]; C[k * 3 + c] = col[i * 3 + c]; }
      U[k] = lum[i];
    }
  }
  const droneU = { uTime: glowU.uTime, uScale: { value: DRONE }, uYaw: { value: 0 }, uMoon: { value: new Vector3() }, uDown: { value: new Vector3() } };
  // close-up: at the closing cue the drone carrying the newest commit flies to the camera and shows
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
  const loaded = loadDrone(glb).then((geo) => {
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

  // ---- layout / formations ----
  let L = null, cueI = 0, alt = false, cueStart = 0, formedAt = Infinity, highlight = null, unitsPerPx = 0.06;
  let anim = null, idle = false, goalX = 0, goalY = 0, goalZ = 0, trail = 0.06;
  const cache = new Map();
  const tmp = new Vector3();
  const cp = new Vector3(), bR = new Vector3(), bU = new Vector3(), bF = new Vector3();
  function placeShowCam() {
    const tanHalf = Math.tan((FOV / 2) * Math.PI / 180);
    const tanTilt = (L.hz - 0.5) * 2 * tanHalf;
    showPos.set(0, CAM_Y, D);
    showLook.set(0, CAM_Y + D * tanTilt, 0);
    showCam.aspect = L.w / L.h;
    showCam.position.copy(showPos);
    showCam.lookAt(showLook);
    showCam.updateProjectionMatrix();
    showCam.updateMatrixWorld(true);
    unitsPerPx = (2 * Math.hypot(D, D * tanTilt) * tanHalf) / L.h;
    L.upp = unitsPerPx;
    // ray basis: dir(ndc) = F + nx * R + ny * U  (closed form of unproject for this camera)
    const e = showCam.matrixWorld.elements;
    cp.copy(showCam.position);
    bR.set(e[0], e[1], e[2]).multiplyScalar(tanHalf * showCam.aspect);
    bU.set(e[4], e[5], e[6]).multiplyScalar(tanHalf);
    bF.set(-e[8], -e[9], -e[10]);
  }
  // screen (CSS px) -> point on the formation plane z = 0
  function toWorld(sx, sy, out, o) {
    const nx = (sx / L.w) * 2 - 1, ny = 1 - (sy / L.h) * 2;
    const dx = bF.x + nx * bR.x + ny * bU.x, dy = bF.y + nx * bR.y + ny * bU.y, dz = bF.z + nx * bR.z + ny * bU.z;
    const t = -cp.z / dz;
    out[o] = cp.x + dx * t;
    out[o + 1] = Math.max(0.15, cp.y + dy * t);
  }
  function getFormation(ci, a) {
    const key = ci * 2 + (a ? 1 : 0);
    let f = cache.get(key);
    if (!f) {
      const s = formation(cues[ci], fleet, L, a);
      const t = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { toWorld(s.pos[i * 3], s.pos[i * 3 + 1], t, i * 3); t[i * 3 + 2] = s.pos[i * 3 + 2]; }
      let gx = 0, gy = 0, gz = 0;
      for (let i = 0; i < N; i += 7) { gx += t[i * 3]; gy += t[i * 3 + 1]; gz += t[i * 3 + 2]; }
      const gk = 7 / N;
      f = { tgt: t, col: s.col, lum: s.lum, anim: s.anim || null, goal: [gx * gk, gy * gk, gz * gk] };
      cache.set(key, f);
    }
    return f;
  }
  const hl = (i, l) => (highlight == null ? l : fleet.repo[i] === highlight ? Math.min(1.2, l * 2.4) : l * 0.3);
  function applyAnim(now) {
    if (!anim) return;
    anim.update(now);
    const { ids, xyz } = anim;
    for (let k = 0; k < ids.length; k++) {
      const i = ids[k], i3 = i * 3;
      toWorld(xyz[k * 3], xyz[k * 3 + 1], tgt, i3);
      tgt[i3 + 2] = xyz[k * 3 + 2];
      lumT[i] = hl(i, anim.lum[k]);
    }
  }
  function retarget(flock) {
    const f = getFormation(cueI, alt);
    tgt.set(f.tgt); colT.set(f.col);
    for (let i = 0; i < N; i++) lumT[i] = hl(i, f.lum[i]);
    anim = f.anim;
    animated.fill(0);
    if (anim) for (const i of anim.ids) animated[i] = 1;
    [goalX, goalY, goalZ] = f.goal;
    const now = clock();
    if (flock) {
      cueStart = now;
      for (let i = 0; i < N; i++) delay[i] = Math.random() * SPREAD;
      nbOk.fill(2); // stale neighbour sums are dropped; each half refreshes on its next turn
    }
    formedAt = flock ? now + FLOCK + RAMP + SPREAD + 0.2 : now;
    glowU.uSweepT.value = flock ? formedAt - 0.25 : -100;
    trail = cues[cueI].finale ? 0.32 : cues[cueI].kind === 'fleet' ? 0.16 : 0.06;
    idle = false;
  }
  function resize() {
    const w = innerWidth, h = innerHeight;
    L = layout(w, h);
    document.documentElement.style.setProperty('--hz', (L.hz * 100).toFixed(2) + '%');
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    placeShowCam();
    glowU.uPxPerUnit.value = h / (2 * Math.tan((FOV / 2) * Math.PI / 180));
    glowU.uView.value = [w, h];
    glowU.uSweepW.value = (w * unitsPerPx) / 2;
    cache.clear();
    retarget(false);
  }

  // ---- input ----
  const pointer = { x: 0, y: 0, t: -1e9, nx: 0, ny: 0 };
  const P = new Vector3();
  const onPoint = (x, y) => { pointer.x = x; pointer.y = y; pointer.t = clock(); pointer.nx = x / innerWidth - 0.5; pointer.ny = y / innerHeight - 0.5; idle = false; };
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') onPoint(e.clientX, e.clientY); }, { passive: true });
  addEventListener('pointerdown', (e) => onPoint(e.clientX, e.clientY), { passive: true });
  addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) onPoint(t.clientX, t.clientY); }, { passive: true });

  // ---- spatial hash for boids (8-cell octant search, radius CELL / 2) ----
  const CELL = 3.0, TABLE = 8192, RAD2 = (CELL / 2) * (CELL / 2), KMAX = 7;
  const head = new Int32Array(TABLE), next = new Int32Array(N);
  const hash = (x, y, z) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (TABLE - 1);

  // the intro starts once the drone model is in (or after 1.5 s without it); shaders compile first
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 1500))]);
  let t0 = performance.now();
  const clock = () => (performance.now() - t0) / 1000;
  let opening = params.has('still') ? 0 : 1; // 1 while the camera is still flying the intro
  let introEnd = params.has('still') ? 0 : 3.2;
  let introDone = false;
  const macro = params.has('macro'); // ?macro holds the opening close-up (for inspecting the model)
  if (macro) launch.fill(1e9);
  let last = 0, lastDraw = -1, parity = 0;
  let slow = 0, frames = 0;

  function step(dt, now) {
    const blendAt = cueStart + FLOCK;
    const flocking = now < blendAt + SPREAD + RAMP;
    parity ^= 1;
    if (flocking) {
      head.fill(-1);
      for (let i = 0; i < N; i++) {
        const h = hash(Math.floor(pos[i * 3] / CELL), Math.floor(pos[i * 3 + 1] / CELL), Math.floor(pos[i * 3 + 2] / CELL));
        next[i] = head[h]; head[h] = i;
      }
    }
    // flock goal = centre of the next formation, wandering a little (kept low during the take-off)
    let gx = goalX + Math.sin(now * 0.9) * (opening ? 3 : 6), gy = goalY + Math.cos(now * 0.7) * 2, gz = goalZ + Math.sin(now * 0.5) * 4;
    if (opening) {
      // take-off: the swarm sweeps out low over the water, then rises into place, always in frame
      const s = smooth((now - 0.4) / 1.9);
      gy = 1.2 + (goalY - 2 - 1.2) * s;
      gz = padZ0 - 6 + (goalZ - padZ0 + 6) * s;
    }

    // the pointer scatters the swarm, except on the fleet where it inspects squadrons
    const ptrOn = now - pointer.t < 1.4 && now > introEnd && cues[cueI].kind !== 'fleet';
    if (ptrOn) {
      tmp.set((pointer.x / innerWidth) * 2 - 1, -(pointer.y / innerHeight) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
      const t = -camera.position.z / tmp.z;
      P.copy(camera.position).addScaledVector(tmp, t);
    }
    const pr = L.mobile ? 2.6 : 3.4;
    const colK = Math.min(1, dt * 2.5);
    // drones at rest are skipped unless something global moves everyone (an animated formation
    // only keeps its own drones busy)
    const hold = flocking || ptrOn || opening;
    let busy = hold || !!anim || closing;

    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      let px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
      let vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2];
      let ax = 0, ay = 0, az = 0;
      const sinceLaunch = now - launch[i];
      if (sinceLaunch < 0) { // parked on the pad, rotors spinning
        lum[i] += (0.45 - lum[i]) * colK;
        continue;
      }
      const w = smooth((now - blendAt - delay[i]) / RAMP);
      // formation: critically damped spring toward the target
      if (w > 0) {
        const om = omega[i] * (opening ? 0.85 : 1);
        const k = om * om * w, c = 2 * om * w;
        ax += (tgt[i3] - px) * k - vx * c;
        ay += (tgt[i3 + 1] - py) * k - vy * c;
        az += (tgt[i3 + 2] - pz) * k - vz * c;
      }
      // boids while not in formation
      const f = 1 - w;
      if (f > 0.01) {
        if (sinceLaunch < 0.6) ay += (opening ? 11 : 26) * f; // climb off the pad
        const o9 = i * 9;
        if ((i & 1) === parity || !nbOk[i]) {
          let sx = 0, sy = 0, sz = 0, axv = 0, ayv = 0, azv = 0, cx = 0, cy = 0, cz = 0, cnt = 0;
          const fx = px / CELL, fy = py / CELL, fz = pz / CELL;
          const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
          const ox = fx - ix < 0.5 ? -1 : 1, oy = fy - iy < 0.5 ? -1 : 1, oz = fz - iz < 0.5 ? -1 : 1;
          outer: for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let d = 0; d < 2; d++) {
            for (let j = head[hash(ix + a * ox, iy + b * oy, iz + d * oz)]; j !== -1; j = next[j]) {
              if (j === i) continue;
              const j3 = j * 3;
              const dx = px - pos[j3], dy = py - pos[j3 + 1], dz = pz - pos[j3 + 2];
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > RAD2 || d2 < 1e-6) continue;
              if (d2 < 0.36) { sx += dx / d2; sy += dy / d2; sz += dz / d2; }
              axv += vel[j3]; ayv += vel[j3 + 1]; azv += vel[j3 + 2];
              cx += pos[j3]; cy += pos[j3 + 1]; cz += pos[j3 + 2];
              if (++cnt >= KMAX) break outer;
            }
          }
          if (cnt) {
            nb[o9] = axv / cnt; nb[o9 + 1] = ayv / cnt; nb[o9 + 2] = azv / cnt;
            nb[o9 + 3] = cx / cnt; nb[o9 + 4] = cy / cnt; nb[o9 + 5] = cz / cnt;
            nb[o9 + 6] = sx; nb[o9 + 7] = sy; nb[o9 + 8] = sz;
            nbOk[i] = 1;
          } else nbOk[i] = 2; // looked, nobody near
        }
        let bx = (gx - px) * 0.35, by = (gy - py) * 0.35, bz = (gz - pz) * 0.35;
        if (nbOk[i] === 1) {
          bx += (nb[o9] - vx) * 1.6 + (nb[o9 + 3] - px) * 1.1 + nb[o9 + 6] * 1.1;
          by += (nb[o9 + 1] - vy) * 1.6 + (nb[o9 + 4] - py) * 1.1 + nb[o9 + 7] * 1.1;
          bz += (nb[o9 + 2] - vz) * 1.6 + (nb[o9 + 5] - pz) * 1.1 + nb[o9 + 8] * 1.1;
        }
        // keep cruising speed
        const sp = Math.hypot(vx, vy, vz) + 1e-5;
        const cruise = (10 - sp) * 0.9;
        bx += (vx / sp) * cruise; by += (vy / sp) * cruise; bz += (vz / sp) * cruise;
        if (py < 1.2) by += (1.2 - py) * 6;
        ax += bx * f; ay += by * f; az += bz * f;
      } else if (!hold && !animated[i]) {
        // in formation and nothing is pulling: snap the last fraction of a pixel and rest
        const ex = tgt[i3] - px, ey = tgt[i3 + 1] - py, ez = tgt[i3 + 2] - pz;
        if (ex * ex + ey * ey + ez * ez < 4e-4 && vx * vx + vy * vy + vz * vz < 4e-3) {
          pos[i3] = tgt[i3]; pos[i3 + 1] = tgt[i3 + 1]; pos[i3 + 2] = tgt[i3 + 2];
          vel[i3] = 0; vel[i3 + 1] = 0; vel[i3 + 2] = 0;
          const dc = Math.abs(colT[i3] - col[i3]) + Math.abs(colT[i3 + 1] - col[i3 + 1]) + Math.abs(colT[i3 + 2] - col[i3 + 2]) + Math.abs(lumT[i] - lum[i]);
          if (dc < 0.01) { col[i3] = colT[i3]; col[i3 + 1] = colT[i3 + 1]; col[i3 + 2] = colT[i3 + 2]; lum[i] = lumT[i]; continue; }
        }
        busy = true;
      }
      if (ptrOn) {
        const dx = px - P.x, dy = py - P.y, d = Math.hypot(dx, dy) + 1e-4;
        if (d < pr) { const s = (1 - d / pr); const k = s * s * 160 / d; ax += dx * k; ay += dy * k; az -= s * 20; }
      }
      // clamp acceleration, integrate (the close-up drone may fly faster: it crosses the whole scene)
      const fast = closing && i === H;
      const am = Math.hypot(ax, ay, az), AM = fast ? 160 : 90;
      if (am > AM) { ax *= AM / am; ay *= AM / am; az *= AM / am; }
      vx += ax * dt; vy += ay * dt; vz += az * dt;
      const sp = Math.hypot(vx, vy, vz), VM = fast ? 75 : 34;
      if (sp > VM) { vx *= VM / sp; vy *= VM / sp; vz *= VM / sp; }
      pos[i3] = px + vx * dt; pos[i3 + 1] = Math.max(0.05, py + vy * dt); pos[i3 + 2] = pz + vz * dt;
      vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
      if (animated[i] && w >= 1) { lum[i] = lumT[i]; } else lum[i] += (lumT[i] - lum[i]) * colK * (0.35 + 0.65 * w);
      const ck = colK * (0.35 + 0.65 * w);
      col[i3] += (colT[i3] - col[i3]) * ck; col[i3 + 1] += (colT[i3 + 1] - col[i3 + 1]) * ck; col[i3 + 2] += (colT[i3 + 2] - col[i3 + 2]) * ck;
    }
    return busy;
  }

  function frame() {
    requestAnimationFrame(frame);
    const now = clock();
    // hero alternates name and hook
    if (cues[cueI].alt && now > formedAt + (alt ? HOLD : HOLD + 1.8) && now > introEnd) { alt = !alt; retarget(true); }
    // frame budget: software GL and settled formations run at 30 fps; on software GL a settled
    // formation is not redrawn at all (the drift pauses) so the page goes quiet
    if (soft && idle && lastDraw > 0 && now - pointer.t > 1.4) return;
    const cap = soft || idle ? 1 / 30 : 0;
    if (cap && now - lastDraw < cap - 0.004) return;
    lastDraw = now;
    let dt = Math.min(0.1, Math.max(1 / 240, now - last));
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

    // camera: intro flight, then a slow drift that shows the depth
    const k = macro ? 0 : opening ? easeInOut(clamp01((now - CAM0) / (introEnd - CAM0 - 0.1))) : 1;
    if (opening && k >= 1) opening = 0;
    if (!introDone && !opening && now >= introEnd) { introDone = true; onIntroEnd?.(); warm(); }
    const drift = Math.sin(now * 0.11) * 0.9 + pointer.nx * 1.4;
    const lift = (1 - k) * (L.mobile ? 0.22 : 0.1) * L.h;
    if (lift > 0.5) camera.setViewOffset(L.w, L.h, 0, lift, L.w, L.h); else if (camera.view && camera.view.enabled) camera.clearViewOffset();
    camera.position.lerpVectors(startPos, showPos, k);
    camera.position.x += drift * k;
    camera.position.y += (Math.sin(now * 0.07) * 0.25 - pointer.ny * 0.6) * k;
    tmp.lerpVectors(startLook, showLook, k);
    camera.lookAt(tmp);
    camera.updateMatrixWorld();
    glowU.uTrail.value = opening ? trail * 0.4 * k : trail;
    const show = unitsPerPx * L.spacing * (L.mobile ? 2.35 : 2.7);
    glowU.uBase.value = 0.045 + (show - 0.045) * k;
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
    renderer.render(scene, camera);

    // adapt: drop to 1x pixels if a phone struggles after the intro
    if (!opening && !idle && dpr > 1 && frames < 240) {
      frames++;
      if (dt > 1 / 40) slow++;
      if (frames === 240 && slow > 120) { dpr = 1; renderer.setPixelRatio(1); glowU.uDpr.value = 1; resize(); }
    }
  }

  // the close-up spot rides with the camera (it drifts), just above the horizon and clear of the text
  const ce = camera.matrixWorld.elements;
  function closeUp(now) {
    const d = L.mobile ? 1.3 : 0.8, ax = L.mobile ? 0.02 : 0.58, ay = L.mobile ? 0.24 : -0.38;
    const th = Math.tan((FOV / 2) * Math.PI / 180), asp = camera.aspect;
    const bob = Math.sin(now * 1.1) * 0.012, sway = Math.sin(now * 0.6) * 0.02;
    const h3 = H * 3;
    for (let c = 0; c < 3; c++) tgt[h3 + c] = camera.position.getComponent(c) + d * (-ce[8 + c] + ax * th * asp * ce[c] + ay * th * ce[4 + c]) + (c === 0 ? sway : c === 1 ? bob : 0);
    const dist = Math.hypot(pos[h3] - camera.position.x, pos[h3 + 1] - camera.position.y, pos[h3 + 2] - camera.position.z);
    lumT[H] = Math.min(1, Math.max(0, (dist - 3) / 8));
    animated[H] = 1;
    delay[H] = -FLOCK - RAMP; // no flocking: it heads straight for the camera
  }

  // precompute every formation in idle time, nearest cues first, so a cue change is a copy
  let warming = false;
  function warm() {
    if (warming) return;
    warming = true;
    const ric = window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 1500 }) : (f) => setTimeout(f, 50);
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
  addEventListener('resize', () => { resize(); if (introDone) warm(); });
  retarget(true);
  await yieldTask();
  renderer.compile(scene, camera);
  await yieldTask();
  t0 = performance.now();
  last = 0;
  cueStart = FIRST; // first formation assembles after the takeoff climb
  if (params.has('still')) { cueStart = -10; for (let i = 0; i < N; i++) { launch[i] = -10; pos.set([tgt[i * 3], tgt[i * 3 + 1], tgt[i * 3 + 2]], i * 3); col.set(colT.subarray(i * 3, i * 3 + 3), i * 3); lum[i] = lumT[i]; } }
  formedAt = cueStart + FLOCK + RAMP + SPREAD + 0.2;
  glowU.uSweepT.value = params.has('still') ? -100 : formedAt - 0.25;
  requestAnimationFrame(frame);

  if (params.has('debug')) window.__swarm = { pos, tgt, vel, camera, H, L: () => L };
  return {
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
