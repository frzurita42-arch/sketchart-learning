// A term + definition (with inline math). From public/js/ui/text-blocks.js.
import { esc, renderInlineMath } from './shared';

export function Definition({ c }: { c: any }) {
  return (
    <div
      className="slide-comp comp-definition"
      dangerouslySetInnerHTML={{ __html: `<b>${esc(c.term)}</b> — ${renderInlineMath(c.content)}` }}
    />
  );
}
