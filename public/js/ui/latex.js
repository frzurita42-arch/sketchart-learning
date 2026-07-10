// A displayed LaTeX formula/proof on its own "index card".
import { esc, renderMath } from './shared.js';

export function latex(c) {
  return `<figure class="slide-comp comp-latex">${renderMath(c.content, true)}` +
    (c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : '') + `</figure>`;
}
