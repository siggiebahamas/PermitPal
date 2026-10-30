// Reading the text on a photo, entirely on this device (Tesseract, served from our own site): the photo
// is never uploaded just to be read. The reader (about 7 MB) loads the first time someone uses it and is
// kept by the browser after that.
// web/js/ocr.js → web/vendor/tesseract. The demo is one bundled page in web/demo/, where the module has no
// URL of its own, so it goes from the page instead (web/demo/ → web/vendor/tesseract).
const BASE = (() => {
  try { return new URL('../vendor/tesseract/', import.meta.url).href.replace(/\/$/, ''); } catch { return new URL('../vendor/tesseract', location.href).href; }
})();
const MAX_SIDE = 2000;     // bigger photos are slower and no more accurate
const TIME_LIMIT = 120000; // give up after 2 minutes rather than spin forever

let loader = null;
function loadTesseract() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  loader ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${BASE}/tesseract.min.js`;
    s.onload = () => (globalThis.Tesseract ? resolve(globalThis.Tesseract) : reject(new Error('load')));
    s.onerror = () => { loader = null; reject(new Error("Couldn't load the photo reader. Check your connection and try again.")); };
    document.head.appendChild(s);
  });
  return loader;
}

// Photo → canvas, upright and no bigger than needed.
async function toCanvas(file) {
  let img;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* try the slower way */ }
  if (!img) {
    const url = URL.createObjectURL(file);
    try {
      img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    } catch {
      throw new Error("We couldn't open this photo. Take it again as a normal photo (JPG or PNG), or choose a screenshot of the document.");
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
  if (!w || !h) throw new Error("We couldn't open this photo.");
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  img.close?.();
  return c;
}

// Returns the text on the photo. onProgress(fraction 0..1, words) is called as it works.
export async function readPhoto(file, onProgress = () => {}) {
  if (!file || !/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')) {
    throw new Error('Choose a photo (JPG or PNG). PDFs can be attached, but not read.');
  }
  onProgress(0.02, 'Opening the photo…');
  const canvas = await toCanvas(file);
  onProgress(0.05, 'Getting the reader ready (the first time takes a little longer)…');
  const T = await loadTesseract();
  let worker = null;
  const work = (async () => {
    worker = await T.createWorker('eng', 1, {
      workerPath: `${BASE}/worker.min.js`, corePath: BASE, langPath: BASE, workerBlobURL: false, gzip: true,
      logger: (m) => {
        if (m.status === 'recognizing text') onProgress(0.3 + 0.7 * (m.progress || 0), 'Reading the text…');
        else if (/loading|initializ/.test(m.status || '')) onProgress(0.05 + 0.25 * (m.progress || 0), 'Getting the reader ready (the first time takes a little longer)…');
      },
    });
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  })();
  const timeout = new Promise((_, no) => setTimeout(() => no(new Error('Reading took too long. Try a closer, sharper photo of just the document.')), TIME_LIMIT));
  try {
    return await Promise.race([work, timeout]);
  } finally {
    worker?.terminate().catch(() => {});
  }
}
