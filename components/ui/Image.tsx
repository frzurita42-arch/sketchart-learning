// An AI-generated image, framed to fit the sketch/paper theme. From public/js/ui/image.js.
import { esc, safeImageUrl } from './shared';

export function Image({ c }: { c: any }) {
  const url = safeImageUrl(c.url);
  if (!url) return null;
  const frame = c.frame === 'polaroid' ? 'polaroid' : 'paper';
  const html = `<img src="${esc(url)}" alt="${esc(c.alt || c.caption || 'illustration')}" loading="lazy">` +
    (c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : '');
  return <figure className={`slide-comp comp-image ${frame}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
