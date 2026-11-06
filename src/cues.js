// Show program + formation generator, shared by the WebGL swarm and the 2D fallback.
// Every drone is one commit (story.timeline.days), ordered by date; its colour is its chapter's.
// Formations are produced in screen space (CSS px) plus a depth offset, so both renderers agree.

const WARM = [1.0, 0.91, 0.76];

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
  const squads = [...first.keys()].map((r) => ({ repo: repoById.get(r), start: first.get(r), count: 0 }));
  const sIdx = new Map(squads.map((s, k) => [s.repo.id, k]));
  for (let k = 0; k < n; k++) squads[sIdx.get(repo[k])].count++;
  return { n, day, repo, chap, span, chapters, squads, sIdx, colors: chapters.map((c) => hexRgb(c.color)) };
}

/** The running order of the show. Text comes from story.json only. */
export function buildCues(story) {
  const [hookA, hookB] = String(story.person.hook).split(/\s+—\s+/);
  const ctaLast = String(story.cta.line).split(/(?<=[?.!])\s+/).pop().replace(/[.!]$/, '');
  const cues = [
    { id: 'hero', label: 'Name', kind: 'text', text: story.person.name.toUpperCase(), alt: hookA, tone: 'warm' },
    { id: 'merged', label: 'Merged', kind: 'text', text: (hookB || '').replace(/\.$/, ''), tone: 'warm' },
    { id: 'record', label: 'Record', kind: 'skyline' },
  ];
  story.chapters.slice().sort((a, b) => a.index - b.index).forEach((c, i) => {
    cues.push({ id: c.id, label: c.title, kind: 'chapter', chapter: i, color: c.color });
  });
  cues.push({ id: 'fleet', label: 'Fleet', kind: 'fleet' });
  cues.push({ id: 'cta', label: 'Code', kind: 'text', text: ctaLast, tone: 'chrono' });
  return cues;
}

export function layout(w, h) {
  const mobile = w < 760;
  const hz = mobile ? 0.585 : 0.76;
  const pad = mobile ? 14 : Math.round(w * 0.05);
  const wide = mobile
    ? { x: pad, y: h * 0.085, w: w - pad * 2, h: h * 0.35 }
    : { x: pad, y: h * 0.1, w: w - pad * 2, h: h * 0.42 };
  const side = mobile
    ? { x: pad, y: h * 0.085, w: w - pad * 2, h: h * 0.33 }
    : { x: w * 0.44, y: h * 0.1, w: w * 0.52, h: h * 0.5 };
  const sky = { x: mobile ? pad : w * 0.03, y: h * hz, w: mobile ? w - pad * 2 : w * 0.94, h: h * (mobile ? 0.12 : 0.2) };
  return { w, h, mobile, hz, wide, side, sky, spacing: mobile ? 2.3 : 4 };
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
  return g;
}

function setFont(g, px) {
  g.font = `900 ${px}px Archivo, "Arial Black", sans-serif`;
  if ('fontStretch' in g) g.fontStretch = 'expanded';
}

/** Greedy wrap into k lines; choose the k that gives the largest type. */
function fitText(g, text, w, h) {
  const words = text.split(/\s+/).filter(Boolean);
  setFont(g, 100);
  const width = (s) => g.measureText(s).width;
  let best = null;
  for (let k = 1; k <= Math.min(5, words.length); k++) {
    const target = width(text) / k;
    const lines = [];
    let cur = '';
    for (const wd of words) {
      const next = cur ? cur + ' ' + wd : wd;
      if (cur && width(next) > target * 1.08 && lines.length < k - 1) { lines.push(cur); cur = wd; } else cur = next;
    }
    lines.push(cur);
    const maxW = Math.max(...lines.map(width));
    const size = Math.min((w * 0.98 / maxW) * 100, h / (lines.length * 1.08));
    if (!best || size > best.size * 1.04) best = { lines, size };
  }
  return best;
}

