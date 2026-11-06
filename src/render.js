// Build-time renderer (used by the vite plugin): all story content lands in static HTML, so the page
// reads without JS, without WebGL and with reduced motion. Only UI chrome text lives here.
import { buildCues } from './cues.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtYM = (s) => { const m = /^(\d{4})-(\d{2})/.exec(String(s || '')); return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : esc(s); };
const period = (p) => (fmtYM(p?.start) === fmtYM(p?.end) ? fmtYM(p?.start) : `${fmtYM(p?.start)} – ${fmtYM(p?.end)}`);
const num = (n) => Number(n).toLocaleString('en-US');

const claims = (list) => `<ul class="claims">${(list || []).map((c) => `<li>${esc(c.claim)}</li>`).join('')}</ul>`;
const nums = (list) => `<dl class="nums">${(list || []).map((m) => `<div><dt>${esc(m.label)}</dt><dd>${esc(m.value)}</dd></div>`).join('')}</dl>`;

export function renderHead(story) {
  const p = story.person;
  return `<title>${esc(p.name)} · ${esc(p.role)}</title>
<meta name="description" content="${esc(p.hook)} ${esc(p.subhook)}">
<meta property="og:title" content="${esc(p.name)}, ${esc(p.role)}">
<meta property="og:description" content="${esc(p.hook)}">`;
}

export function renderBody(story) {
  const p = story.person;
  const gh = safeUrl(p.githubUrl) || safeUrl(story.cta?.githubUrl);
  const cues = buildCues(story);
  const chapters = [...story.chapters].sort((a, b) => a.index - b.index);
  const total = story.repos.reduce((s, r) => s + r.commits, 0);
  const systems = story.repos.length;
  const publicCount = story.repos.filter((r) => r.public).length;
  const chapterCommits = (c) => story.repos.filter((r) => r.chapter === c.id).reduce((s, r) => s + r.commits, 0);
  const chapterTitle = new Map(chapters.map((c) => [c.id, c.title]));
  const chapterColor = new Map(chapters.map((c) => [c.id, c.color]));
  const firstDay = new Map();
  for (const [d, r] of story.timeline.days) if (!firstDay.has(r) || d < firstDay.get(r)) firstDay.set(r, d);
  const roster = [...story.repos].sort((a, b) => (firstDay.get(a.id) ?? 0) - (firstDay.get(b.id) ?? 0));

  const nav = `<nav class="cues" aria-label="Show running order"><ol>${cues.map((c) => {
    const col = c.color || '#FFE9C7';
    return `<li><a href="#cue-${esc(c.id)}" style="--c:${esc(col)}" aria-label="${esc(c.label)}"><span></span></a></li>`;
  }).join('')}</ol></nav>`;

  const chapterSections = chapters.map((c) => `
  <section class="cue cue-chapter" id="cue-${esc(c.id)}" data-cue="${esc(c.id)}" style="--c:${esc(c.color)}">
    <div class="panel">
      <h2>${esc(c.title)}</h2>
      <p class="when">${period(c.period)}</p>
      <p class="deck">${esc(c.kicker)}</p>
      <p class="lit"><b>${num(chapterCommits(c))}</b> drones lifted out of the skyline, one per commit, from ${num((c.repoIds || []).length)} systems.</p>
      <p class="story">${esc(c.narrative)}</p>
      ${claims(c.impact)}
      ${nums(c.metrics)}
      ${c.metricsNote ? `<p class="note">${esc(c.metricsNote)}</p>` : ''}
      <ul class="stack" aria-label="Stack">${(c.stack || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
    </div>
  </section>`).join('');

  const rosterItems = roster.map((r) => {
    const url = r.public ? safeUrl(r.url) : null;
    const name = url ? `<a href="${esc(url)}">${esc(r.label)}</a>` : esc(r.label);
    return `<li style="--c:${esc(chapterColor.get(r.chapter) || '#8a93a6')}"><span class="r-name">${name}</span><span class="r-desc">${esc(r.description)}</span><span class="r-meta">${num(r.commits)} ${r.commits === 1 ? 'commit' : 'commits'} · ${esc(chapterTitle.get(r.chapter) || '')}</span></li>`;
  }).join('');

  const skills = [...(story.skills || [])].sort((a, b) => b.weight - a.weight).map((s) => `<li>${esc(s.name)}</li>`).join('');

  return `
<a class="skip" href="#cue-merged">Skip the intro</a>
<canvas id="sky" aria-hidden="true"></canvas>
<header class="bar">
  <a class="mark" href="#cue-hero">${esc(p.name)}</a>
  ${gh ? `<a class="gh" href="${esc(gh)}">GitHub</a>` : ''}
</header>
${nav}
<div class="tip" id="tip" role="status" aria-live="polite" hidden></div>
<main id="show">
  <section class="cue cue-hero" id="cue-hero" data-cue="hero">
    <div class="panel">
      <h1><span class="name">${esc(p.name)}</span> <span class="role">${esc(p.role)}</span></h1>
      <p class="hook">${esc(p.hook)}</p>
      <p class="sub">${esc(p.subhook)}</p>
      <p class="legend">Every light in this sky is one commit: ${num(total)} drones, flying as ${num(systems)} squadrons, one per system built.</p>
      <a class="down" href="#cue-merged"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>Run the show</a>
    </div>
  </section>
  <section class="cue" id="cue-merged" data-cue="merged">
    <div class="panel">
      <h2>${esc(story.impact?.title || 'What it adds up to')}</h2>
      ${nums(story.headline)}
      <p class="story">${esc(story.impact?.narrative)}</p>
      ${claims(story.impact?.points)}
    </div>
  </section>
  <section class="cue" id="cue-record" data-cue="record">
    <div class="panel">
      <h2>Every commit, week by week</h2>
      <p class="story">The skyline on the water is the whole record: ${num(total)} drones stacked by the week their commit landed, ${fmtYM(story.timeline.start)} to ${fmtYM(story.timeline.end)}. In each chapter that follows, its commits lift out of their own weeks and take the shape of what they built.</p>
      <ol class="legend-chapters">${chapters.map((c) => `<li style="--c:${esc(c.color)}">${esc(c.title)} <span>${period(c.period)}</span></li>`).join('')}</ol>
    </div>
  </section>
  ${chapterSections}
  <section class="cue" id="cue-fleet" data-cue="fleet">
    <div class="panel">
      <h2>${num(systems)} systems, one squadron each</h2>
      <p class="story">Each squadron is one repository from the record, sized by its commits and coloured by its chapter. ${num(publicCount)} are public and linked; the rest are private work, described without names.</p>
      <p class="hint" id="fleet-hint">Tap or hover a squadron to see what it is.</p>
      <details class="roster"><summary>List all ${num(systems)} systems</summary><ol>${rosterItems}</ol></details>
    </div>
  </section>
  <section class="cue cue-cta" id="cue-cta" data-cue="cta">
    <div class="panel">
      <h2>${esc(story.cta?.line)}</h2>
      ${gh ? `<a class="cta" href="${esc(gh)}">Open ${esc(gh.replace(/^https:\/\//, ''))}</a>` : ''}
      <p class="skills-h">Where the record is deepest</p>
      <ul class="skills">${skills}</ul>
      <p class="credits">One drone per commit, modelled in Blender, flown with three.js. Every number on this page is computed from the GitHub record.</p>
    </div>
  </section>
</main>`;
}
