// Data charts rendered as themed inline SVG. From public/js/ui/chart.js.
import { chartHtml } from './chart-svg';

export function Chart({ c }: { c: any }) {
  const html = chartHtml(c);
  if (!html) return null;
  // chartHtml already includes the outer <figure class="slide-comp comp-chart">.
  return <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} />;
}
