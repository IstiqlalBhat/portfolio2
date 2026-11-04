import './style.css';

const root = document.documentElement;

function toStatic(err) {
  if (err) console.warn('[portfolio] falling back to static page:', err);
  root.classList.remove('webgl');
  root.classList.add('static');
}

const nextTask = () => new Promise((r) => setTimeout(r, 0));

// Evaluate the big pieces in separate tasks (three.js, then the scene code, then the data
// inside start()) so no single script evaluation blocks the main thread for long.
async function boot() {
  try {
    await import('./three-lite.js');
    await nextTask();
    const m = await import('./galaxy.js');
    await nextTask();
    await m.start({ onFail: toStatic });
  } catch (e) {
    toStatic(e);
  }
}

// Load the 3D scene only after first paint and when the main thread is idle,
// so the pre-rendered text is interactive immediately.
if (root.classList.contains('webgl')) {
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));
  const go = () => idle(boot, { timeout: 1200 });
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}
