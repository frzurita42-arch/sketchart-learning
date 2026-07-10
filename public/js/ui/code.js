// A syntax-styled code snippet with a faux window title bar.
import { esc } from './shared.js';

export function code(c) {
  const lang = esc((c.language || 'code').toLowerCase());
  return `<div class="slide-comp comp-code">
      <div class="code-head"><span class="code-dot"></span><span class="code-dot"></span><span class="code-dot"></span><span class="code-lang">${lang}</span></div>
      <pre><code>${esc(c.content)}</code></pre>
    </div>`;
}
