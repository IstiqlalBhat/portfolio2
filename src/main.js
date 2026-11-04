import './style.css';

const root = document.documentElement;

function toStatic(err) {
  if (err) console.warn('[portfolio] falling back to static page:', err);
  root.classList.remove('webgl');
  root.classList.add('static');
}

if (root.classList.contains('webgl')) {
  import('./galaxy.js')
    .then((m) => m.start({ onFail: toStatic }))
    .catch(toStatic);
}
