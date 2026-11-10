#!/usr/bin/env node
// Geliştirme denetimi: tr/en/de sözlükleri aynı anahtar kümesine sahip mi, boş/eksik değer var mı,
// {param} yer tutucuları dillerde tutarlı mı, kodda kullanılan t('anahtar') anahtarları sözlükte var mı.
// Çalıştırma: node scripts/check-i18n.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'src', 'i18n');
const langs = ['tr', 'en', 'de'];
const dicts = {};
let errors = 0;
const fail = (m) => { errors++; console.error('HATA: ' + m); };

function flatten(o, prefix, out) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}
for (const l of langs) dicts[l] = flatten(JSON.parse(fs.readFileSync(path.join(dir, l + '.json'), 'utf8')), '', {});

const all = new Set();
for (const l of langs) Object.keys(dicts[l]).forEach((k) => all.add(k));
const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
for (const k of all) {
  for (const l of langs) {
    if (!(k in dicts[l])) { fail(`${l}.json eksik anahtar: ${k}`); continue; }
    const v = dicts[l][k];
    if (typeof v !== 'string' || v.trim() === '') fail(`${l}.json boş/geçersiz değer: ${k}`);
    else if (v.includes('!')) fail(`${l}.json ünlem işareti (üslup kılavuzu): ${k}`);
  }
  if (langs.every((l) => k in dicts[l])) {
    const p = ph(dicts.tr[k]);
    for (const l of ['en', 'de']) if (ph(dicts[l][k]) !== p) fail(`${l}.json yer tutucular tr ile farklı: ${k} (${ph(dicts[l][k])} / ${p})`);
  }
}
for (const k of all) {
  if (k.endsWith('_one') && !all.has(k.slice(0, -4) + '_other')) fail(`_other eksik: ${k}`);
  if (k.endsWith('_other') && !all.has(k.slice(0, -6) + '_one')) fail(`_one eksik: ${k}`);
}

const bases = new Set([...all].map((k) => k.replace(/_(one|other)$/, '')));
const used = new Set();
function scan(p) {
  const src = fs.readFileSync(p, 'utf8');
  for (const m of src.matchAll(/\b(?:t|tr|makeRef)\(\s*'([a-zA-Z0-9_.]+)'/g)) {
    used.add(m[1]);
    if (!bases.has(m[1])) fail(`${path.relative(root, p)}: bilinmeyen anahtar ${m[1]}`);
  }
}
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) scan(p);
  }
}
walk(path.join(root, 'src'));
walk(path.join(root, 'modules', 'tdesk-bridge', 'src'));
scan(path.join(root, 'App.tsx'));
const unused = [...bases].filter((b) => !used.has(b));
console.log(`anahtar: ${all.size} (çoğul dahil, taban ${bases.size}) | kullanılan: ${used.size} | kullanılmayan: ${unused.length}`);
if (unused.length) console.log('kullanılmayan: ' + unused.slice(0, 20).join(', '));
if (errors) { console.error(`${errors} hata`); process.exit(1); }
console.log('i18n denetimi tamam: tr/en/de aynı anahtarlar, boş değer yok.');
