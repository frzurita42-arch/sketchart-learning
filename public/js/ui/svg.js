// A hand-drawn SVG diagram. c.svg is sanitized server-side (scripts, handlers
// and external refs stripped) before it reaches the client.
import { esc } from './shared.js';

export function svg(c) {
  return `<figure class="slide-comp comp-svg">${c.svg}` +
    (c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : '') + `</figure>`;
}
