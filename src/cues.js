// Show program + formation generator, shared by the WebGL swarm and the 2D fallback.
// Every drone is one commit (story.timeline.days), ordered by date; its colour is its chapter's.
// Formations are produced in screen space (CSS px) plus a depth offset (world units), so both
// renderers agree. Chapter, fleet and finale formations also carry an `anim` that moves or pulses
// their drones over time; the drones themselves never change (always exactly one per commit).

const WARM = [1.0, 0.91, 0.76];
const TAU = Math.PI * 2;
const GOLDEN = 2.39996323;

export function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x8a93a6;
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** One drone per commit, chronological. */
export function buildFleet(story) {
  const chapters = [...story.chapters].sort((a, b) => a.index - b.index);
  const chapIdx = new Map(chapters.map((c, i) => [c.id, i]));
  const repoById = new Map(story.repos.map((r) => [r.id, r]));
  const days = [...story.timeline.days].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = days.reduce((s, d) => s + d[2], 0);
  const day = new Float32Array(n), repo = new Int16Array(n), chap = new Int8Array(n);
  let i = 0;
  for (const [d, r, c] of days) {
    const ci = chapIdx.get(repoById.get(r)?.chapter) ?? 0;
    for (let k = 0; k < c; k++, i++) { day[i] = d; repo[i] = r; chap[i] = ci; }
  }
  const t0 = Date.parse(story.timeline.start + 'T00:00:00Z');
  const span = Math.max(1, (Date.parse(story.timeline.end + 'T00:00:00Z') - t0) / 864e5);
  // squadrons = systems (repos), ordered by first commit
  const first = new Map();
  for (let k = 0; k < n; k++) if (!first.has(repo[k])) first.set(repo[k], k);
  const squads = [...first.keys()].map((r) => ({ repo: repoById.get(r), start: first.get(r), count: 0, chap: chapIdx.get(repoById.get(r)?.chapter) ?? 0 }));
  const sIdx = new Map(squads.map((s, k) => [s.repo.id, k]));
  for (let k = 0; k < n; k++) squads[sIdx.get(repo[k])].count++;
  return { n, day, repo, chap, span, chapters, squads, sIdx, clusters: [], colors: chapters.map((c) => hexRgb(c.color)) };
}

/** The running order of the show. Text comes from story.json only. */
export function buildCues(story) {
  const hook = String(story.person.hook);
  const [hookA, hookB] = hook.split(/\s+—\s+/);
  const lead = story.headline?.[0];
  const merged = (hookB || (lead ? `${lead.value} ${lead.label}` : '')).replace(/\.$/, '');
  const ctaLast = String(story.cta.line).split(/(?<=[?.!])\s+/).pop().replace(/[.!]$/, '');
  const chapters = story.chapters.slice().sort((a, b) => a.index - b.index);
  const cues = [
    { id: 'hero', label: 'Name', kind: 'text', text: story.person.name.toUpperCase(), alt: hookB ? hookA : null, tone: 'warm' },
    { id: 'merged', label: 'Merged', kind: 'text', text: merged, tone: 'warm' },
    { id: 'record', label: 'Record', kind: 'skyline' },
  ];
  chapters.forEach((c, i) => {
    cues.push({ id: c.id, label: c.title, kind: 'chapter', chapter: i, color: c.color, finale: i === chapters.length - 1 });
  });
  cues.push({ id: 'fleet', label: 'Fleet', kind: 'fleet' });
  cues.push({ id: 'cta', label: 'Code', kind: 'text', text: ctaLast, tone: 'chrono', lines: 2 });
  return cues;
}

