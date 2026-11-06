# portfolio2

Impact story built from my GitHub history, staged as a drone light show: 3,415 drones, one per real
commit, take off over the water and fly choreographed paths, as a real drone show does: seven
chapter-coloured streams that write the name left to right. The record then stands as a bar chart of
every week (each bar banded by chapter), and the camera flies chapter to chapter along the skyline,
closer for small chapters, while each chapter's commits lift out of their own weeks into an animated
emblem of what they built. The finale is an orrery of agent teams, the fleet view packs every repository
into a spinning squadron, and at the close one drone from the newest day of the record flies up to the
camera. The quadcopter (shell, canopy, prop guards, LED dome, ~840 triangles) is modelled headlessly in
Blender (`blender/make_drone.py`). Design-tournament previews live under `/designs/` (not indexed); the
previous galaxy site is archived at `/designs/original/`.

## How data flows in

1. A private analysis pipeline (raw GitHub data → scripts → curated, privacy-checked output)
   produces a single public file: **`src/data/story.json`** (schema: person, headline, repos,
   timeline.days `[dayOffset, repoId, count]`, 4–7 chapters, skills, cta).
2. At build time a small Vite plugin (`vite.config.js` + `src/render.js`) pre-renders all story
   text into `index.html` (SEO, accessibility, no-JS / reduced-motion / no-WebGL fallback).
3. At runtime the show starts after the first paint, only when WebGL2 is available and motion is
   allowed. It renders in a module worker on an OffscreenCanvas (`src/show-worker.js` running
   `src/swarm.js`), so the page's own thread never waits on the GPU; where a worker cannot draw WebGL
   the same `swarm.js` runs on the page's thread, and `src/flat.js` is the 2D fallback. `src/cues.js`
   maps the story to the running order and lays out every formation (shared by all three renderers).

Motion and performance: between formations each drone follows a cubic Bézier "carrot" (lift out,
approach from a side, land) with a stiff spring behind it, so an interrupted move stays smooth and no
per-frame neighbour search is needed. The camera rides a critically damped spring to a pose per cue
(constant pitch, so the horizon stays on the page's painted one). Glows are GL points (one vertex per
drone); hover, twinkle, trails and the fading water reflections run in the shaders, and a settled
formation costs no per-drone CPU work. Drone models are drawn only for a window of the launch pad near
the opening close-up (about 100 instances on a phone). Bar-chart and skyline drones that stack behind
each other share a spot on screen, so their brightness is divided by the stack's depth and dense weeks
stay coloured. Software rasterisers (SwiftShader, llvmpipe) get 1x pixels, a 30 fps cap and a smaller
mesh window. Debug switches: `?inthread` (render on the page's thread), `?flat` (2D), `?debug`
(the show's own frame rate in `window.__showFps`), `?still`, `?macro`.

Nothing outside `story.json` is content; replace the file and rebuild. Optional top-level
`impact` ({title, narrative, points}) renders as a summary section after the hero.

```sh
npm ci
npm run dev        # local dev
npm run build      # vite build + scripts/size-check.mjs (fails if gzipped JS > 400 KB or 3D assets > 1.5 MB;
                   # the total counts the worker bundle and the in-thread fallback chunk, a visit loads one)
npm run preview    # serve dist locally (vite base './')
npm run drone      # regenerate the Blender drone (Python 3.11 + `pip install bpy==4.5.4`), then
                   # npx -y gltfpack -i blender/out/drone.glb -o public/assets/drone.glb -cc -kn
```

Deployed by `.github/workflows/pages.yml` on push to `main`.
