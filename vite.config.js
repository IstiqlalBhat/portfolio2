import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderHead, renderBody } from './src/render.js';

const storyPath = fileURLToPath(new URL('./src/data/story.json', import.meta.url));

// Pre-renders every story string into index.html (no-JS / no-WebGL / reduced-motion all read it).
function storyHtml() {
  return {
    name: 'story-html',
    transformIndexHtml(html) {
      const story = JSON.parse(readFileSync(storyPath, 'utf8'));
      return html.replace('<!--STORY_HEAD-->', renderHead(story)).replace('<!--STORY_BODY-->', renderBody(story));
    },
  };
}

// The display font starts downloading with the page: the first paint uses it and the swarm draws
// the name with it. (The show chunk is requested as soon as the font is in, see src/main.js.)
function preloadFont() {
  return {
    name: 'preload-font',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const font = Object.values(ctx.bundle || {}).find((c) => c.type === 'asset' && /\.woff2$/.test(c.fileName));
        return font ? html.replace('</head>', `<link rel="preload" as="font" type="font/woff2" crossorigin href="./${font.fileName}">\n</head>`) : html;
      },
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [storyHtml(), preloadFont()],
  json: { stringify: true },
  build: { target: 'es2020', reportCompressedSize: true, chunkSizeWarningLimit: 800 },
});