function textMask(text, rect) {
  const g = ctx2d(rect.w, rect.h);
  const { lines, size } = fitText(g, text, rect.w, rect.h);
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
    g.beginPath(); g.arc(-s * 0.08, 0, s * 0.36, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.arc(s * 0.08, -s * 0.1, s * 0.31, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
    for (const [x, y, r] of [[0.32, -0.28, 0.035], [0.42, 0.02, 0.025], [0.24, 0.24, 0.03]]) {
      g.beginPath(); g.arc(x * s, y * s, r * s, 0, Math.PI * 2); g.fill();
    }
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
    g.beginPath(); g.arc(0, 0, s * 0.17, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.arc(0, 0, s * 0.065, 0, Math.PI * 2); g.fill();
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
    g.beginPath(); g.arc(-s * 0.3, 0, s * 0.07, 0, Math.PI * 2); g.fill();
    g.lineWidth = s * 0.045;
    for (let i = 1; i <= 3; i++) {
      g.beginPath(); g.arc(-s * 0.3, 0, s * (0.07 + i * 0.16), -Math.PI * 0.32, Math.PI * 0.32); g.stroke();
    }
  },
  // hub with agent teams
  'agent-os'(g, s) {
    g.lineWidth = s * 0.03;
    g.beginPath(); g.arc(0, 0, s * 0.12, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * s * 0.38, y = Math.sin(a) * s * 0.38;
      g.beginPath(); g.moveTo(Math.cos(a) * s * 0.14, Math.sin(a) * s * 0.14); g.lineTo(Math.cos(a) * s * 0.3, Math.sin(a) * s * 0.3); g.stroke();
      g.beginPath(); g.arc(x, y, s * 0.06, 0, Math.PI * 2); g.fill();
    }
  },
};

function iconMask(id, rect) {
  const g = ctx2d(rect.w, rect.h);
  const s = Math.min(rect.w, rect.h * 1.25);
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

/**
 * Formation for cue c: per-drone screen position + depth (pos, length n*3),
 * colour (col, n*3) and brightness (lum, n).
 */
export function formation(c, fleet, L, alt = false) {
  const n = fleet.n;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), lum = new Float32Array(n);
  const all = Array.from({ length: n }, (_, i) => i);
  const paint = (i, rgb, l) => { col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2]; lum[i] = l; };
  const place = (ids, pts, rect) => ids.forEach((i, k) => {
    pos[i * 3] = rect.x + pts[k * 2]; pos[i * 3 + 1] = rect.y + pts[k * 2 + 1]; pos[i * 3 + 2] = 0;
  });

  if (c.kind === 'text') {
    const rect = c.id === 'hero' ? L.wide : L.side;
    const pts = sample(textMask(alt && c.alt ? c.alt : c.text, rect), n, 7);
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
    const pts = sample(iconMask(c.id, L.side), lit.length, 11 + c.chapter);
    place(lit, pts, L.side);
    skyline(fleet, L, pos, rest);
    const rgb = fleet.colors[c.chapter];
    for (const i of lit) paint(i, rgb, 1);
    for (const i of rest) paint(i, fleet.colors[fleet.chap[i]], 0.24);
  } else if (c.kind === 'fleet') {
    const R = L.mobile ? { ...L.side, h: L.h * 0.45 } : L.side;
    const m = fleet.squads.length;
    const cols = L.mobile ? 7 : 14;
    const rows = Math.ceil(m / cols);
    const cw = R.w / cols, ch = R.h / rows;
    const cell = Math.min(cw, ch);
    const maxCount = Math.max(...fleet.squads.map((s) => s.count));
    fleet.squads.forEach((sq, k) => {
      const cx = R.x + (k % cols + 0.5) * cw, cy = R.y + (Math.floor(k / cols) + 0.5) * ch;
      const rad = Math.max(1.5, cell * 0.47 * Math.sqrt(sq.count / maxCount));
      sq.cx = cx; sq.cy = cy; sq.r = rad;
    });
    const seen = new Int32Array(m);
    for (const i of all) {
      const k = fleet.sIdx.get(fleet.repo[i]);
      const sq = fleet.squads[k];
      const j = seen[k]++;
      const rr = sq.r * Math.sqrt((j + 0.5) / sq.count), a = j * 2.39996;
      pos[i * 3] = sq.cx + Math.cos(a) * rr;
      pos[i * 3 + 1] = sq.cy + Math.sin(a) * rr;
      pos[i * 3 + 2] = 0;
      // dense squadrons dim per drone so the disc keeps its chapter colour instead of burning white
      const gap = sq.r * Math.sqrt(Math.PI / sq.count);
      paint(i, fleet.colors[fleet.chap[i]], Math.min(1, 0.12 + 1.5 * (gap / L.spacing) ** 2));
    }
  }
  return { pos, col, lum };
}
