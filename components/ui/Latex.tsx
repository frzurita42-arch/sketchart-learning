// A displayed LaTeX formula/proof on its own index card. From public/js/ui/latex.js.
import { esc, renderMath } from './shared';

export function Latex({ c }: { c: any }) {
  const html = renderMath(c.content, true) + (c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : '');
  return <figure className="slide-comp comp-latex" dangerouslySetInnerHTML={{ __html: html }} />;
}
