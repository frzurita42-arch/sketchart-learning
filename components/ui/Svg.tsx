// A hand-drawn SVG diagram. c.svg is sanitized server-side. From public/js/ui/svg.js.
import { esc } from './shared';

export function Svg({ c }: { c: any }) {
  const html = String(c.svg || '') + (c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : '');
  return <figure className="slide-comp comp-svg" dangerouslySetInnerHTML={{ __html: html }} />;
}
