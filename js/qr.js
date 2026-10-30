// QR codes for the public permit page (poster, accreditation pack). Drawn here from the vendored
// generator, so nothing is sent anywhere to make them.
import qrcode from './vendor/qrcode.js?v=fd3a394';

function matrix(text) {
  const q = qrcode(0, 'M');
  q.addData(String(text));
  q.make();
  const n = q.getModuleCount();
  return { n, dark: (r, c) => q.isDark(r, c) };
}

// An <svg> string, crisp at any size (quiet zone of 4 modules, as scanners expect).
export function qrSvg(text, { label = 'QR code' } = {}) {
  const { n, dark } = matrix(text);
  const size = n + 8;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) d += `M${c + 4},${r + 4}h1v1h-1z`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${esc(label)}"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#0B1B3A"/></svg>`;
}

// A PNG data URL (for files that can't hold an <svg>, like the accreditation pack's summary).
export function qrPng(text, px = 600) {
  const { n, dark } = matrix(text);
  const size = n + 8;
  const k = Math.max(1, Math.floor(px / size));
  const c = document.createElement('canvas');
  c.width = c.height = size * k;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#0B1B3A';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (dark(r, col)) g.fillRect((col + 4) * k, (r + 4) * k, k, k);
  return c.toDataURL('image/png');
}
