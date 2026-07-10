// Sanitizing + fingerprinting slide components before they reach the client.
// Pure functions — no shared state.

function sanitizeSvg(svg) {
  if (typeof svg !== 'string') return '';
  let out = svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/(href|xlink:href)\s*=\s*"(?!#)[^"]*"/gi, '')
    .replace(/javascript:/gi, '');
  const start = out.indexOf('<svg');
  const end = out.lastIndexOf('</svg>');
  if (start === -1 || end === -1) return '';
  return out.slice(start, end + 6);
}

function sanitizeComponents(components) {
  if (!Array.isArray(components)) return [];
  return components.map(c => {
    if (c && c.type === 'svg') c.svg = sanitizeSvg(c.svg);
    if (c && c.type === 'table') {
      const headers = Array.isArray(c.headers) ? c.headers.map(v => String(v || '').trim()).filter(Boolean).slice(0, 8) : [];
      const rows = Array.isArray(c.rows)
        ? c.rows
            .map(r => Array.isArray(r) ? r.map(v => String(v || '').trim()).slice(0, Math.max(1, headers.length || 4)) : null)
            .filter(Boolean)
            .slice(0, 8)
        : [];
      c.headers = headers;
      c.rows = rows;
      c.caption = String(c.caption || '').trim();
    }
    if (c && c.type === 'stickynote') {
      c.color = ['yellow', 'pink', 'blue', 'green', 'orange'].includes(String(c.color || '').toLowerCase()) ? String(c.color).toLowerCase() : 'yellow';
      c.title = String(c.title || c.label || '').trim().slice(0, 60);
      c.note = String(c.note || c.content || '').trim().slice(0, 400);
    }
    if (c && c.type === 'chart') {
      c.chartType = ['bar', 'pie', 'donut', 'line', 'area', 'scatter', 'bubble'].includes(String(c.chartType || '').toLowerCase()) ? String(c.chartType).toLowerCase() : 'bar';
      c.title = String(c.title || '').trim().slice(0, 80);
      c.caption = String(c.caption || '').trim().slice(0, 160);
      c.xLabel = String(c.xLabel || '').trim().slice(0, 40);
      c.yLabel = String(c.yLabel || '').trim().slice(0, 40);
      c.series = Array.isArray(c.series)
        ? c.series.map(s => ({ label: String(s?.label || '').trim().slice(0, 24), value: Number(s?.value) })).filter(s => Number.isFinite(s.value)).slice(0, 8)
        : [];
      c.points = Array.isArray(c.points)
        ? c.points.map(p => ({ x: Number(p?.x), y: Number(p?.y), r: Number(p?.r), label: String(p?.label || '').trim().slice(0, 24) }))
            .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).slice(0, 60)
        : [];
    }
    return c;
  }).filter(c => {
    if (!c || !c.type) return false;
    if (c.type === 'svg') return !!c.svg;
    if (c.type === 'code') return !!c.content;
    if (c.type === 'latex') return !!c.content;
    if (c.type === 'image') return !!(c.url || c.prompt);
    if (c.type === 'table') return Array.isArray(c.headers) && c.headers.length > 0 && Array.isArray(c.rows) && c.rows.length > 0;
    if (c.type === 'stickynote') return !!c.note;
    if (c.type === 'chart') {
      const xy = ['line', 'area', 'scatter', 'bubble'].includes(c.chartType);
      return xy ? c.points.length > 0 : c.series.length > 0;
    }
    return true;
  });
}

function componentVisualSignature(component) {
  if (!component || !component.type) return '';
  const clean = (v) => String(v || '').trim().toLowerCase();
  if (component.type === 'table') {
    const headers = Array.isArray(component.headers) ? component.headers.join('|') : '';
    const firstRow = Array.isArray(component.rows) && component.rows[0] ? component.rows[0].join('|') : '';
    const secondRow = Array.isArray(component.rows) && component.rows[1] ? component.rows[1].join('|') : '';
    return `table:${clean(component.caption)}::${clean(headers)}::${clean(firstRow)}::${clean(secondRow)}`.slice(0, 260);
  }
  if (component.type === 'svg') {
    const svgLead = clean(String(component.svg || '').replace(/\s+/g, ' ').slice(0, 120));
    return `svg:${clean(component.caption)}::${svgLead}`.slice(0, 260);
  }
  if (component.type === 'image') {
    const urlHead = clean(String(component.url || '').slice(0, 180));
    return `image:${clean(component.caption || component.prompt || component.alt)}::${clean(component.prompt || '')}::${urlHead}`.slice(0, 320);
  }
  if (component.type === 'latex') return `latex:${clean(component.caption || '')}::${clean(component.content || '')}`.slice(0, 260);
  if (component.type === 'code') return `code:${clean(component.language)}:${clean(String(component.content || '').split('\n')[0])}`.slice(0, 220);
  return '';
}

module.exports = { sanitizeSvg, sanitizeComponents, componentVisualSignature };
