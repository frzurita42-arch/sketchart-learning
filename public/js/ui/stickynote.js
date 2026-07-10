// A sticky note for a highlight, key takeaway, anecdote, or warning.
import { esc, renderInlineMath } from './shared.js';

export function stickynote(c) {
  const palette = { yellow: 'sticky-yellow', pink: 'sticky-pink', blue: 'sticky-blue', green: 'sticky-green', orange: 'sticky-orange' };
  const tone = palette[String(c.color || '').toLowerCase()] || 'sticky-yellow';
  const heading = c.title || c.label;
  return `<div class="slide-comp comp-sticky ${tone}">` +
    (heading ? `<b class="sticky-title">${esc(heading)}</b>` : '') +
    `<p>${renderInlineMath(c.note || c.content || '')}</p></div>`;
}
