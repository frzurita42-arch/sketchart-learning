// A bulleted key-points list with inline math. From public/js/ui/text-blocks.js.
import { renderInlineMath } from './shared';

export function Keypoints({ c }: { c: any }) {
  const items = (c.items || []).map((i: any) => `<li>${renderInlineMath(i)}</li>`).join('');
  return (
    <div className="slide-comp comp-keypoints" dangerouslySetInnerHTML={{ __html: `<ul>${items}</ul>` }} />
  );
}
