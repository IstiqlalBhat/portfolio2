import './style.css';

const root = document.documentElement;

function toStatic(err) {
  if (err) console.warn('[portfolio] falling back to static page:', err);
  root.classList.remove('webgl');
  root.classList.add('static');
}

function boot() {
  import('./galaxy.js')
    .then((m) => m.start({ onFail: toStatic }))
    .catch(toStatic);
}

// Load the 3D scene only after first paint and when the main thread is idle,
// so the pre-rendered text is interactive immediately.
if (root.classList.contains('webgl')) {
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));
  const go = () => idle(boot, { timeout: 1200 });
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}
