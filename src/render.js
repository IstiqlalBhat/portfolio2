// Pure string renderers: run at build time (vite plugin) so all story content is
// in the static HTML for accessibility, SEO and the no-WebGL / reduced-motion fallback.
// Everything shown comes from story.json; only UI chrome text lives here.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const safeUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseYM(s, endOfMonth = false) {
  const m = /^(\d{4})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1;
  return endOfMonth ? Date.UTC(y, mo + 1, 0) : Date.UTC(y, mo, 1);
}

export function fmtYM(s) {
  const m = /^(\d{4})-(\d{2})/.exec(String(s || ''));
  return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : esc(s);
}

export function fmtDate(ms) {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function timeBounds(story) {
  const t0 = Date.parse(story.timeline?.start + 'T00:00:00Z');
  const t1 = Date.parse(story.timeline?.end + 'T00:00:00Z');
  const span = Math.max(1, (t1 - t0) / 86400000);
  return { t0, t1, span };
}

/** chapter colour lookup + repo -> chapter index */
export function chapterIndex(story) {
  const chapters = [...(story.chapters || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const byId = new Map(chapters.map((c, i) => [c.id, i]));
  const repoChap = new Map();
  for (const r of story.repos || []) if (byId.has(r.chapter)) repoChap.set(r.id, byId.get(r.chapter));
  chapters.forEach((c, i) => (c.repoIds || []).forEach((id) => { if (!repoChap.has(id)) repoChap.set(id, i); }));
  return { chapters, repoChap };
}

/** Weekly activity strip as inline SVG (stacked by chapter colour). */
export function activitySvg(story, { height = 48, cls = 'strip-svg', markers = true } = {}) {
  const { span, t0 } = timeBounds(story);
  const { chapters, repoChap } = chapterIndex(story);
  const weeks = Math.max(1, Math.ceil((span + 1) / 7));
  const bins = Array.from({ length: weeks }, () => new Float32Array(chapters.length + 1));
  let max = 1;
  for (const [day, repo, n] of story.timeline?.days || []) {
    const w = Math.min(weeks - 1, Math.max(0, Math.floor(day / 7)));
    const ci = repoChap.has(repo) ? repoChap.get(repo) : chapters.length;
    bins[w][ci] += n;
  }
  for (const b of bins) max = Math.max(max, b.reduce((s, x) => s + x, 0));
  const W = 1000, H = height, bw = W / weeks;
  const paths = Array.from({ length: chapters.length + 1 }, () => []);
  bins.forEach((b, w) => {
    const total = b.reduce((s, x) => s + x, 0);
    if (!total) return;
    const h = Math.max(1.5, Math.sqrt(total / max) * (H - 2));
    let y = H;
    b.forEach((v, ci) => {
      if (!v) return;
      const hh = (v / total) * h;
      y -= hh;
      paths[ci].push(`M${(w * bw).toFixed(1)} ${y.toFixed(1)}h${Math.max(0.6, bw * 0.72).toFixed(1)}v${hh.toFixed(1)}h-${Math.max(0.6, bw * 0.72).toFixed(1)}z`);
    });
  });
  const fills = paths.map((p, i) => p.length
    ? `<path fill="${esc(chapters[i]?.color || '#8a93a6')}" d="${p.join('')}"/>` : '').join('');
  let marks = '';
  if (markers) {
    for (const c of chapters) {
      const s = parseYM(c.period?.start);
      if (s == null) continue;
      const x = Math.min(W, Math.max(0, ((s - t0) / 86400000 / span) * W));
      marks += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="0" y2="${H}" stroke="${esc(c.color)}" stroke-opacity=".55" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    }
  }
  return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Commit activity per week, coloured by chapter">${marks}${fills}</svg>`;
}

function yearTicks(story) {
  const { t0, t1, span } = timeBounds(story);
  const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
  let out = '';
  for (let y = y0; y <= y1; y++) {
    const x = ((Date.UTC(y, 0, 1) - t0) / 86400000 / span) * 100;
    if (x < -1 || x > 101) continue;
    out += `<span class="tick" style="left:${Math.max(0, x).toFixed(2)}%">${y}</span>`;
  }
  return out;
}

export function renderHead(story) {
  const p = story.person || {};
  const title = `${p.name || ''} — ${p.role || ''}`;
  const desc = `${p.hook || ''} ${p.subhook || ''}`.trim();
  return `<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="author" content="${esc(p.name)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:site_name" content="${esc(p.name)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">`;
}

export function renderBody(story) {
  const p = story.person || {};
  const { chapters } = chapterIndex(story);
  const { t0, span } = timeBounds(story);
  const repoById = new Map((story.repos || []).map((r) => [r.id, r]));
  const gh = safeUrl(story.cta?.githubUrl) || safeUrl(p.githubUrl);

  const headline = (story.headline || []).slice(0, 5).map((h) =>
    `<li><strong class="num" data-value="${esc(h.value)}">${esc(h.value)}</strong><span>${esc(h.label)}</span></li>`).join('');

  const chapterHtml = chapters.map((c, i) => {
    const repos = (c.repoIds || []).map((id) => repoById.get(id)).filter(Boolean)
      .sort((a, b) => (b.commits || 0) - (a.commits || 0));
    const repoList = repos.slice(0, 8).map((r) => {
      const u = r.public ? safeUrl(r.url) : null;
      const label = esc(r.label);
      return `<li>${u ? `<a href="${esc(u)}" rel="noopener" target="_blank">${label}</a>` : `<span>${label}</span>`}<em>${esc(r.commits)}</em></li>`;
    }).join('');
    const more = repos.length > 8 ? `<li class="more"><span>+${repos.length - 8} more</span></li>` : '';
    return `
<section class="step chapter" id="ch-${esc(c.id)}" data-step="${i + 1}" style="--c:${esc(c.color)}" aria-labelledby="h-${esc(c.id)}">
  <article class="panel">
    <p class="ch-meta"><span class="ch-num">${String(i + 1).padStart(2, '0')}<i>/${String(chapters.length).padStart(2, '0')}</i></span><span class="period">${fmtYM(c.period?.start)} — ${fmtYM(c.period?.end)}</span></p>
    <h2 id="h-${esc(c.id)}">${esc(c.title)}</h2>
    <p class="kicker">${esc(c.kicker)}</p>
    <p class="narrative">${esc(c.narrative)}</p>
    ${(c.metrics || []).length ? `<dl class="metrics">${c.metrics.map((m) => `<div><dd>${esc(m.value)}</dd><dt>${esc(m.label)}</dt></div>`).join('')}</dl>` : ''}
    ${(c.impact || []).length ? `<h3 class="sub">Impact</h3><ul class="impact">${c.impact.map((m) => `<li>${esc(m.claim)}</li>`).join('')}</ul>` : ''}
    ${(c.stack || []).length ? `<ul class="chips" aria-label="Stack">${c.stack.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    ${repoList ? `<details class="repos"><summary>Constellation · ${repos.length} repo${repos.length === 1 ? '' : 's'}</summary><ul>${repoList}${more}</ul></details>` : ''}
  </article>
</section>`;
  }).join('');

  const markers = chapters.map((c, i) => {
    const s = parseYM(c.period?.start);
    const x = s == null ? (i / Math.max(1, chapters.length)) * 100 : Math.min(100, Math.max(0, ((s - t0) / 86400000 / span) * 100));
    return `<a class="mark" href="#ch-${esc(c.id)}" data-step="${i + 1}" style="left:${x.toFixed(2)}%;--c:${esc(c.color)}" aria-label="Chapter ${i + 1}: ${esc(c.title)}"><span>${String(i + 1).padStart(2, '0')}</span></a>`;
  }).join('');

  const skills = (story.skills || []).slice(0, 14).map((s) =>
    `<li style="--w:${Math.max(0, Math.min(1, +s.weight || 0)).toFixed(2)}">${esc(s.name)}</li>`).join('');

  return `
<canvas id="gl" aria-hidden="true"></canvas>
<div class="scrim" aria-hidden="true"></div>
<div id="labels" aria-hidden="true"></div>
<nav class="scrubber" aria-label="Timeline">
  <div class="scrub-head"><span class="scrub-date" id="scrub-date">${esc(fmtDate(t0))}</span><span class="scrub-title" id="scrub-title">${esc(p.name)}</span></div>
  <div class="scrub-track">
    ${activitySvg(story, { height: 28, cls: 'scrub-svg', markers: false })}
    <div class="scrub-ticks">${yearTicks(story)}</div>
    ${markers}
    <div class="playhead" id="playhead"></div>
  </div>
</nav>
<main id="story">
  <section class="step hero" data-step="0" aria-labelledby="name">
    <div class="hero-inner">
      <p class="eyebrow"><span class="dot"></span>${esc(p.role)}${p.handle ? ` <span class="sep">/</span> <span class="handle">@${esc(p.handle)}</span>` : ''}</p>
      <h1 id="name">${esc(p.name)}</h1>
      <p class="hook">${esc(p.hook)}</p>
      <p class="subhook">${esc(p.subhook)}</p>
      ${headline ? `<ul class="headline">${headline}</ul>` : ''}
      <div class="strip strip-static">${activitySvg(story, { height: 60 })}<div class="strip-ticks">${yearTicks(story)}</div></div>
      <p class="cue"><span class="cue-line"></span><span>Scroll through time · every point of light is a commit</span></p>
    </div>
  </section>
  ${chapterHtml}
  <section class="step cta" id="contact" data-step="${chapters.length + 1}" aria-labelledby="cta-h">
    <div class="cta-inner">
      <p class="eyebrow"><span class="dot"></span>${esc(fmtDate(t0))} — ${esc(fmtDate(timeBounds(story).t1))}</p>
      <h2 id="cta-h">${esc(story.cta?.line)}</h2>
      ${gh ? `<a class="btn" href="${esc(gh)}" rel="noopener" target="_blank"><svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg><span>${esc(gh.replace(/^https:\/\//, ''))}</span></a>` : ''}
      ${skills ? `<ul class="skills" aria-label="Skills">${skills}</ul>` : ''}
    </div>
    <footer class="foot"><span>${esc(p.name)}</span><span>Every point of light is a commit · built with three.js</span></footer>
  </section>
</main>`;
}
