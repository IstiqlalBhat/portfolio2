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
const fmtDay = (start, offset) => {
  const d = new Date(Date.parse(start + 'T00:00:00Z') + offset * 864e5);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const claims = (list) => `<ul class="claims">${(list || []).map((c) => `<li>${esc(c.claim)}</li>`).join('')}</ul>`;
const nums = (list) => `<dl class="nums n${(list || []).length}">${(list || []).map((m) => `<div><dt>${esc(m.label)}</dt><dd>${esc(m.value)}</dd></div>`).join('')}</dl>`;

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
  const links = (story.cta?.links || []).filter((l) => safeUrl(l.url));
  const lastDay = story.timeline.days.reduce((m, d) => (d[2] > 0 ? Math.max(m, d[0]) : m), 0);
  // the close-up drone is one of the newest day's drones: the record is day-granular, so that is
  // as precise as the page can truthfully be
  const lastDayCommits = story.timeline.days.reduce((s, d) => (d[0] === lastDay ? s + d[2] : s), 0);
  const closeup = lastDayCommits === 1
    ? `Up close: the drone of the newest day in the record, ${fmtDay(story.timeline.start, lastDay)}.`
    : `Up close: one of the ${num(lastDayCommits)} drones from the newest day in the record, ${fmtDay(story.timeline.start, lastDay)}.`;
  // time axis under the record's bar chart: one column per week from the timeline start, a tick at each new year
  const t0 = Date.parse(story.timeline.start + 'T00:00:00Z'), t1 = Date.parse(story.timeline.end + 'T00:00:00Z');
  const weeks = Math.ceil((Math.max(1, (t1 - t0) / 864e5) + 1) / 7);
  const ticks = [`<span style="--f:0">${fmtYM(story.timeline.start)}</span>`];
  for (let y = new Date(t0).getUTCFullYear() + 1; Date.UTC(y, 0, 1) < t1; y++) {
    const f = (Date.UTC(y, 0, 1) - t0) / 864e5 / 7 / weeks;
    if (f > 0.12 && f < 0.88) ticks.push(`<span class="yr" style="--f:${f.toFixed(4)}">${y}</span>`);
  }
  ticks.push(`<span class="end" style="--f:1">${fmtYM(story.timeline.end)}</span>`);

  // a chapter's metric tiles; on phones the ones that repeat the "N drones lifted … from M
  // repositories" line right above them are hidden (class dup) so the panel fits the screen
  const chapterNums = (c) => {
    const list = c.metrics || [];
    const dup = list.map((m) => (m.label === 'commits' && String(m.value).replace(/,/g, '') === String(chapterCommits(c))) || (m.label === 'repositories' && String(m.value) === String((c.repoIds || []).length)));
    return `<dl class="nums n${list.length}${dup.length && dup.every(Boolean) ? ' alldup' : ''}">${list.map((m, k) => `<div${dup[k] ? ' class="dup"' : ''}><dt>${esc(m.label)}</dt><dd>${esc(m.value)}</dd></div>`).join('')}</dl>`;
  };
  const summary = new Map(chapters.map((c) => [c.id, c.summary]));
  const nav = `<nav class="cues" aria-label="Show running order"><ol>${cues.map((c) => {
    const col = c.color || '#FFE9C7';
    const tip = summary.get(c.id) ? ` title="${esc(c.label)}: ${esc(summary.get(c.id))}"` : '';
    return `<li><a href="#cue-${esc(c.id)}" style="--c:${esc(col)}" aria-label="${esc(c.label)}"${tip}><span></span></a></li>`;
  }).join('')}</ol></nav>`;
  const repoWord = (n) => `${num(n)} ${n === 1 ? 'repository' : 'repositories'}`;

  const chapterSections = chapters.map((c) => `
  <section class="cue cue-chapter" id="cue-${esc(c.id)}" data-cue="${esc(c.id)}" style="--c:${esc(c.color)}">
    <div class="panel">
      <h2>${esc(c.title)}</h2>
      <p class="when">${period(c.period)}</p>
      <p class="deck">${esc(c.kicker)}</p>
      <p class="lit"><b>${num(chapterCommits(c))}</b> drones lifted out of the skyline, one per commit, from ${repoWord((c.repoIds || []).length)}.</p>
      ${claims((c.impact || []).slice(0, 2))}
      ${chapterNums(c)}
      ${c.metricsNote ? `<p class="note">${esc(c.metricsNote)}</p>` : ''}
      <details class="more"><summary>More</summary>
        <p class="story">${esc(c.narrative || c.summary)}</p>
        <ul class="stack" aria-label="Stack">${(c.stack || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      </details>
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
<div class="axis" aria-hidden="true">${ticks.join('')}</div>
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
      <p class="legend">Every drone light is one commit: ${num(total)} drones, flying as ${num(systems)} squadrons, one per repository.</p>
      <a class="down" href="#cue-merged"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>Run the show</a>
    </div>
  </section>
  <section class="cue" id="cue-merged" data-cue="merged">
    <div class="panel">
      <h2>${esc(story.impact?.title || 'What it adds up to')}</h2>
      ${nums(story.headline)}
      ${story.impact?.narrative ? `<p class="lead">${esc(story.impact.narrative)}</p>` : ''}
      ${claims(story.impact?.points)}
    </div>
  </section>
  <section class="cue" id="cue-record" data-cue="record">
    <div class="panel">
      <h2>Every commit, week by week</h2>
      <p class="story">The skyline is the whole record: ${num(total)} drones stacked by the week their commit landed, ${fmtYM(story.timeline.start)} to ${fmtYM(story.timeline.end)}, each week's bar banded by chapter. In each chapter that follows, the camera flies to that chapter's weeks and its commits lift out to take the shape of what they built.</p>
      <ol class="legend-chapters">${chapters.map((c) => `<li style="--c:${esc(c.color)}"><span class="lc-t">${esc(c.title)}</span> <span class="lc-p">${period(c.period)}</span>${c.summary ? `<span class="lc-s">${esc(c.summary)}</span>` : ''}</li>`).join('')}</ol>
    </div>
  </section>
  ${chapterSections}
  <section class="cue" id="cue-fleet" data-cue="fleet">
    <div class="panel">
      <h2>${repoWord(systems)}, one squadron each</h2>
      <p class="story">Each squadron is one repository from the record, sized by its commits and grouped and coloured by its chapter. ${num(publicCount)} are public and linked; the rest are private work, described without names.</p>
      <p class="hint" id="fleet-hint">Tap or hover a squadron to see what it is.</p>
      <details class="roster"><summary>List all ${repoWord(systems)}</summary><ol>${rosterItems}</ol></details>
    </div>
  </section>
  <section class="cue cue-cta" id="cue-cta" data-cue="cta">
    <div class="panel">
      <h2>${esc(story.cta?.line)}</h2>
      ${links.length ? `<ul class="links">${links.map((l) => `<li><a href="${esc(l.url)}">${esc(l.label)}</a><span>${esc(l.description)}</span></li>`).join('')}</ul>` : ''}
      ${gh ? `<a class="cta" href="${esc(gh)}">Open ${esc(gh.replace(/^https:\/\//, ''))}</a>` : ''}
      <p class="closeup-note">${esc(closeup)}</p>
      <p class="skills-h">Where the record is deepest</p>
      <ul class="skills">${skills}</ul>
      <p class="credits">One drone per commit, modelled in Blender, flown with three.js. Every number on this page is computed from the GitHub record.</p>
    </div>
  </section>
</main>`;
}
