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
    setup(b) {
      b.onResolve({ filter: /^pp\/data$/ }, () => ({ path: new URL('../tests/ui/mock-data.js', import.meta.url).pathname }));
      // the stand-in data layer imports the app's prices by its URL in the browser (/__mock/ → /js/)
      b.onResolve({ filter: /^\.\.\/js\/(prices|vehicle-rules)\.js$/ }, (a) => ({ path: new URL(`../web/js/${a.path.slice(6)}`, import.meta.url).pathname }));
    },
  }],
});
const js = res.outputFiles[0].text;
const css = fs.readFileSync('web/css/app.css', 'utf8');
const logo = 'data:image/png;base64,' + fs.readFileSync('web/img/logo.png').toString('base64');
const wordmark = 'data:image/png;base64,' + fs.readFileSync('web/img/wordmark.png').toString('base64');
const badge = 'data:image/png;base64,' + fs.readFileSync('web/img/badge-email.png').toString('base64');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700;9..144,800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap">';
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<title>Pinoy Permit — demo</title>${fonts}<style>${css}
.demo-bar{position:relative;z-index:300;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px 14px;padding:8px 16px;background:#E9B949;color:#0B1B3A;font:600 14.5px/1.3 'Plus Jakarta Sans',sans-serif}
.demo-bar b{font-weight:800}
.demo-bar a{color:#0B1B3A;font-weight:800;text-decoration:none;white-space:nowrap}
.demo-bar .demo-back{text-decoration:underline;text-underline-offset:3px}
.demo-bar .demo-signup{background:#0B1B3A;color:#fff;border-radius:999px;padding:7px 16px}
.demo-bar .demo-signup:hover{background:#16306A}
@media (max-width:600px){.demo-bar{font-size:13.5px;gap:6px 10px}.demo-bar .demo-say{flex-basis:100%;text-align:center}}
</style></head><body><div class="demo-bar" role="region" aria-label="Demo"><span class="demo-say"><b>You're in the demo.</b> Sample data, nothing is saved.</span>
<a class="demo-back" href="../" data-site>← Back to the website</a><a class="demo-signup" href="../#/signup" data-site="#/signup">Sign up free: create your real account</a></div>
<script>/* /PermitPal/demo/ and the older /PermitPal/demo.html both point at the real site */document.querySelectorAll('[data-site]').forEach(function(a){a.href=(location.pathname.endsWith('/demo/')?'../':'./')+(a.dataset.site||'');});</script>
<div id="app"><div class="boot">Loading Pinoy Permit…<span class="boot-slow">Taking too long? <a href="./">Reload the page</a>. If it keeps happening, update your browser or open this link in Chrome or Safari.</span></div></div><div id="modal-root"></div><div id="toast" class="toast" role="status"></div>
<script>window.PP_DEMO=true;</script><script>${js.replace(/<\/script/g, '<\\/script').replaceAll('img/logo.png', logo).replaceAll('img/wordmark.png', wordmark).replaceAll('src="img/badge-email.png"', `src="${badge}"`)}</script></body></html>`;
// Published at /PermitPal/demo/ (and the older /PermitPal/demo.html link keeps working).
const out = html.replaceAll('src="img/logo.png"', `src="${logo}"`);
fs.mkdirSync('web/demo', { recursive: true });
fs.writeFileSync('web/demo/index.html', out);
fs.writeFileSync('web/demo.html', out);
console.log(`web/demo/index.html ${(out.length / 1024).toFixed(0)} KB`);
