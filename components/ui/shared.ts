/* Shared helpers used by every slide-component renderer.
 * Ported from public/js/ui/shared.js. Math renders with the `katex` npm package
 * (the legacy code used the global window.katex build). */
import katex from 'katex';

export function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, (c: string) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any
  )[c]);
}

// Render a LaTeX string with KaTeX (falls back to plain code if it fails).
export function renderMath(latex: any, display?: boolean): string {
  try {
    return katex.renderToString(String(latex), { displayMode: !!display, throwOnError: false });
  } catch {
    return `<code>${esc(latex)}</code>`;
  }
}

// Escape prose but render inline $...$ math segments so paragraphs can carry formulas.
export function renderInlineMath(str: any): string {
  const parts = String(str ?? '').split(/(\$[^$\n]+\$)/g);
  return parts.map(p =>
    (p.length > 2 && p[0] === '$' && p[p.length - 1] === '$')
      ? renderMath(p.slice(1, -1), false)
      : esc(p)
  ).join('');
}

// Only allow images from safe schemes (server returns data: URLs or https).
export function safeImageUrl(url: any): string {
  const u = String(url || '').trim();
  return /^data:image\/(png|jpe?g|webp|gif|svg\+xml);/i.test(u) || /^https:\/\//i.test(u) || /^\//.test(u) ? u : '';
}

export function loadingHTML(text?: string): string {
  return `<div class="loading"><span class="pencil">✏️</span><p>${esc(text || 'Sketching your slide…')}</p></div>`;
}