export function layout(w, h) {
  const mobile = w < 760;
  const hz = mobile ? 0.585 : 0.76;
  const pad = mobile ? 16 : Math.round(w * 0.05);
  const top = mobile ? h * 0.095 : h * 0.11;
  const wide = mobile
    ? { x: pad, y: top, w: w - pad * 2, h: h * 0.34 }
    : { x: pad, y: top, w: w - pad * 2, h: h * 0.41 };
  const side = mobile
    ? { x: pad, y: top, w: w - pad * 2, h: h * 0.32 }
    : { x: w * 0.44, y: top, w: w * 0.52, h: h * 0.49 };
  const sky = { x: mobile ? pad : w * 0.03, y: h * hz, w: mobile ? w - pad * 2 : w * 0.94, h: h * (mobile ? 0.12 : 0.2) };
  // on phones the panels fade out above this line so the formation keeps the top of the screen
  const stage = mobile ? Math.round(side.y + side.h + h * 0.02) : 0;
  return { w, h, mobile, hz, wide, side, sky, stage, spacing: mobile ? 2.3 : 4, upp: 0 };
}

// ---------- masks ----------

let maskCanvas;
function ctx2d(w, h) {
  maskCanvas = maskCanvas || document.createElement('canvas');
  maskCanvas.width = Math.max(1, Math.ceil(w));
  maskCanvas.height = Math.max(1, Math.ceil(h));
  const g = maskCanvas.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.globalCompositeOperation = 'source-over';
  return g;
}

function setFont(g, px) {
  g.font = `900 ${px}px Archivo, "Arial Black", sans-serif`;
  if ('fontStretch' in g) g.fontStretch = 'expanded';
}

/** Greedy wrap into k lines; choose the k that gives the largest type. */
function fitText(g, text, w, h, maxLines = 5) {
  const words = text.split(/\s+/).filter(Boolean);
  setFont(g, 100);
  const width = (s) => g.measureText(s).width;
  let best = null;
  for (let k = 1; k <= Math.min(maxLines, words.length); k++) {
    const target = width(text) / k;
    const lines = [];
    let cur = '';
    for (const wd of words) {
      const next = cur ? cur + ' ' + wd : wd;
      if (cur && width(next) > target * 1.08 && lines.length < k - 1) { lines.push(cur); cur = wd; } else cur = next;
    }
    lines.push(cur);
    const maxW = Math.max(...lines.map(width));
    const size = Math.min((w * 0.96 / maxW) * 100, h / (lines.length * 1.08));
    if (!best || size > best.size * 1.04) best = { lines, size };
  }
  return best || { lines: [text], size: 10 };
}

function textMask(text, rect, maxLines) {
  const g = ctx2d(rect.w, rect.h);
  const { lines, size } = fitText(g, text, rect.w, rect.h, maxLines);
  setFont(g, size);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lh = size * 1.08;
  const top = rect.h / 2 - (lines.length - 1) * lh / 2;
  lines.forEach((l, i) => g.fillText(l, rect.w / 2, top + i * lh));
  return g;
}

