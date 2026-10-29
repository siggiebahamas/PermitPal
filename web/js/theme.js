// Site themes: the same app in five color combos. The choice is kept on this device straight away, and with the
// person's profile (database file 21) so it follows them everywhere. Status colors never change between themes.
export const THEMES = [
  ['signature', 'Signature', 'Navy and gold', { a: '#0B1B3A', b: '#13295A', c: '#E9B949', d: '#F5F6F9' }],
  ['white', 'Clean white', 'Professional and plain', { a: '#FFFFFF', b: '#F7F8FA', c: '#1B4DB5', d: '#F7F8FA' }],
  ['mint', 'Mint garden', 'Soft greens', { a: '#E7F5EC', b: '#DDF1E5', c: '#0E8A4F', d: '#F5FAF7' }],
  ['forest', 'Forest and cream', 'Deep green, warm gold', { a: '#1F3D2B', b: '#2C5139', c: '#D9B26A', d: '#FAF7EF' }],
  ['sand', 'Sand and terracotta', 'Warm and light', { a: '#F6EFE6', b: '#F1E7DA', c: '#B8582E', d: '#FBF8F4' }],
];
const LIGHT = new Set(['white', 'mint', 'sand']);
const valid = (id) => (THEMES.some(([k]) => k === id) ? id : 'signature');
export const savedTheme = () => { try { return valid(localStorage.getItem('pp-theme')); } catch { return 'signature'; } };
export function applyTheme(id) {
  const t = valid(id), root = document.documentElement;
  if (t === 'signature') delete root.dataset.theme; else root.dataset.theme = t;
  if (LIGHT.has(t)) root.dataset.shell = 'light'; else delete root.dataset.shell;
  try { localStorage.setItem('pp-theme', t); } catch { /* private mode: this visit only */ }
  return t;
}
// The public website always shows the Signature look.
export function clearTheme() { delete document.documentElement.dataset.theme; delete document.documentElement.dataset.shell; }
