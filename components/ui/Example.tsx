// A worked example (with inline math). From public/js/ui/text-blocks.js.
import { renderInlineMath } from './shared';

export function Example({ c }: { c: any }) {
  return (
    <div className="slide-comp comp-example" dangerouslySetInnerHTML={{ __html: renderInlineMath(c.content) }} />
  );
}
