// pdf.js (pdfjs-dist 3.11) ve görüntüleyici betiğini TS dizgelerine gömer: node scripts/gen-pdfjs.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const lib = read('node_modules/pdfjs-dist/build/pdf.min.js');
const worker = read('node_modules/pdfjs-dist/build/pdf.worker.min.js');
const searchCore = read('scripts/pdfjs/searchCore.js');
const viewer = searchCore + '\n' + read('scripts/pdfjs/viewer.js');
const css = read('scripts/pdfjs/viewer.css');
for (const [n, s] of [['lib', lib], ['worker', worker], ['viewer', viewer]]) {
  if (/<\/script/i.test(s)) throw new Error(n + ' içinde </script bulundu');
}
const out =
  '// OTOMATİK ÜRETİLDİ (scripts/gen-pdfjs.js). Elle düzenlemeyin.\n' +
  '// pdf.js 3.11.174 (Apache-2.0, Mozilla) + T-Desk görüntüleyici betiği.\n' +
  'export const PDFJS_LIB = ' + JSON.stringify(lib) + ';\n' +
  'export const PDFJS_WORKER = ' + JSON.stringify(worker) + ';\n' +
  'export const PDFJS_VIEWER_JS = ' + JSON.stringify(viewer) + ';\n' +
  'export const PDFJS_VIEWER_CSS = ' + JSON.stringify(css) + ';\n';
fs.writeFileSync(path.join(root, 'src/viewers/pdfjs/pdfjsBundle.ts'), out);
console.log('yazıldı:', (out.length / 1048576).toFixed(2), 'MB');
