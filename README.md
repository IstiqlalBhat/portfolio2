# portfolio2

Impact story built from my GitHub history: a scroll-driven three.js "commit galaxy" where every
commit is a point of light placed by date, repos form constellations and chapters tell the story.

## How data flows in

1. A private analysis pipeline (raw GitHub data → scripts → curated, privacy-checked output)
   produces a single public file: **`src/data/story.json`** (schema: person, headline, repos,
   timeline.days `[dayOffset, repoId, count]`, 4–7 chapters, skills, cta).
2. At build time a small Vite plugin (`vite.config.js` + `src/render.js`) pre-renders all story
   text into `index.html` (SEO, accessibility, no-JS / reduced-motion / no-WebGL fallback).
3. At runtime `src/galaxy.js` (lazy-loaded, only when WebGL2 is available and motion is allowed)
   expands `timeline.days` into points and builds the 3D scene.

Nothing outside `story.json` is content; replace the file and rebuild. Optional top-level
`impact` ({title, narrative, points}) renders as a summary section after the hero.

```sh
npm ci
npm run dev        # local dev
npm run build      # vite build + scripts/size-check.mjs (fails if gzipped JS > 400 KB)
npm run preview    # serve dist at /portfolio2/
```

Deployed by `.github/workflows/pages.yml` on push to `main`.
