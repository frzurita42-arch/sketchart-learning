/* Component library: the AI picks component types per slide; these render them.
   All text goes through esc(); only sanitized SVG from the server is inserted raw.
   Math is rendered with KaTeX; images are validated to safe URL schemes. */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Render a LaTeX string with KaTeX (falls back to plain code if it fails or KaTeX is missing).
function renderMath(latex, display) {
  try {
    if (!window.katex) return `<code>${esc(latex)}</code>`;
    return window.katex.renderToString(String(latex), { displayMode: !!display, throwOnError: false });
  } catch {
    return `<code>${esc(latex)}</code>`;
  }
}

// Escape prose but render inline $...$ math segments so paragraphs can carry formulas.
function renderInlineMath(str) {
  const parts = String(str ?? '').split(/(\$[^$\n]+\$)/g);
  return parts.map(p =>
    (p.length > 2 && p[0] === '$' && p[p.length - 1] === '$')
      ? renderMath(p.slice(1, -1), false)
      : esc(p)
  ).join('');
}

// Only allow images from safe schemes (server returns data: URLs or https).
function safeImageUrl(url) {
  const u = String(url || '').trim();
  return /^data:image\/(png|jpe?g|webp|gif|svg\+xml);/i.test(u) || /^https:\/\//i.test(u) || /^\//.test(u) ? u : '';
}

const SlideComponents = {
  text(c) {
    return `<div class="slide-comp comp-text"><p>${renderInlineMath(c.content)}</p></div>`;
  },
  keypoints(c) {
    const items = (c.items || []).map(i => `<li>${renderInlineMath(i)}</li>`).join('');
    return `<div class="slide-comp comp-keypoints"><ul>${items}</ul></div>`;
  },
  definition(c) {
    return `<div class="slide-comp comp-definition"><b>${esc(c.term)}</b> — ${renderInlineMath(c.content)}</div>`;
  },
  example(c) {
    return `<div class="slide-comp comp-example">${renderInlineMath(c.content)}</div>`;
  },
  svg(c) {
    // c.svg is sanitized server-side (scripts, handlers and external refs stripped)
    return `<figure class="slide-comp comp-svg">${c.svg}` +
      (c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : '') + `</figure>`;
  },
  // A block formula on its own "index card".
  latex(c) {
    return `<figure class="slide-comp comp-latex">${renderMath(c.content, true)}` +
      (c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : '') + `</figure>`;
  },
  // A syntax-styled code snippet.
  code(c) {
    const lang = esc((c.language || 'code').toLowerCase());
    return `<div class="slide-comp comp-code">
      <div class="code-head"><span class="code-dot"></span><span class="code-dot"></span><span class="code-dot"></span><span class="code-lang">${lang}</span></div>
      <pre><code>${esc(c.content)}</code></pre>
    </div>`;
  },
  // A compact structured table for comparisons, timelines, and trade-offs.
  table(c) {
    const headers = Array.isArray(c.headers) ? c.headers : [];
    const rows = Array.isArray(c.rows) ? c.rows : [];
    if (!headers.length || !rows.length) return '';
    const thead = `<tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr>`;
    const tbody = rows.map(r => `<tr>${(Array.isArray(r) ? r : []).map(cell => `<td>${renderInlineMath(cell)}</td>`).join('')}</tr>`).join('');
    return `<figure class="slide-comp comp-table"><div class="table-wrap"><table class="sketch mini">${thead}${tbody}</table></div>` +
      (c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : '') + `</figure>`;
  },
  // An AI-generated image, framed to fit the sketch/paper theme.
  image(c) {
    const url = safeImageUrl(c.url);
    if (!url) return '';
    const frame = c.frame === 'polaroid' ? 'polaroid' : 'paper';
    return `<figure class="slide-comp comp-image ${frame}"><img src="${esc(url)}" alt="${esc(c.alt || c.caption || 'illustration')}" loading="lazy">` +
      (c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : '') + `</figure>`;
  }
};

function renderComponents(components) {
  return (components || [])
    .map(c => (SlideComponents[c.type] ? SlideComponents[c.type](c) : ''))
    .join('');
}

function loadingHTML(text) {
  return `<div class="loading"><span class="pencil">✏️</span><p>${esc(text || 'Sketching your slide…')}</p></div>`;
}
