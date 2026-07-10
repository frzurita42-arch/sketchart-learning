/* Data charts rendered as clean, themed SVG. Chart math ported verbatim from
 * public/js/ui/chart.js. Returns an HTML string injected by the Chart component. */
import { esc } from './shared';

const CHART_PALETTE = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
const CHART_INK = '#2d2a26';
const CHART_AXIS = 'rgba(45,42,38,.42)';
const CHART_GRID = 'rgba(45,42,38,.12)';
const CHART_SURFACE = '#fffdf6';

function cNum(v: any, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function cFmt(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (Math.abs(n) >= 1000) return n.toLocaleString();
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
function cSvg(w: number, h: number, inner: string) {
  return `<svg viewBox="0 0 ${w} ${h}" class="chart-svg" role="img" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" font-family="'Patrick Hand','Comic Sans MS',cursive">${inner}</svg>`;
}

function svgBarChart(series: any[]) {
  const data = (series || []).map((d: any) => ({ label: String(d.label || ''), value: cNum(d.value) })).slice(0, 8);
  if (!data.length) return '';
  const W = 470, H = 270, padL = 44, padR = 16, padT = 18, padB = 52;
  const max = Math.max(1, ...data.map((d: any) => d.value));
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / data.length;
  const barW = Math.min(56, slot * 0.62);
  let body = `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="${CHART_AXIS}" stroke-width="2"/>`;
  data.forEach((d: any, i: number) => {
    const h = Math.max(0, (d.value / max) * plotH);
    const x = padL + i * slot + (slot - barW) / 2;
    const y = padT + plotH - h;
    const col = CHART_PALETTE[i % CHART_PALETTE.length];
    body += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${col}"/>`;
    body += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-size="12" fill="${CHART_INK}">${esc(cFmt(d.value))}</text>`;
    body += `<text x="${(x + barW / 2).toFixed(1)}" y="${(padT + plotH + 18).toFixed(1)}" text-anchor="middle" font-size="11" fill="${CHART_INK}">${esc(d.label.slice(0, 12))}</text>`;
  });
  return cSvg(W, H, body);
}

function svgPieChart(series: any[]) {
  const data = (series || []).map((d: any) => ({ label: String(d.label || ''), value: Math.max(0, cNum(d.value)) })).slice(0, 8);
  const total = data.reduce((a: number, b: any) => a + b.value, 0);
  if (!total) return '';
  const W = 300, H = 260, cx = 140, cy = 128, r = 100;
  let ang = -Math.PI / 2, body = '', legend = '';
  data.forEach((d: any, i: number) => {
    const frac = d.value / total;
    const a2 = ang + frac * 2 * Math.PI;
    const x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    const large = frac > 0.5 ? 1 : 0;
    const col = CHART_PALETTE[i % CHART_PALETTE.length];
    body += `<path d="M${cx} ${cy} L${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${col}" stroke="${CHART_SURFACE}" stroke-width="2"/>`;
    if (frac > 0.05) {
      const mid = (ang + a2) / 2;
      const lx = cx + r * 0.6 * Math.cos(mid), ly = cy + r * 0.6 * Math.sin(mid);
      body += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="11" fill="#fff">${Math.round(frac * 100)}%</text>`;
    }
    legend += `<div class="chart-leg"><span style="background:${col}"></span>${esc(d.label.slice(0, 24))}</div>`;
    ang = a2;
  });
  return `<div class="chart-flex">${cSvg(W, H, body)}<div class="chart-legend">${legend}</div></div>`;
}

function svgXYChart(points: any[], kind: string, xLabel?: any, yLabel?: any) {
  const pts = (points || []).map((p: any) => ({ x: cNum(p.x), y: cNum(p.y), r: cNum(p.r, 8), label: String(p.label || '') })).slice(0, 60);
  if (!pts.length) return '';
  const W = 470, H = 290, padL = 50, padR = 16, padT = kind === 'bubble' ? 38 : 16, padB = 46;
  const xs = pts.map((p: any) => p.x), ys = pts.map((p: any) => p.y);
  let xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(0, ...ys), ymax = Math.max(...ys);
  if (xmin === xmax) { xmin -= 1; xmax += 1; }
  if (ymin === ymax) { ymax += 1; }
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const sx = (x: number) => padL + ((x - xmin) / (xmax - xmin)) * plotW;
  const sy = (y: number) => padT + plotH - ((y - ymin) / (ymax - ymin)) * plotH;
  let body = '';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const gy = padT + plotH * i / ticks;
    const val = ymax - (ymax - ymin) * i / ticks;
    body += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" stroke="${CHART_GRID}" stroke-width="1"/>`;
    body += `<text x="${padL - 6}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="${CHART_INK}">${esc(cFmt(val))}</text>`;
    const gx = padL + plotW * i / ticks;
    const xval = xmin + (xmax - xmin) * i / ticks;
    body += `<text x="${gx.toFixed(1)}" y="${(padT + plotH + 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="${CHART_INK}">${esc(cFmt(xval))}</text>`;
  }
  body += `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="${CHART_AXIS}" stroke-width="2"/>`;
  body += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="${CHART_AXIS}" stroke-width="2"/>`;
  if (kind === 'line') {
    const sorted = [...pts].sort((a: any, b: any) => a.x - b.x);
    const d = sorted.map((p: any, i: number) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
    body += `<path d="${d}" fill="none" stroke="${CHART_PALETTE[0]}" stroke-width="2"/>`;
    body += sorted.map((p: any) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="4" fill="${CHART_PALETTE[0]}" stroke="${CHART_SURFACE}" stroke-width="2"/>`).join('');
  } else {
    body += pts.map((p: any, i: number) => {
      const col = CHART_PALETTE[i % CHART_PALETTE.length];
      const rr = kind === 'bubble' ? Math.max(5, Math.min(34, p.r)) : 6;
      return `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${rr}" fill="${col}" fill-opacity="${kind === 'bubble' ? 0.55 : 0.9}" stroke="${CHART_SURFACE}" stroke-width="2"/>`;
    }).join('');
  }
  if (xLabel) body += `<text x="${(padL + plotW / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="11" fill="${CHART_INK}">${esc(String(xLabel).slice(0, 40))}</text>`;
  if (yLabel) body += `<text x="14" y="${(padT + plotH / 2).toFixed(1)}" text-anchor="middle" font-size="11" fill="${CHART_INK}" transform="rotate(-90 14 ${(padT + plotH / 2).toFixed(1)})">${esc(String(yLabel).slice(0, 40))}</text>`;
  return cSvg(W, H, body);
}

export function chartHtml(c: any): string {
  const type = String(c.chartType || 'bar').toLowerCase();
  const series = Array.isArray(c.series) ? c.series : [];
  const points = Array.isArray(c.points) ? c.points : [];
  let inner = '';
  if (type === 'pie' || type === 'donut') inner = svgPieChart(series);
  else if (type === 'line' || type === 'area') inner = svgXYChart(points, 'line', c.xLabel, c.yLabel);
  else if (type === 'scatter') inner = svgXYChart(points, 'scatter', c.xLabel, c.yLabel);
  else if (type === 'bubble') inner = svgXYChart(points, 'bubble', c.xLabel, c.yLabel);
  else inner = svgBarChart(series);
  if (!inner) return '';
  return `<figure class="slide-comp comp-chart">` +
    (c.title ? `<figcaption class="chart-title">${esc(c.title)}</figcaption>` : '') +
    `<div class="chart-wrap">${inner}</div>` +
    (c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : '') + `</figure>`;
}
