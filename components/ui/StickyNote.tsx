// A sticky note for a highlight/takeaway/warning. From public/js/ui/stickynote.js.
import { esc, renderInlineMath } from './shared';

export function StickyNote({ c }: { c: any }) {
  const palette: Record<string, string> = { yellow: 'sticky-yellow', pink: 'sticky-pink', blue: 'sticky-blue', green: 'sticky-green', orange: 'sticky-orange' };
  const tone = palette[String(c.color || '').toLowerCase()] || 'sticky-yellow';
  const heading = c.title || c.label;
  const html = (heading ? `<b class="sticky-title">${esc(heading)}</b>` : '') +
    `<p>${renderInlineMath(c.note || c.content || '')}</p>`;
  return <div className={`slide-comp comp-sticky ${tone}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
