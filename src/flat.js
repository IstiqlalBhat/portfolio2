// 2D fallback (no WebGL, or prefers-reduced-motion): the same formations, drawn once per cue, no motion.
export async function start({ canvas, cues, fleet, layout, formation }) {
  const g = canvas.getContext('2d');
  if (!g) return { setCue() {}, highlight() {} };
  const sprites = new Map();
  const sprite = (r, gr, b) => {
    const key = `${(r * 15) | 0},${(gr * 15) | 0},${(b * 15) | 0}`;
    let s = sprites.get(key);
    if (!s) {
      s = document.createElement('canvas');
      s.width = s.height = 32;
      const c = s.getContext('2d');
      const grd = c.createRadialGradient(16, 16, 0, 16, 16, 16);
      const rgb = `${(r * 255) | 0},${(gr * 255) | 0},${(b * 255) | 0}`;
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.18, `rgba(${rgb},1)`);
      grd.addColorStop(0.45, `rgba(${rgb},0.28)`);
      grd.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = grd;
      c.fillRect(0, 0, 32, 32);
      sprites.set(key, s);
    }
    return s;
  };
  const stars = Array.from({ length: 220 }, () => [Math.random(), Math.pow(Math.random(), 1.6), 0.3 + Math.random() * 0.6]);
  let L, cue = 0, dpr = 1, highlight = null;

  function draw() {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, L.w, L.h);
    const hzY = L.h * L.hz;
    g.fillStyle = '#cfd8ff';
    for (const [x, y, a] of stars) { g.globalAlpha = a * 0.7; g.fillRect(x * L.w, y * hzY * 0.92, 1.2, 1.2); }
    const f = formation(cues[cue], fleet, L, false);
    const size = L.spacing * 3.2;
    L.upp = L.upp || 0;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < fleet.n; i++) {
      let l = f.lum[i];
      if (highlight != null) l = fleet.repo[i] === highlight ? Math.min(1, l * 2.4) : l * 0.3;
      if (l < 0.02) continue;
      const s = sprite(f.col[i * 3], f.col[i * 3 + 1], f.col[i * 3 + 2]);
      const x = f.pos[i * 3], y = f.pos[i * 3 + 1];
      const r = size * (0.6 + 0.4 * l);
      g.globalAlpha = Math.min(1, l);
      g.drawImage(s, x - r / 2, y - r / 2, r, r);
      g.globalAlpha = Math.min(1, l) * 0.28;
      g.drawImage(s, x - r * 0.35, 2 * hzY - y - r, r * 0.7, r * 2);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    L = layout(innerWidth, innerHeight);
    document.documentElement.style.setProperty('--hz', (L.hz * 100).toFixed(2) + '%');
    draw();
  }
  addEventListener('resize', resize);
  resize();
  return {
    setCue(i) { if (i !== cue) { cue = i; highlight = null; draw(); } },
    highlight(repoId) { if (repoId !== highlight) { highlight = repoId; draw(); } },
  };
}
