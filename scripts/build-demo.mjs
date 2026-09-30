// Builds web/demo.html: the real app, bundled into one self-contained file and running on
// sample data kept in the browser (no login, nothing saved). Used to preview and review the
// design, like the Buzz demo build. Run: npm run build:demo
import { build } from 'esbuild';
import fs from 'node:fs';

const res = await build({
  entryPoints: ['web/js/app.js'],
  bundle: true, format: 'iife', write: false, minify: true, target: 'es2019',
  plugins: [{
    name: 'demo-data',
    setup(b) { b.onResolve({ filter: /^pp\/data$/ }, () => ({ path: new URL('../tests/ui/mock-data.js', import.meta.url).pathname })); },
  }],
});
const js = res.outputFiles[0].text;
const css = fs.readFileSync('web/css/app.css', 'utf8');
const logo = 'data:image/png;base64,' + fs.readFileSync('web/img/logo.png').toString('base64');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700;9..144,800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap">';
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>PermitPal — demo</title>${fonts}<style>${css}
.demo-flag{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:300;background:#1B2130;color:#fff;font-size:12px;font-weight:700;padding:4px 12px;border-radius:999px;opacity:.85;pointer-events:none;white-space:nowrap}
</style></head><body><div class="demo-flag">DEMO — sample data, nothing is saved</div>
<div id="app"><div class="boot">Loading PermitPal…<span class="boot-slow">Taking too long? <a href="./">Reload the page</a>. If it keeps happening, update your browser or open this link in Chrome or Safari.</span></div></div><div id="modal-root"></div><div id="toast" class="toast" role="status"></div>
<script>window.PP_DEMO=true;</script><script>${js.replace(/<\/script/g, '<\\/script').replaceAll('img/logo.png', logo)}</script></body></html>`;
// Published at /PermitPal/demo/ (and the older /PermitPal/demo.html link keeps working).
const out = html.replaceAll('src="img/logo.png"', `src="${logo}"`);
fs.mkdirSync('web/demo', { recursive: true });
fs.writeFileSync('web/demo/index.html', out);
fs.writeFileSync('web/demo.html', out);
console.log(`web/demo/index.html ${(out.length / 1024).toFixed(0)} KB`);
