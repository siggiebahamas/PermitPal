// Builds web/demo.html: the real app, bundled into one self-contained file and running on
// sample data kept in the browser (no login, nothing saved). Used to preview and review the
// design, like the Buzz demo build. Run: npm run build:demo
import { build } from 'esbuild';
import fs from 'node:fs';

const res = await build({
  entryPoints: ['web/js/app.js'],
  bundle: true, format: 'iife', write: false, minify: true, target: 'es2020',
  plugins: [{
    name: 'demo-data',
    setup(b) { b.onResolve({ filter: /^pp\/data$/ }, () => ({ path: new URL('../tests/ui/mock-data.js', import.meta.url).pathname })); },
  }],
});
const js = res.outputFiles[0].text;
const css = fs.readFileSync('web/css/app.css', 'utf8');
const logo = 'data:image/png;base64,' + fs.readFileSync('web/img/logo.png').toString('base64');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700;9..144,800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">';
// Floating switch to compare the two looks on every page (demo only). ?theme=horizon also works.
const themeSwitch = `<div class="demo-theme" role="group" aria-label="Look">
<button data-t="ledger">A · Sunrise Ledger</button><button data-t="horizon">B · Calendar Horizon</button></div>
<script>(function(){var q=new URLSearchParams(location.search).get('theme');var t=q;try{t=t||localStorage.getItem('pp-theme')}catch(e){}
function set(x){x=x==='horizon'?'horizon':'ledger';document.documentElement.dataset.theme=x;try{localStorage.setItem('pp-theme',x)}catch(e){}
document.querySelectorAll('.demo-theme button').forEach(function(b){b.classList.toggle('on',b.dataset.t===x)})}
set(t);document.querySelectorAll('.demo-theme button').forEach(function(b){b.onclick=function(){set(b.dataset.t)}})})();</script>`;
const html = `<!doctype html><html lang="en" data-theme="ledger"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>PermitPal — demo</title>${fonts}<style>${css}
.demo-flag{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:300;background:#1B2130;color:#fff;font-size:12px;font-weight:700;padding:4px 12px;border-radius:999px;opacity:.85;pointer-events:none;white-space:nowrap}\n.demo-theme{position:fixed;right:12px;bottom:76px;z-index:300;display:flex;gap:4px;background:#1B2130;padding:4px;border-radius:999px;box-shadow:0 10px 30px -10px rgba(0,0,0,.5)}\n.demo-theme button{border:0;border-radius:999px;background:none;color:#D6D3D1;font:700 12px/1 var(--font);padding:8px 11px;cursor:pointer}\n.demo-theme button.on{background:#F59E0B;color:#1B2130}\n[data-theme=horizon] .demo-theme button.on{background:#1B4DB5;color:#fff}\n@media(min-width:900px){.demo-theme{bottom:18px}}
</style></head><body><div class="demo-flag">DEMO — sample data, nothing is saved</div>${themeSwitch}
<div id="app"><div class="boot">Loading PermitPal…</div></div><div id="modal-root"></div><div id="toast" class="toast" role="status"></div>
<script>window.PP_DEMO=true;</script><script>${js.replace(/<\/script/g, '<\\/script').replaceAll('img/logo.png', logo)}</script></body></html>`;
fs.writeFileSync('web/demo.html', html.replaceAll('src="img/logo.png"', `src="${logo}"`));
console.log(`web/demo.html ${(html.length / 1024).toFixed(0)} KB`);