const ICONS = {
  // blocks on a chain
  'carbon-ledger'(g, s) {
    g.lineWidth = s * 0.07;
    const b = s * 0.24;
    for (let i = -1; i <= 1; i++) {
      const cx = i * s * 0.36, cy = i * -s * 0.02;
      g.strokeRect(cx - b / 2, cy - b / 2, b, b);
      if (i < 1) { g.beginPath(); g.moveTo(cx + b / 2, cy); g.lineTo(cx + s * 0.36 - b / 2, cy - s * 0.02); g.stroke(); }
    }
  },
  // crescent and stars
  'night-builds'(g, s) {
    g.beginPath(); g.arc(-s * 0.08, 0, s * 0.36, 0, TAU); g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.arc(s * 0.08, -s * 0.1, s * 0.31, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';
    for (const [x, y, r] of NIGHT_STARS) { g.beginPath(); g.arc(x * s, y * s, r * s, 0, TAU); g.fill(); }
  },
  // voice waveform
  'voice-memory'(g, s) {
    const bars = 17;
    for (let i = 0; i < bars; i++) {
      const t = i / (bars - 1) * 2 - 1;
      const hgt = s * (0.08 + 0.62 * Math.exp(-t * t * 2.2) * (0.6 + 0.4 * Math.abs(Math.sin(i * 1.7))));
      const x = t * s * 0.5;
      g.lineWidth = s * 0.034;
      g.beginPath(); g.moveTo(x, -hgt / 2); g.lineTo(x, hgt / 2); g.stroke();
    }
  },
  // an eye
  'vision-inventory'(g, s) {
    g.lineWidth = s * 0.05;
    g.beginPath();
    g.moveTo(-s * 0.5, 0);
    g.quadraticCurveTo(0, -s * 0.46, s * 0.5, 0);
    g.quadraticCurveTo(0, s * 0.46, -s * 0.5, 0);
    g.stroke();
    g.beginPath(); g.arc(0, 0, s * 0.17, 0, TAU); g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.arc(0, 0, s * 0.065, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';
  },
  // a cloud
  'aws-rebuild'(g, s) {
    g.lineWidth = s * 0.06;
    g.beginPath();
    g.moveTo(-s * 0.36, s * 0.16);
    g.arc(-s * 0.3, s * 0.02, s * 0.14, Math.PI * 0.6, Math.PI * 1.5);
    g.arc(-s * 0.08, -s * 0.1, s * 0.2, Math.PI * 1.1, Math.PI * 1.85);
    g.arc(s * 0.2, -s * 0.02, s * 0.16, Math.PI * 1.35, Math.PI * 0.1);
    g.arc(s * 0.3, s * 0.08, s * 0.09, Math.PI * 1.6, Math.PI * 0.5);
    g.closePath();
    g.stroke();
  },
  // a source listening: dot + arcs
  'listening-agents'(g, s) {
    g.beginPath(); g.arc(-s * 0.3, 0, s * 0.07, 0, TAU); g.fill();
    g.lineWidth = s * 0.045;
    for (let i = 1; i <= 3; i++) {
      g.beginPath(); g.arc(-s * 0.3, 0, s * (0.07 + i * 0.16), -Math.PI * 0.32, Math.PI * 0.32); g.stroke();
    }
  },
  // hub with agent teams
  'agent-os'(g, s) {
    g.lineWidth = s * 0.03;
    g.beginPath(); g.arc(0, 0, s * 0.12, 0, TAU); g.stroke();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU - Math.PI / 2;
      const x = Math.cos(a) * s * 0.38, y = Math.sin(a) * s * 0.38;
      g.beginPath(); g.moveTo(Math.cos(a) * s * 0.14, Math.sin(a) * s * 0.14); g.lineTo(Math.cos(a) * s * 0.3, Math.sin(a) * s * 0.3); g.stroke();
      g.beginPath(); g.arc(x, y, s * 0.06, 0, TAU); g.fill();
    }
  },
};
const NIGHT_STARS = [[0.32, -0.28, 0.035], [0.42, 0.02, 0.025], [0.24, 0.24, 0.03]];

// Motion per icon: (x, y) relative to the icon centre in units of its size, t in seconds.
// Writes the displaced point to o and returns a brightness factor. Positions stay on the icon.
const pulse = (d, w) => Math.exp(-(d * w) * (d * w));
const MOTION = {
  // a block is sealed, then the next: a light pulse runs along the chain
  'carbon-ledger'(x, y, t, o) {
    o.x = x; o.y = y;
    const p = ((t * 0.32) % 1.5) - 0.75;
    return 0.5 + 0.8 * pulse(x - p, 6);
  },
  // stars twinkle, the crescent rocks a little
  'night-builds'(x, y, t, o) {
    const a = Math.sin(t * 0.55) * 0.07, c = Math.cos(a), s = Math.sin(a);
    o.x = x * c - y * s; o.y = x * s + y * c;
    for (let j = 0; j < 3; j++) {
      const [sx, sy] = NIGHT_STARS[j];
      if ((x - sx) * (x - sx) + (y - sy) * (y - sy) < 0.0049) return 0.25 + 1.0 * Math.max(0, Math.sin(t * 2.7 + j * 2.1));
    }
    return 0.8 + 0.25 * Math.sin(t * 1.3 - y * 7);
  },
  // the waveform talks: bar heights follow a moving level
  'voice-memory'(x, y, t, o) {
    const b = Math.round((x * 2 + 1) * 8);
    const a = Math.abs(Math.sin(t * 2.3 + b * 0.8) * Math.sin(t * 1.45 + b * 0.37 + 1));
    o.x = x; o.y = y * (0.5 + 0.8 * a);
    return 0.65 + 0.5 * a;
  },
  // the eye looks around, blinks, and a scan line sweeps it
  'vision-inventory'(x, y, t, o) {
    const ph = t % 5.5, blink = ph > 5.15 ? Math.sin((ph - 5.15) / 0.35 * Math.PI) : 0;
    const iris = x * x + y * y < 0.04;
    o.x = iris ? x + Math.sin(t * 0.7) * 0.075 : x;
    o.y = y * (1 - blink * 0.9);
    const scan = ((t * 0.42) % 1.4) - 0.7;
    return 0.68 + 0.7 * pulse(y - scan, 12);
  },
  // the cloud drifts; uploads rise through it
  'aws-rebuild'(x, y, t, o) {
    o.x = x + Math.sin(t * 0.5) * 0.015;
    o.y = y + Math.sin(t * 0.9 + x * 3) * 0.012;
    const p = 0.32 - ((t * 0.38) % 1.25);
    return 0.55 + 0.75 * pulse(y - p, 7);
  },
  // waves radiate from the source
  'listening-agents'(x, y, t, o) {
    o.x = x; o.y = y;
    const d = Math.hypot(x + 0.3, y);
    if (d < 0.09) return 0.75 + 0.45 * Math.sin(t * 5);
    const w = (t * 0.5) % 1;
    return 0.42 + 0.85 * pulse(d - w * 0.85, 9);
  },
  'agent-os'(x, y, t, o) {
    const a = t * 0.2, c = Math.cos(a), s = Math.sin(a);
    o.x = x * c - y * s; o.y = x * s + y * c;
    return 1;
  },
  default(x, y, t, o) {
    const k = 1 + 0.02 * Math.sin(t * 0.9);
    o.x = x * k; o.y = y * k;
    return 0.85 + 0.2 * Math.sin(t * 1.3 + x * 4);
  },
};

const fillCache = new Map();
/** Fraction of an s×s square the icon covers (measured once at a reference size). */
function iconFill(id) {
  if (fillCache.has(id)) return fillCache.get(id);
  const S = 160, P = 200;
  const g = ctx2d(P, P);
  g.translate(P / 2, P / 2);
  (ICONS[id] || ICONS['agent-os'])(g, S);
  g.setTransform(1, 0, 0, 1, 0, 0);
  const a = g.getImageData(0, 0, P, P).data;
  let c = 0;
  for (let i = 3; i < a.length; i += 4) if (a[i] > 127) c++;
  const f = Math.max(0.02, c / (S * S));
  fillCache.set(id, f);
  return f;
}

function iconMask(id, rect, s) {
  const g = ctx2d(rect.w, rect.h);
  g.save();
  g.translate(rect.w / 2, rect.h / 2);
  (ICONS[id] || ICONS['agent-os'])(g, s);
  g.restore();
  return g;
}

/** n points spread evenly over the mask, returned in reading order (top-left first). */
function sample(g, n, seed) {
  const W = g.canvas.width, H = g.canvas.height;
  const a = g.getImageData(0, 0, W, H).data;
  let area = 0;
  for (let i = 3; i < a.length; i += 4) if (a[i] > 127) area++;
  if (!area || !n) return new Float32Array(n * 2);
  const r = rng(seed);
  let s = Math.max(0.6, Math.sqrt(area / n));
  let pts = [];
  for (let tries = 0; tries < 8; tries++) {
    pts = [];
    for (let y = s / 2; y < H; y += s) {
      const row = Math.floor(y / s);
      for (let x = (row & 1 ? s / 2 : s / 4); x < W; x += s) {
        if (a[((y | 0) * W + (x | 0)) * 4 + 3] > 127) pts.push(x, y);
      }
    }
    if (pts.length / 2 >= n) break;
    s *= 0.9;
  }
  // thin to exactly n (keep spread), or pad by re-using points with jitter
  const m = pts.length / 2;
  const out = new Float32Array(n * 2);
  if (m >= n) {
    const keep = new Uint8Array(m);
    let drop = m - n;
    const step = m / Math.max(1, drop);
    for (let k = 0; k < drop; k++) keep[Math.min(m - 1, Math.floor(k * step + r() * step))] = 1;
    let j = 0;
    for (let k = 0; k < m && j < n; k++) if (!keep[k]) { out[j * 2] = pts[k * 2]; out[j * 2 + 1] = pts[k * 2 + 1]; j++; }
    for (; j < n; j++) { out[j * 2] = pts[0]; out[j * 2 + 1] = pts[1]; }
  } else {
    for (let j = 0; j < n; j++) {
      const k = j % Math.max(1, m);
      out[j * 2] = (pts[k * 2] || W / 2) + (r() - 0.5) * s * 0.5;
      out[j * 2 + 1] = (pts[k * 2 + 1] || H / 2) + (r() - 0.5) * s * 0.5;
    }
  }
  return out;
}

/** Skyline: every commit stacked by week, sitting on the water line. */
function skyline(fleet, L, out, ids) {
  const weeks = Math.ceil((fleet.span + 1) / 7);
  const R = L.sky;
  const colW = R.w / weeks;
  const kx = Math.max(1, Math.floor(colW / L.spacing));
  const kz = L.mobile ? 8 : 4;
  const sx = colW / kx;
  const fill = new Int32Array(weeks);
  for (const i of ids) {
    const wk = Math.min(weeks - 1, Math.floor(fleet.day[i] / 7));
    const k = fill[wk]++;
    const layer = Math.floor(k / (kx * kz));
    const inLayer = k % (kx * kz);
    out[i * 3] = R.x + wk * colW + (inLayer % kx + 0.5) * sx;
    out[i * 3 + 1] = R.y - 2 - layer * L.spacing * 0.9;
    out[i * 3 + 2] = -Math.floor(inLayer / kx) * 0.35;
  }
}

function makeAnim(ids, update) {
  const m = ids.length;
  const a = { ids: Int32Array.from(ids), xyz: new Float32Array(m * 3), lum: new Float32Array(m), update(t) { update(t, a.xyz, a.lum); } };
  return a;
}

/**
 * Finale: the agent platform as an orrery. A control-plane ring at the hub, spokes carrying
 * pulses outward, and six agent teams orbiting it, each spinning. Exactly ids.length drones.
 */
function finale(ids, rect, L, boost) {
  const n = ids.length, K = 6;
  const sp = L.mobile ? 8.5 : 13.5;
  let nh = Math.max(6, Math.round(n * 0.22));
  const ns = Math.max(1, Math.floor((n * 0.3) / K));
  const nw = Math.max(1, Math.floor((n - nh - ns * K) / K));
  nh = Math.max(0, n - ns * K - nw * K); // leftovers join the hub ring
  const rh = Math.max(sp * 1.5, (nh * sp) / TAU);
  const rw = Math.max(sp * 0.9, ((nw - 1) * sp) / TAU);
  const spoke = ns * sp * 1.15;
  const ro = rh + sp + spoke + sp * 0.6 + rw;
  const tilt = 0.62, ct = Math.cos(tilt), st = Math.sin(tilt);
  const fit = Math.min(1.25, (rect.w * 0.5 - sp) / (ro + rw), (rect.h * 0.5 - sp) / ((ro + rw) * ct));
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const upp = L.upp || 0;
  const put = (xyz, k, a, b) => { xyz[k * 3] = cx + a * fit; xyz[k * 3 + 1] = cy + b * fit * ct; xyz[k * 3 + 2] = b * fit * st * upp; };
  return makeAnim(ids, (t, xyz, lum) => {
    let k = 0;
    const wh = t * 0.35, wo = t * 0.16, ww = t * 1.25;
    for (let j = 0; j < nh; j++, k++) {
      const a = (j / nh) * TAU + wh;
      put(xyz, k, Math.cos(a) * rh, Math.sin(a) * rh);
      lum[k] = boost * (0.8 + 0.3 * Math.sin(a * 3 - t * 2));
    }
    for (let s = 0; s < K; s++) {
      const th = (s / K) * TAU + wo - Math.PI / 2;
      const c = Math.cos(th), si = Math.sin(th);
      const ph = (t * 0.55 + s * 0.37) % 1;
      for (let j = 0; j < ns; j++, k++) {
        const u = (j + 0.5) / ns, d = rh + sp + u * spoke;
        put(xyz, k, c * d, si * d);
        lum[k] = boost * (0.3 + 1.0 * pulse(u - ph, 5));
      }
      const ax = c * ro, ay = si * ro;
      const arrive = Math.max(0, 1 - Math.abs(ph - 0.98) * 7);
      for (let j = 0; j < nw; j++, k++) {
        if (j === 0) { put(xyz, k, ax, ay); lum[k] = boost * (1 + 0.8 * arrive); continue; }
        const b = ((j - 1) / Math.max(1, nw - 1)) * TAU + ww * (s & 1 ? -1 : 1) + s;
        put(xyz, k, ax + Math.cos(b) * rw, ay + Math.sin(b) * rw);
        lum[k] = boost * (0.7 + 0.25 * Math.sin(b * 2 + t) + 0.5 * arrive);
      }
    }
  });
}

/** Front-chain style circle packing: each circle goes tangent to two placed ones, nearest the origin. */
function pack(circles, aspect, gap) {
  const placed = [];
  const score = (x, y) => (x / aspect) * (x / aspect) + y * y;
  const free = (x, y, r) => placed.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 >= (p.r + r + gap) ** 2 - 1e-6);
  for (const c of circles) {
    if (!placed.length) { c.x = 0; c.y = 0; placed.push(c); continue; }
    let best = null, bs = Infinity;
    const r = c.r;
    for (let i = 0; i < placed.length; i++) {
      const A = placed[i];
      // tangent to A alone, on the four sides (seeds the second circle)
      if (placed.length === 1) {
        for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = A.x + ux * (A.r + r + gap), y = A.y + uy * (A.r + r + gap);
          const s = score(x, y);
          if (s < bs && free(x, y, r)) { bs = s; best = [x, y]; }
        }
      }
      for (let j = i + 1; j < placed.length; j++) {
        const B = placed[j];
        const da = A.r + r + gap, db = B.r + r + gap;
        const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
        if (d > da + db || d < Math.abs(da - db) || d < 1e-9) continue;
        const a = (da * da - db * db + d * d) / (2 * d);
        const h = Math.sqrt(Math.max(0, da * da - a * a));
        const px = A.x + (a * dx) / d, py = A.y + (a * dy) / d;
        for (const sg of [1, -1]) {
          const x = px - (sg * h * dy) / d, y = py + (sg * h * dx) / d;
          const s = score(x, y);
          if (s < bs && free(x, y, r)) { bs = s; best = [x, y]; }
        }
      }
    }
    if (!best) { // fallback: park it on the far right
      const R = Math.max(...placed.map((p) => Math.abs(p.x) + p.r));
      best = [R + r + gap, 0];
    }
    c.x = best[0]; c.y = best[1];
    placed.push(c);
  }
}

