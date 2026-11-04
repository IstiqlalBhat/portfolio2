import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderHead, renderBody } from './src/render.js';

const storyPath = fileURLToPath(new URL('./src/data/story.json', import.meta.url));

// Pre-renders all story content into index.html at build/dev time.
function storyHtml() {
  return {
    name: 'story-html',
    transformIndexHtml(html) {
      const story = JSON.parse(readFileSync(storyPath, 'utf8'));
      return html.replace('<!--STORY_HEAD-->', renderHead(story)).replace('<!--STORY_BODY-->', renderBody(story));
    },
    handleHotUpdate({ file, server }) {
      if (file === storyPath) server.ws.send({ type: 'full-reload' });
    },
  };
}

export default defineConfig({
  base: '/portfolio2/',
  plugins: [storyHtml()],
  build: { target: 'es2020', chunkSizeWarningLimit: 800, reportCompressedSize: true },
});
