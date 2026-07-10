// An AI-generated image, framed to fit the sketch/paper theme.
import { esc, safeImageUrl } from './shared.js';

export function image(c) {
  const url = safeImageUrl(c.url);
  if (!url) return '';
  const frame = c.frame === 'polaroid' ? 'polaroid' : 'paper';
  return `<figure class="slide-comp comp-image ${frame}"><img src="${esc(url)}" alt="${esc(c.alt || c.caption || 'illustration')}" loading="lazy">` +
    (c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : '') + `</figure>`;
}
