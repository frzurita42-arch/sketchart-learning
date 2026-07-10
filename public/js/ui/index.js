// Component registry + dispatcher. The AI picks a component "type" per slide;
// SlideComponents maps each type to its renderer (one file per component under ui/).
// Re-exports the shared helpers so app code can import everything from './ui/index.js'.
import { text, keypoints, definition, example } from './text-blocks.js';
import { table } from './table.js';
import { latex } from './latex.js';
import { code } from './code.js';
import { svg } from './svg.js';
import { image } from './image.js';
import { stickynote } from './stickynote.js';
import { chart } from './chart.js';

export { esc, renderInlineMath, renderMath, safeImageUrl, loadingHTML } from './shared.js';

export const SlideComponents = {
  text, keypoints, definition, example, table, latex, code, svg, image, stickynote, chart
};

export function renderComponents(components) {
  return (components || [])
    .map(c => (SlideComponents[c.type] ? SlideComponents[c.type](c) : ''))
    .join('');
}
