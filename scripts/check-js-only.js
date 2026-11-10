#!/usr/bin/env node
// OTA (expo-updates) yalnızca JS/asset değişikliklerini taşır. BASE..HEAD arasında native'i etkileyen bir
// değişiklik varsa çıkış kodu 1 ile biter. BASE: 1. argüman / env BASE / son v* etiketi / HEAD~1.
const { execSync } = require('child_process');
const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64e6 }).trim(); } catch { return ''; } };

const base = process.argv[2] || process.env.BASE || sh('git describe --tags --abbrev=0 --match "v*"') || 'HEAD~1';
const problems = [];

const files = sh(`git diff --name-only ${base} HEAD`).split('\n').filter(Boolean);
const NATIVE_PATH = [/^android\//, /^ios\//, /^modules\/[^/]+\/(android|ios)\//, /^plugins\//, /^modules\/[^/]+\/(expo-module\.config\.json|package\.json)$/, /^eas\.json$/];
for (const f of files) if (NATIVE_PATH.some((r) => r.test(f))) problems.push(`native yol değişti: ${f}`);

const show = (f) => { try { return JSON.parse(sh(`git show ${base}:${f}`) || 'null'); } catch { return null; } };
const cur = (f) => { try { return JSON.parse(require('fs').readFileSync(f, 'utf8')); } catch { return null; } };

// app.json: extra/updates dışındaki her expo anahtarı native sayılır (version -> runtimeVersion'ı da değiştirir).
if (files.includes('app.json')) {
  const strip = (j) => { const e = { ...((j && j.expo) || {}) }; delete e.extra; delete e.updates; return e; };
  const a = strip(show('app.json')), b = strip(cur('app.json'));
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) problems.push(`app.json expo.${k} değişti`);
  }
}

// package.json: yalnızca saf-JS paketlerin değişmesine izin verilir.
const PURE_JS = new Set(['highlight.js', 'jszip', 'marked', 'pdf-lib', 'xss', 'xlsx', 'pdfjs-dist', 'typescript', '@types/react', '@types/jszip', '@types/highlight.js', '@babel/core']);
if (files.includes('package.json')) {
  const a = show('package.json') || {}, b = cur('package.json') || {};
  for (const sec of ['dependencies', 'devDependencies']) {
    const x = a[sec] || {}, y = b[sec] || {};
    for (const n of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (x[n] !== y[n] && !PURE_JS.has(n)) problems.push(`package.json ${sec}.${n}: ${x[n] || '-'} -> ${y[n] || '-'}`);
    }
  }
}

if (problems.length) {
  console.error(`JS-only denetimi BAŞARISIZ (taban: ${base}). Native build gerekli (git tag vX.Y.Z -> release.yml):`);
  problems.forEach((p) => console.error(' - ' + p));
  process.exit(1);
}
console.log(`JS-only denetimi geçti (taban: ${base}, ${files.length} dosya).`);
