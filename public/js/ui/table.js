// A compact structured table for comparisons, timelines, and trade-offs.
import { esc, renderInlineMath } from './shared.js';

export function table(c) {
  const headers = Array.isArray(c.headers) ? c.headers : [];
  const rows = Array.isArray(c.rows) ? c.rows : [];
  if (!headers.length || !rows.length) return '';
  const thead = `<tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const tbody = rows.map(r => `<tr>${(Array.isArray(r) ? r : []).map(cell => `<td>${renderInlineMath(cell)}</td>`).join('')}</tr>`).join('');
  return `<figure class="slide-comp comp-table"><div class="table-wrap"><table class="sketch mini">${thead}${tbody}</table></div>` +
    (c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : '') + `</figure>`;
}
