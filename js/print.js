// Printing one sheet (a template, the QR poster) without the rest of the app around it.
export function printSheet(innerHtml, { cls = '' } = {}) {
  document.getElementById('print-sheet')?.remove();
  const sheet = document.createElement('div');
  sheet.id = 'print-sheet';
  if (cls) sheet.className = cls;
  sheet.innerHTML = innerHtml;
  document.body.appendChild(sheet);
  document.body.classList.add('print-sheet-on');
  const done = () => { document.body.classList.remove('print-sheet-on'); sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  // Images (the QR code) must be ready before the print dialog takes its snapshot.
  const imgs = [...sheet.querySelectorAll('img')].filter((i) => !i.complete);
  Promise.all(imgs.map((i) => new Promise((r) => { i.onload = r; i.onerror = r; }))).then(() => setTimeout(() => {
    window.print();
    if (!('onafterprint' in window)) setTimeout(done, 1000);
  }, 50));
}
