// A compact structured table for comparisons/timelines. From public/js/ui/table.js.
import { esc, renderInlineMath } from './shared';

export function Table({ c }: { c: any }) {
  const headers = Array.isArray(c.headers) ? c.headers : [];
  const rows = Array.isArray(c.rows) ? c.rows : [];
  if (!headers.length || !rows.length) return null;
  const thead = `<tr>${headers.map((h: any) => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const tbody = rows.map((r: any) => `<tr>${(Array.isArray(r) ? r : []).map((cell: any) => `<td>${renderInlineMath(cell)}</td>`).join('')}</tr>`).join('');
  const html = `<div class="table-wrap"><table class="sketch mini">${thead}${tbody}</table></div>` +
    (c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : '');
  return <figure className="slide-comp comp-table" dangerouslySetInnerHTML={{ __html: html }} />;
}