/** Squadrons packed into chapter clusters; sets squad cx, cy, r (CSS px) for hit-testing. */
function packFleet(fleet, R, target) {
  const groups = new Map();
  for (const sq of fleet.squads) {
    sq.pr = Math.max(target * 0.6, target * Math.sqrt((sq.count * 1.12) / Math.PI));
    if (!groups.has(sq.chap)) groups.set(sq.chap, []);
    groups.get(sq.chap).push(sq);
  }
  const aspect = Math.max(0.6, Math.min(2.2, R.w / R.h));
  const gap = target * 0.9;
  const clusters = [];
  for (const [chap, list] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const cs = list.slice().sort((a, b) => b.pr - a.pr).map((sq) => ({ r: sq.pr, sq }));
    pack(cs, aspect, gap);
    // centre the cluster on its area-weighted centroid
    let wx = 0, wy = 0, ws = 0;
    for (const c of cs) { const w = c.r * c.r; wx += c.x * w; wy += c.y * w; ws += w; }
    wx /= ws; wy /= ws;
    let rad = 0;
    for (const c of cs) { c.x -= wx; c.y -= wy; rad = Math.max(rad, Math.hypot(c.x, c.y) + c.r); }
    clusters.push({ chap, r: rad, members: cs });
  }
  const order = clusters.slice().sort((a, b) => b.r - a.r);
  pack(order, aspect, target * 3.2);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const cl of clusters) for (const c of cl.members) {
    x0 = Math.min(x0, cl.x + c.x - c.r); x1 = Math.max(x1, cl.x + c.x + c.r);
    y0 = Math.min(y0, cl.y + c.y - c.r); y1 = Math.max(y1, cl.y + c.y + c.r);
  }
  const k = Math.min(1.2, R.w / (x1 - x0), R.h / (y1 - y0));
  const ox = R.x + R.w / 2 - ((x0 + x1) / 2) * k, oy = R.y + R.h / 2 - ((y0 + y1) / 2) * k;
  for (const cl of clusters) {
    for (const c of cl.members) { c.sq.cx = ox + (cl.x + c.x) * k; c.sq.cy = oy + (cl.y + c.y) * k; c.sq.r = c.r * k; }
    cl.cx = ox + cl.x * k; cl.cy = oy + cl.y * k; cl.rr = cl.r * k;
  }
  fleet.clusters = clusters.map((cl) => ({ chap: cl.chap, cx: cl.cx, cy: cl.cy, r: cl.rr }));
  return k;
}

