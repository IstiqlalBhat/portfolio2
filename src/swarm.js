// The WebGL show: one Blender-modelled quadcopter per commit, flocking (boids) between formations.
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
const FLOCK = 0.75;      // seconds of free flocking between formations
const RAMP = 1.5;        // seconds for a drone to blend from flocking into formation
const HOLD = 5.2;        // hero: seconds a formation holds before the swarm re-forms

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

const DRONE_VS = /* glsl */`
attribute float part;
attribute vec3 iPos; attribute vec3 iVel; attribute vec3 iCol; attribute float iLum;
uniform float uTime, uScale;
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
  vec3 v = vec3(iVel.x, 0.0, iVel.z);
  float sp = length(v);
  if (sp > 0.001) { vec3 ax = normalize(vec3(v.z, 0.0, -v.x)); float a = min(sp * 0.045, 0.42); p = rot(p, ax, a); n = rot(n, ax, a); }
  vec4 mv = modelViewMatrix * vec4(iPos + p * uScale, 1.0);
  vN = normalize(normalMatrix * n); vView = -mv.xyz; vC = iCol * (0.2 + 0.8 * iLum); vPart = part;
  gl_Position = projectionMatrix * mv;
}`;
const DRONE_FS = /* glsl */`
uniform vec3 uMoon, uDown;
varying vec3 vN, vC, vView; varying float vPart;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  if (vPart > 1.5) { gl_FragColor = vec4(vC * 1.5 + 0.12, 1.0); return; }
  vec3 base = vPart > 0.5 ? vec3(0.2, 0.22, 0.28) : vec3(0.1, 0.115, 0.16);
  float moon = max(dot(n, uMoon), 0.0);
  float under = max(dot(n, uDown), 0.0);
  float rim = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 3.0);
  vec3 c = base * (0.45 + 1.6 * moon * vec3(0.78, 0.84, 1.0)) + vC * under * 0.55 + rim * vec3(0.22, 0.27, 0.48);
  gl_FragColor = vec4(c, 1.0);
}`;
const GLOW_VS = /* glsl */`
attribute vec3 iPos; attribute vec3 iCol; attribute float iLum;
uniform float uBase, uMinPx, uPxPerUnit, uMirror, uTime;
varying vec2 vUv; varying vec3 vC; varying float vA;
void main() {
  vec3 p = iPos + vec3(0.0, -0.012, 0.0);
  if (uMirror > 0.5) p.y = -p.y;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  float size = max(uBase * (0.6 + 0.4 * iLum), uMinPx * depth / uPxPerUnit);
  vec2 q = position.xy;
  vA = iLum;
  if (uMirror > 0.5) {
    vA *= smoothstep(0.15, 1.2, iPos.y);
    q *= vec2(0.75, 2.2);
    mv.x += sin(uTime * 1.6 + p.y * 1.7 + iPos.x * 0.6) * size * 0.35;
  }
  mv.xy += q * size;
  vUv = position.xy * 2.0; vC = iCol;
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FS = /* glsl */`
uniform float uGain;
varying vec2 vUv; varying vec3 vC; varying float vA;
void main() {
  float d2 = dot(vUv, vUv);
  float core = exp(-d2 * 16.0), halo = exp(-d2 * 4.0) * 0.28;
  vec3 c = vC * (core * 1.25 + halo) + vec3(core * 0.45 * vA);
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

async function loadDrone(url) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const parts = { drone_frame: 0, drone_rotor: 1, drone_led: 2 };
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
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
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

export async function start({ canvas, cues, fleet, layout, formation, params }) {
  const lite = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
  const renderer = new WebGLRenderer({ canvas, antialias: !lite, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, innerWidth / innerHeight, 0.05, 900);
  const showCam = new PerspectiveCamera(FOV, innerWidth / innerHeight, 0.05, 900);
  const showPos = new Vector3(), showLook = new Vector3();

  const N = fleet.n;
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), tgt = new Float32Array(N * 3);
  const col = new Float32Array(N * 3), lum = new Float32Array(N), colT = new Float32Array(N * 3), lumT = new Float32Array(N);
  const delay = new Float32Array(N), omega = new Float32Array(N), phase = new Float32Array(N), launch = new Float32Array(N);
  const padX = new Float32Array(N), padZ = new Float32Array(N);

  // launch grid: oldest commits in the front row
  const cols = Math.ceil(Math.sqrt(N));
  const rows = Math.ceil(N / cols);
  const padZ0 = 28;
  for (let i = 0; i < N; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    padX[i] = (c - (cols - 1) / 2) * PAD_STEP;
    padZ[i] = padZ0 + ((rows - 1) / 2 - r) * PAD_STEP;
    pos[i * 3] = padX[i]; pos[i * 3 + 1] = 0.05; pos[i * 3 + 2] = padZ[i];
    launch[i] = 1.05 + (r / rows) * 1.25 + Math.random() * 0.25;
    omega[i] = 2.5 + Math.random() * 1.1;
    phase[i] = Math.random() * Math.PI * 2;
    col[i * 3] = 1; col[i * 3 + 1] = 0.9; col[i * 3 + 2] = 0.75; lum[i] = 0.7;
  }
  const front = padZ0 + ((rows - 1) / 2) * PAD_STEP;
  // macro shot of the front-centre drone; a lens shift lifts it into the upper half (hero text sits below)
  const startPos = new Vector3(0.05, 0.2, front + 0.6), startLook = new Vector3(0, 0.05, front);

  // shared instanced attributes
  const aPos = new InstancedBufferAttribute(pos, 3), aVel = new InstancedBufferAttribute(vel, 3);
  const aCol = new InstancedBufferAttribute(col, 3), aLum = new InstancedBufferAttribute(lum, 1);
  [aPos, aVel, aCol, aLum].forEach((a) => a.setUsage(35048)); // DYNAMIC_DRAW

  // glows (+ their reflections on the water)
  const quad = new InstancedBufferGeometry();
  quad.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  quad.setAttribute('iPos', aPos); quad.setAttribute('iCol', aCol); quad.setAttribute('iLum', aLum);
  quad.instanceCount = N;
  const glowU = { uBase: { value: 0.1 }, uMinPx: { value: 2.6 }, uPxPerUnit: { value: 1 }, uMirror: { value: 0 }, uTime: { value: 0 }, uGain: { value: 1 } };
  const mkGlow = (mirror, gain) => new Mesh(quad, new ShaderMaterial({
    vertexShader: GLOW_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, premultipliedAlpha: true,
    uniforms: { ...glowU, uMirror: { value: mirror }, uGain: { value: gain } },
  }));
  const glow = mkGlow(0, 1), mirror = mkGlow(1, 0.3);
  for (const m of [glow, mirror]) { m.frustumCulled = false; m.material.uniforms.uBase = glowU.uBase; m.material.uniforms.uPxPerUnit = glowU.uPxPerUnit; m.material.uniforms.uTime = glowU.uTime; }
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
    const m = new ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false, blending: AdditiveBlending, premultipliedAlpha: true, uniforms: { uTime: glowU.uTime, uDpr: { value: dpr } } });
    const stars = new Points(g, m);
    stars.frustumCulled = false;
    scene.add(stars);
  }

  // drone meshes (lazy: the show starts on glows, meshes join when the glTF lands)
  let drones = null;
  const droneU = { uTime: glowU.uTime, uScale: { value: DRONE }, uMoon: { value: new Vector3() }, uDown: { value: new Vector3() } };
  const loaded = loadDrone(new URL('./assets/drone.glb', document.baseURI).href).then((geo) => {
    geo.setAttribute('iPos', aPos); geo.setAttribute('iVel', aVel); geo.setAttribute('iCol', aCol); geo.setAttribute('iLum', aLum);
    geo.instanceCount = N;
    drones = new Mesh(geo, new ShaderMaterial({ vertexShader: DRONE_VS, fragmentShader: DRONE_FS, side: DoubleSide, uniforms: droneU }));
    drones.frustumCulled = false;
    drones.renderOrder = 1;
    scene.add(drones);
  }).catch(() => {});

  // ---- layout / formations ----
  let L = null, cueI = 0, alt = false, cueStart = 0, formedAt = Infinity, highlight = null, unitsPerPx = 0.06;
  const tmp = new Vector3();
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
  }
  function toWorld(f) {
    const cp = showCam.position;
    for (let i = 0; i < N; i++) {
      tmp.set((f.pos[i * 3] / L.w) * 2 - 1, -(f.pos[i * 3 + 1] / L.h) * 2 + 1, 0.5).unproject(showCam).sub(cp).normalize();
      const t = -cp.z / tmp.z;
      tgt[i * 3] = cp.x + tmp.x * t;
      tgt[i * 3 + 1] = Math.max(0.15, cp.y + tmp.y * t);
      tgt[i * 3 + 2] = f.pos[i * 3 + 2];
    }
    colT.set(f.col);
    lumT.set(f.lum);
    if (highlight != null) for (let i = 0; i < N; i++) lumT[i] = fleet.repo[i] === highlight ? Math.min(1, lumT[i] * 2.4) : lumT[i] * 0.3;
  }
  function retarget(flock) {
    toWorld(formation(cues[cueI], fleet, L, alt));
    const now = clock();
    if (flock) {
      cueStart = now;
      for (let i = 0; i < N; i++) delay[i] = Math.random() * 0.55;
    }
    formedAt = (flock ? now + FLOCK + RAMP + 0.6 : now);
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
    retarget(false);
  }

  // ---- input ----
  const pointer = { x: 0, y: 0, t: -1e9, nx: 0, ny: 0 };
  const P = new Vector3();
  const onPoint = (x, y) => { pointer.x = x; pointer.y = y; pointer.t = clock(); pointer.nx = x / innerWidth - 0.5; pointer.ny = y / innerHeight - 0.5; };
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') onPoint(e.clientX, e.clientY); }, { passive: true });
  addEventListener('pointerdown', (e) => onPoint(e.clientX, e.clientY), { passive: true });
  addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) onPoint(t.clientX, t.clientY); }, { passive: true });

  // ---- spatial hash for boids ----
  const CELL = 2.4, TABLE = 8192;
  const head = new Int32Array(TABLE), next = new Int32Array(N);
  const hash = (x, y, z) => ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & (TABLE - 1);

  // the intro starts once the drone model is in (or after 2.5 s without it)
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 2500))]);
  const t0 = performance.now();
  const clock = () => (performance.now() - t0) / 1000;
  let opening = params.has('still') ? 0 : 1; // 1 while the camera is still flying the intro
  let introEnd = params.has('still') ? 0 : 4.7;
  const macro = params.has('macro'); // ?macro holds the opening close-up (for inspecting the model)
  if (macro) launch.fill(1e9);
  let last = clock();
  let slow = 0, frames = 0;

  function step(dt, now) {
    const flocking = cueStart + FLOCK;
    // build the hash only when someone is flocking
    let anyFlock = false;
    for (let i = 0; i < N; i++) if (now < flocking + delay[i] + RAMP) { anyFlock = true; break; }
    if (anyFlock) {
      head.fill(-1);
      for (let i = 0; i < N; i++) {
        const h = hash(Math.floor(pos[i * 3] / CELL), Math.floor(pos[i * 3 + 1] / CELL), Math.floor(pos[i * 3 + 2] / CELL));
        next[i] = head[h]; head[h] = i;
      }
    }
    // flock goal = centre of the next formation, wandering a little
    let gx = 0, gy = 0, gz = 0;
    for (let i = 0; i < N; i += 7) { gx += tgt[i * 3]; gy += tgt[i * 3 + 1]; gz += tgt[i * 3 + 2]; }
    const gk = 7 / N;
    gx = gx * gk + Math.sin(now * 0.9) * 6; gy = gy * gk + Math.cos(now * 0.7) * 2; gz = gz * gk + Math.sin(now * 0.5) * 4;

    // the pointer scatters the swarm, except on the fleet where it inspects squadrons
    const ptrOn = now - pointer.t < 1.4 && now > introEnd && cues[cueI].kind !== 'fleet';
    if (ptrOn) {
      tmp.set((pointer.x / innerWidth) * 2 - 1, -(pointer.y / innerHeight) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
      const t = -camera.position.z / tmp.z;
      P.copy(camera.position).addScaledVector(tmp, t);
    }
    const pr = L.mobile ? 2.6 : 3.4;
    const colK = Math.min(1, dt * 2.5);

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
      const w = smooth((now - flocking - delay[i]) / RAMP);
      // formation: critically damped spring toward the target (+ a gentle hover)
      if (w > 0) {
        const om = omega[i] * (opening ? 0.8 : 1);
        const ty = tgt[i3 + 1] + Math.sin(now * 1.3 + phase[i]) * 0.02;
        const k = om * om * w, c = 2 * om * w;
        ax += (tgt[i3] - px) * k - vx * c;
        ay += (ty - py) * k - vy * c;
        az += (tgt[i3 + 2] - pz) * k - vz * c;
      }
      // boids while not in formation
      const f = 1 - w;
      if (f > 0.01) {
        if (sinceLaunch < 0.7) ay += 26 * f; // climb off the pad
        let sx = 0, sy = 0, sz = 0, axv = 0, ayv = 0, azv = 0, cx = 0, cy = 0, cz = 0, cnt = 0;
        const ix = Math.floor(px / CELL), iy = Math.floor(py / CELL), iz = Math.floor(pz / CELL);
        outer: for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
          for (let j = head[hash(ix + a, iy + b, iz + d)]; j !== -1; j = next[j]) {
            if (j === i) continue;
            const dx = px - pos[j * 3], dy = py - pos[j * 3 + 1], dz = pz - pos[j * 3 + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > CELL * CELL || d2 < 1e-6) continue;
            if (d2 < 0.36) { sx += dx / d2; sy += dy / d2; sz += dz / d2; }
            axv += vel[j * 3]; ayv += vel[j * 3 + 1]; azv += vel[j * 3 + 2];
            cx += pos[j * 3]; cy += pos[j * 3 + 1]; cz += pos[j * 3 + 2];
            if (++cnt >= 10) break outer;
          }
        }
        let bx = (gx - px) * 0.35, by = (gy - py) * 0.35, bz = (gz - pz) * 0.35;
        if (cnt) {
          bx += (axv / cnt - vx) * 1.6 + (cx / cnt - px) * 1.1 + sx * 1.1;
          by += (ayv / cnt - vy) * 1.6 + (cy / cnt - py) * 1.1 + sy * 1.1;
          bz += (azv / cnt - vz) * 1.6 + (cz / cnt - pz) * 1.1 + sz * 1.1;
        }
        // keep cruising speed
        const sp = Math.hypot(vx, vy, vz) + 1e-5;
        const cruise = (10 - sp) * 0.9;
        bx += (vx / sp) * cruise; by += (vy / sp) * cruise; bz += (vz / sp) * cruise;
        if (py < 1.2) by += (1.2 - py) * 6;
        ax += bx * f; ay += by * f; az += bz * f;
      }
      if (ptrOn) {
        const dx = px - P.x, dy = py - P.y, d = Math.hypot(dx, dy) + 1e-4;
        if (d < pr) { const s = (1 - d / pr); const k = s * s * 160 / d; ax += dx * k; ay += dy * k; az -= s * 20; }
      }
      // clamp acceleration, integrate
      const am = Math.hypot(ax, ay, az), AM = 90;
      if (am > AM) { ax *= AM / am; ay *= AM / am; az *= AM / am; }
      vx += ax * dt; vy += ay * dt; vz += az * dt;
      const sp = Math.hypot(vx, vy, vz), VM = 34;
      if (sp > VM) { vx *= VM / sp; vy *= VM / sp; vz *= VM / sp; }
      pos[i3] = px + vx * dt; pos[i3 + 1] = Math.max(0.05, py + vy * dt); pos[i3 + 2] = pz + vz * dt;
      vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
      const ck = colK * (0.35 + 0.65 * w);
      col[i3] += (colT[i3] - col[i3]) * ck; col[i3 + 1] += (colT[i3 + 1] - col[i3 + 1]) * ck; col[i3 + 2] += (colT[i3 + 2] - col[i3 + 2]) * ck;
      lum[i] += (lumT[i] - lum[i]) * ck;
    }
  }

  function frame() {
    const now = clock();
    let dt = Math.min(0.5, Math.max(1 / 240, now - last));
    last = now;
    glowU.uTime.value = now;

    // hero alternates name and hook
    if (cues[cueI].alt && now > formedAt + (alt ? HOLD : HOLD + 1.8) && now > introEnd) { alt = !alt; retarget(true); }

    for (let left = dt; left > 1e-4; left -= 1 / 15) step(Math.min(left, 1 / 15), now);
    dt = Math.min(dt, 1 / 15);

    // camera: intro flight, then a slow drift that shows the depth
    const k = macro ? 0 : opening ? easeInOut(Math.min(1, Math.max(0, (now - 1.15) / (introEnd - 1.3)))) : 1;
    if (opening && k >= 1) opening = 0;
    const drift = Math.sin(now * 0.11) * 0.9 + pointer.nx * 1.4;
    const lift = (1 - k) * (L.mobile ? 0.22 : 0.1) * L.h;
    if (lift > 0.5) camera.setViewOffset(L.w, L.h, 0, lift, L.w, L.h); else if (camera.view && camera.view.enabled) camera.clearViewOffset();
    camera.position.lerpVectors(startPos, showPos, k);
    camera.position.x += drift * k;
    camera.position.y += (Math.sin(now * 0.07) * 0.25 - pointer.ny * 0.6) * k;
    tmp.lerpVectors(startLook, showLook, k);
    camera.lookAt(tmp);
    camera.updateMatrixWorld();
    const show = unitsPerPx * L.spacing * (L.mobile ? 2.35 : 2.7);
    glowU.uBase.value = 0.045 + (show - 0.045) * k;
    if (drones) {
      // close-up intro: only the front rows are near enough to need geometry
      drones.geometry.instanceCount = Math.min(N, cols * 12);
      drones.visible = k < 0.6;
      droneU.uMoon.value.set(-0.45, 0.8, 0.4).normalize().transformDirection(camera.matrixWorldInverse);
      droneU.uDown.value.set(0, -1, 0).transformDirection(camera.matrixWorldInverse);
      droneU.uScale.value = DRONE * (1 + k * 0.4);
    }
    aPos.needsUpdate = true; aCol.needsUpdate = true; aLum.needsUpdate = true;
    if (drones && drones.visible) aVel.needsUpdate = true;
    renderer.render(scene, camera);

    // adapt: drop to 1x pixels if a phone struggles after the intro
    if (!opening && dpr > 1 && frames < 240) {
      frames++;
      if (dt > 1 / 40) slow++;
      if (frames === 240 && slow > 120) { dpr = 1; renderer.setPixelRatio(1); resize(); }
    }
    requestAnimationFrame(frame);
  }

  resize();
  addEventListener('resize', resize);
  retarget(true);
  cueStart = 2.4; // first formation assembles after the takeoff climb
  if (params.has('still')) { cueStart = -10; for (let i = 0; i < N; i++) { launch[i] = -10; pos.set([tgt[i * 3], tgt[i * 3 + 1], tgt[i * 3 + 2]], i * 3); col.set(colT.subarray(i * 3, i * 3 + 3), i * 3); lum[i] = lumT[i]; } }
  formedAt = cueStart + FLOCK + RAMP + 0.6;
  requestAnimationFrame(frame);

  return {
    setCue(i) {
      if (i === cueI) return;
      cueI = i; alt = false; highlight = null;
      if (opening) { introEnd = Math.max(clock() + 0.9, 1.6); }
      retarget(true);
    },
    highlight(repoId) {
      if (repoId === highlight) return;
      highlight = repoId;
      toWorld(formation(cues[cueI], fleet, L, alt));
    },
  };
}
