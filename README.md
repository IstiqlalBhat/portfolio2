# portfolio2

Impact story built from my GitHub history, staged as a drone light show: 3,415 drones, one per real
commit, take off over the water, flock as boids and spell out the name and hook, then settle into a
weekly-commit skyline and lift out chapter by chapter. The drone is modelled headlessly in Blender
(`blender/make_drone.py`). Design-tournament previews live under `/designs/`; the previous galaxy
site is archived at `/designs/original/`.

## How data flows in

1. A private analysis pipeline (raw GitHub data → scripts → curated, privacy-checked output)
   produces a single public file: **`src/data/story.json`** (schema: person, headline, repos,
   timeline.days `[dayOffset, repoId, count]`, 4–7 chapters, skills, cta).
2. At build time a small Vite plugin (`vite.config.js` + `src/render.js`) pre-renders all story
   text into `index.html` (SEO, accessibility, no-JS / reduced-motion / no-WebGL fallback).
3. At runtime `src/swarm.js` (lazy-loaded, only when WebGL2 is available and motion is allowed)
   expands `timeline.days` into one drone per commit and runs the show; `src/cues.js` maps scroll
   to formations and `src/flat.js` is the 2D fallback.

Nothing outside `story.json` is content; replace the file and rebuild. Optional top-level
`impact` ({title, narrative, points}) renders as a summary section after the hero.

```sh
npm ci
npm run dev        # local dev
npm run build      # vite build + scripts/size-check.mjs (fails if gzipped JS > 400 KB or 3D assets > 1.5 MB)
npm run preview    # serve dist locally (vite base './')
npm run drone      # regenerate the Blender drone (needs `pip install bpy`), then
                   # npx gltfpack -i blender/out/drone.glb -o public/assets/drone.glb -cc -kn
```

Deployed by `.github/workflows/pages.yml` on push to `main`.
