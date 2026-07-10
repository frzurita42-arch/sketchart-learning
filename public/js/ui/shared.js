// Shared helpers used by every component renderer.
// esc() sanitizes all text; math renders via KaTeX (global window.katex).

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Render a LaTeX string with KaTeX (falls back to plain code if it fails or KaTeX is missing).
export function renderMath(latex, display) {
  try {
    if (!window.katex) return `<code>${esc(latex)}</code>`;
    return window.katex.renderToString(String(latex), { displayMode: !!display, throwOnError: false });
  } catch {
    return `<code>${esc(latex)}</code>`;
  }
}

// Escape prose but render inline $...$ math segments so paragraphs can carry formulas.
export function renderInlineMath(str) {
  const parts = String(str ?? '').split(/(\$[^$\n]+\$)/g);
  return parts.map(p =>
    (p.length > 2 && p[0] === '$' && p[p.length - 1] === '$')
      ? renderMath(p.slice(1, -1), false)
      : esc(p)
  ).join('');
}

// Only allow images from safe schemes (server returns data: URLs or https).
export function safeImageUrl(url) {
  const u = String(url || '').trim();
  return /^data:image\/(png|jpe?g|webp|gif|svg\+xml);/i.test(u) || /^https:\/\//i.test(u) || /^\//.test(u) ? u : '';
}

export function loadingHTML(text) {
  return `<div class="loading"><span class="pencil">✏️</span><p>${esc(text || 'Sketching your slide…')}</p></div>`;
}
