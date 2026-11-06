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

export default defineConfig({
  base: './',
  plugins: [storyHtml()],
  build: { target: 'es2020', reportCompressedSize: true, chunkSizeWarningLimit: 800 },
});
