/* Small generic helpers shared across modules. */
import { API } from './api.js';

export function shuffled(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function withTimeout(promise, ms, message) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message || 'Request timed out')), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

export function hashText(s) {
  let h = 0;
  const t = String(s || '');
  for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export async function downloadCsv() {
  const res = await fetch('/api/games/export.csv', { headers: { Authorization: `Bearer ${API.token}` } });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sketchlearn-progress.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