/**
 * Formation for cue c: per-drone screen position + depth (pos, length n*3),
 * colour (col, n*3), brightness (lum, n; above 1 = boosted glow) and an optional anim.
 */
export function formation(c, fleet, L, alt = false) {
  const n = fleet.n;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), lum = new Float32Array(n);
  const all = Array.from({ length: n }, (_, i) => i);
  const paint = (i, rgb, l) => { col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2]; lum[i] = l; };
  const place = (ids, pts, rect) => ids.forEach((i, k) => {
    pos[i * 3] = rect.x + pts[k * 2]; pos[i * 3 + 1] = rect.y + pts[k * 2 + 1]; pos[i * 3 + 2] = 0;
  });
  // writes an anim's t=0 state into the static arrays (the 2D fallback draws exactly that)
  const settle = (a) => {
    a.update(0);
    a.ids.forEach((i, k) => { pos[i * 3] = a.xyz[k * 3]; pos[i * 3 + 1] = a.xyz[k * 3 + 1]; pos[i * 3 + 2] = a.xyz[k * 3 + 2]; lum[i] = a.lum[k]; });
  };
  let anim = null;

  if (c.kind === 'text') {
    const rect = c.id === 'hero' ? L.wide : L.side;
    const pts = sample(textMask(alt && c.alt ? c.alt : c.text, rect, L.mobile && c.lines ? c.lines : 5), n, 7);
    place(all, pts, rect);
    const chrono = alt || c.tone === 'chrono';
    for (const i of all) {
      if (chrono) paint(i, fleet.colors[fleet.chap[i]], 1);
      else { const v = 0.94 + 0.06 * Math.sin(i * 12.9898); paint(i, [WARM[0] * v, WARM[1] * v, WARM[2] * v], 1); }
    }
  } else if (c.kind === 'skyline') {
    skyline(fleet, L, pos, all);
    for (const i of all) paint(i, fleet.colors[fleet.chap[i]], 0.85);
  } else if (c.kind === 'chapter') {
    const lit = [], rest = [];
    for (const i of all) (fleet.chap[i] === c.chapter ? lit : rest).push(i);
    skyline(fleet, L, pos, rest);
    for (const i of rest) paint(i, fleet.colors[fleet.chap[i]], 0.22);
    const rgb = fleet.colors[c.chapter];
    // small chapters fly tighter and brighter: constant spacing between drones, boosted glow
    const boost = Math.max(1, Math.min(1.5, 1 + 0.5 * (1 - lit.length / 650)));
    for (const i of lit) paint(i, rgb, boost);
    const rect = L.side;
    if (c.finale) {
      anim = finale(lit, rect, L, boost);
    } else if (lit.length) {
      const target = L.mobile ? 4.8 : 6.8;
      const sMax = Math.min(rect.w, rect.h * 1.25);
      const s = Math.max(sMax * 0.56, Math.min(sMax, target * Math.sqrt(lit.length / iconFill(c.id))));
      const pts = sample(iconMask(c.id, rect, s), lit.length, 11 + c.chapter);
      const m = lit.length, bx = new Float32Array(m), by = new Float32Array(m);
      const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
      for (let k = 0; k < m; k++) { bx[k] = (rect.x + pts[k * 2] - cx) / s; by[k] = (rect.y + pts[k * 2 + 1] - cy) / s; }
      const motion = MOTION[c.id] || MOTION.default;
      const o = { x: 0, y: 0 };
      anim = makeAnim(lit, (t, xyz, lm) => {
        for (let k = 0; k < m; k++) {
          const l = motion(bx[k], by[k], t, o);
          xyz[k * 3] = cx + o.x * s; xyz[k * 3 + 1] = cy + o.y * s; xyz[k * 3 + 2] = 0;
          lm[k] = boost * l;
        }
      });
    }
    if (anim) settle(anim);
  } else if (c.kind === 'fleet') {
    const R = L.mobile ? { ...L.side, h: L.h * 0.36 } : { x: L.side.x, y: L.side.y - L.h * 0.02, w: L.side.w, h: L.side.h + L.h * 0.08 };
    const target = L.mobile ? 4.3 : 6.4;
    const k = packFleet(fleet, R, target);
    const m = fleet.squads.length;
    const seen = new Int32Array(m);
    const sqOf = new Int32Array(n), slot = new Int32Array(n);
    for (const i of all) { const q = fleet.sIdx.get(fleet.repo[i]); sqOf[i] = q; slot[i] = seen[q]++; }
    const rr = new Float32Array(n), a0 = new Float32Array(n), om = new Float32Array(n);
    for (const i of all) {
      const sq = fleet.squads[sqOf[i]], j = slot[i];
      rr[i] = sq.count === 1 ? 0 : sq.r * Math.sqrt((j + 0.5) / sq.count);
      a0[i] = j * GOLDEN;
      // big squadrons turn slowly, inner drones faster: slow galaxies
      om[i] = ((sq.chap & 1 ? -1 : 1) * 0.55 / Math.sqrt(1 + sq.r / 10)) * (1.25 - 0.5 * (rr[i] / Math.max(1e-3, sq.r)));
      paint(i, fleet.colors[fleet.chap[i]], 0.95);
    }
    const lumBase = Math.min(1, 0.55 + 0.45 * k);
    anim = makeAnim(all, (t, xyz, lm) => {
      for (let i = 0; i < n; i++) {
        const sq = fleet.squads[sqOf[i]], a = a0[i] + om[i] * t;
        xyz[i * 3] = sq.cx + Math.cos(a) * rr[i]; xyz[i * 3 + 1] = sq.cy + Math.sin(a) * rr[i]; xyz[i * 3 + 2] = 0;
        lm[i] = lumBase;
      }
    });
    settle(anim);
  }
  return { pos, col, lum, anim };
}
