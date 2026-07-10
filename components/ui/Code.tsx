// A syntax-styled code snippet with a faux window title bar. From public/js/ui/code.js.
import { esc } from './shared';

export function Code({ c }: { c: any }) {
  const lang = esc((c.language || 'code').toLowerCase());
  const html = `<div class="code-head"><span class="code-dot"></span><span class="code-dot"></span><span class="code-dot"></span><span class="code-lang">${lang}</span></div>` +
    `<pre><code>${esc(c.content)}</code></pre>`;
  return <div className="slide-comp comp-code" dangerouslySetInnerHTML={{ __html: html }} />;
}
