#!/usr/bin/env node
// Açık kaynak bildirimleri: package-lock.json'daki ÜRETİM bağımlılıklarını (dev olmayanlar) ve lisanslarını
// node_modules/*/package.json'dan toplayıp src/data/licenses.json dosyasına yazar.
// Çalıştırma: node scripts/gen-licenses.js   (bağımlılıklar değişince yeniden çalıştırın)
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

function licenseOf(p, entry) {
  let lic = entry.license;
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(root, p, 'package.json'), 'utf8'));
    lic = pj.license || pj.licenses || lic;
  } catch { /* node_modules'ta yoksa kilit dosyasındaki değer kullanılır */ }
  if (Array.isArray(lic)) lic = lic.map((x) => (x && x.type) || x).join(' OR ');
  else if (lic && typeof lic === 'object') lic = lic.type;
  return typeof lic === 'string' && lic.trim() ? lic.trim() : 'UNKNOWN';
}

const seen = new Map();
for (const [p, entry] of Object.entries(lock.packages || {})) {
  if (!p || !p.includes('node_modules/')) continue; // kök paket
  if (entry.dev || entry.devOptional) continue; // yalnız üretim
  const name = entry.name || p.slice(p.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const key = name + '@' + (entry.version || '');
  if (!seen.has(key)) seen.set(key, { name, version: entry.version || '', license: licenseOf(p, entry) });
}
const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const outDir = path.join(root, 'src', 'data');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'licenses.json'), JSON.stringify(list) + '\n');
const unknown = list.filter((x) => x.license === 'UNKNOWN').length;
console.log(`licenses.json: ${list.length} paket (${unknown} lisans bilinmiyor)`);
