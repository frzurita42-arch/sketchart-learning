// A paragraph with inline $...$ math. Ported from public/js/ui/text-blocks.js.
import { renderInlineMath } from './shared';

export function Text({ c }: { c: any }) {
  return (
    <div className="slide-comp comp-text">
      <p dangerouslySetInnerHTML={{ __html: renderInlineMath(c.content) }} />
    </div>
  );
}
