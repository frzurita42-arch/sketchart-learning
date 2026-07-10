// Prose-style components: a paragraph, a bulleted key-points list, a definition,
// and a worked example. All support inline $...$ math.
import { esc, renderInlineMath } from './shared.js';

export function text(c) {
  return `<div class="slide-comp comp-text"><p>${renderInlineMath(c.content)}</p></div>`;
}

export function keypoints(c) {
  const items = (c.items || []).map(i => `<li>${renderInlineMath(i)}</li>`).join('');
  return `<div class="slide-comp comp-keypoints"><ul>${items}</ul></div>`;
}

export function definition(c) {
  return `<div class="slide-comp comp-definition"><b>${esc(c.term)}</b> — ${renderInlineMath(c.content)}</div>`;
}

export function example(c) {
  return `<div class="slide-comp comp-example">${renderInlineMath(c.content)}</div>`;
}
