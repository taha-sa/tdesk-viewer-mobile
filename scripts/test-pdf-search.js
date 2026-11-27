#!/usr/bin/env node
// PDF arama/koordinat cekirdegi (scripts/pdfjs/searchCore.js) ve webSearch.ts birim testleri.
// Calistirma: node scripts/test-pdf-search.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const SC = require('./pdfjs/searchCore.js');

const approx = (a, b, eps = 0.05, msg = '') => {
  assert(Math.abs(a - b) <= eps, `${msg}: beklenen ${b} +- ${eps}, gelen ${a}`);
};

// Basit sabit genislikli olcum (her karakter 10px)
const monoMeasure = (s) => (s ? s.length * 10 : 0);

// Ornek A4 scale=1 viewport donusumu: [1, 0, 0, -1, 0, 842] (y-ekseni ters)
const V0_A4 = [1, 0, 0, -1, 0, 842];

// 1. Turkce + Ingilizce buyuk/kucuk harf uyumu ve kır/kir ayrimi
{
  const tc = {
    styles: { f1: { fontFamily: 'sans-serif', ascent: 0.8, descent: -0.2 } },
    items: [
      { str: 'İstanbul IŞIK Information kır kir çalışma BİLGİSAYAR', transform: [12, 0, 0, 12, 50, 742], width: 300, height: 12, fontName: 'f1', hasEOL: true }
    ]
  };
  const idx = SC.buildPageIndex(tc, V0_A4);

  assert.strictEqual(SC.searchPage(idx, SC.foldQuery('istanbul'), monoMeasure).length, 1, 'İ -> i');
  assert.strictEqual(SC.searchPage(idx, SC.foldQuery('İSTANBUL'), monoMeasure).length, 1, 'İSTANBUL');
  assert.strictEqual(SC.searchPage(idx, SC.foldQuery('ışık'), monoMeasure).length, 1, 'I -> ı');
  assert.strictEqual(SC.searchPage(idx, SC.foldQuery('information'), monoMeasure).length, 1, 'English I -> i');
  assert.strictEqual(SC.searchPage(idx, SC.foldQuery('kır'), monoMeasure).length, 1, 'kır eslesir');
  assert.strictEqual(SC.searchPage(idx, SC.foldQuery('kir'), monoMeasure).length, 1, 'kir yalniz kir ile eslesir');
  assert.strictEqual(SC.searchPage(idx, SC.foldQuery('ÇALIŞMA'), monoMeasure).length, 1, 'ÇALIŞMA -> çalışma');
  assert.strictEqual(SC.searchPage(idx, SC.foldQuery('bilgisayar'), monoMeasure).length, 1, 'BİLGİSAYAR -> bilgisayar');

  // Birlesik nokta (I + \u0307) testi
  const tcDecomp = {
    styles: { f1: { fontFamily: 'sans-serif', ascent: 0.8, descent: -0.2 } },
    items: [
      { str: 'I\u0307stanbul', transform: [12, 0, 0, 12, 50, 742], width: 80, height: 12, fontName: 'f1', hasEOL: false }
    ]
  };
  const idxD = SC.buildPageIndex(tcDecomp, V0_A4);
  assert.strictEqual(SC.searchPage(idxD, SC.foldQuery('istanbul'), monoMeasure).length, 1, 'decomposed İ');
  assert.strictEqual(SC.searchPage(idxD, SC.foldQuery('ıstanbul'), monoMeasure).length, 0, 'decomposed İ != ı');
}

// 2. Kerning/font ile bolunmus kelimeler tek dikdortgende birlesmeli
{
  const tc = {
    styles: { f1: { fontFamily: 'sans-serif', ascent: 0.8, descent: -0.2 } },
    items: [
      { str: 'T', transform: [12, 0, 0, 12, 50, 742], width: 8, height: 12, fontName: 'f1', hasEOL: false },
      { str: 'ür', transform: [12, 0, 0, 12, 58, 742], width: 14, height: 12, fontName: 'f1', hasEOL: false },
      { str: 'kiye', transform: [12, 0, 0, 12, 72, 742], width: 24, height: 12, fontName: 'f1', hasEOL: false }
    ]
  };
  const idx = SC.buildPageIndex(tc, V0_A4);
  const hits = SC.searchPage(idx, SC.foldQuery('türkiye'), monoMeasure);
  assert.strictEqual(hits.length, 1, 'bolunmus kelime bulundu');
  assert.strictEqual(hits[0].rects.length, 1, 'ayni satirdaki parcalar tek kutuda birlesti');
  approx(hits[0].rects[0].x, 50, 0.05, 'x');
  approx(hits[0].rects[0].w, 46, 0.05, 'birlesik genislik');
  approx(hits[0].rects[0].y, 100 - 12 * 0.8, 0.05, 'y (baseline 100 - ascent)');
  approx(hits[0].rects[0].h, 12, 0.05, 'h (ascent + descent)');
}

// 3. Cok kelimeli ifade ve satir sonu (bos hasEOL ogesi dahil)
{
  const tc = {
    styles: { f1: { fontFamily: 'sans-serif', ascent: 0.85, descent: -0.2 } },
    items: [
      { str: 'T-Desk', transform: [10, 0, 0, 10, 40, 742], width: 40, height: 10, fontName: 'f1', hasEOL: false },
      { str: '', transform: [10, 0, 0, 10, 80, 742], width: 0, height: 10, fontName: 'f1', hasEOL: true },
      { str: 'Viewer', transform: [10, 0, 0, 10, 40, 726], width: 38, height: 10, fontName: 'f1', hasEOL: true }
    ]
  };
  const idx = SC.buildPageIndex(tc, V0_A4);
  const hits = SC.searchPage(idx, SC.foldQuery('t-desk viewer'), monoMeasure);
  assert.strictEqual(hits.length, 1, 'satirlar arasi cok kelimeli eslesme');
  assert.strictEqual(hits[0].rects.length, 2, 'iki satir -> iki ayri kutu');
  approx(hits[0].rects[0].w, 40, 0.05, 'satir 1 genislik');
  approx(hits[0].rects[1].w, 38, 0.05, 'satir 2 genislik');
  assert(hits[0].rects[1].y > hits[0].rects[0].y + 10, 'ikinci kutu altta');
}

// 4. Alt-oge (parca) konumu: "kelime" uzun bir cumlenin ortasinda
{
  const tc = {
    styles: { f1: { fontFamily: 'sans-serif', ascent: 0.8, descent: -0.2 } },
    items: [
      { str: '0123456789', transform: [10, 0, 0, 10, 100, 742], width: 100, height: 10, fontName: 'f1', hasEOL: false }
    ]
  };
  const idx = SC.buildPageIndex(tc, V0_A4);
  const hits = SC.searchPage(idx, SC.foldQuery('345'), monoMeasure);
  assert.strictEqual(hits.length, 1);
  approx(hits[0].rects[0].x, 130, 0.05, 'sub-item x = 100 + 0.3 * 100');
  approx(hits[0].rects[0].w, 30, 0.05, 'sub-item w = 0.3 * 100');
}

// 5. 90 derece dondurulmus sayfa geometrisi
{
  // 90 derece saat yonunde donmus viewport: x_css = y_pdf, y_css = x_pdf
  const V0_ROT90 = [0, 1, 1, 0, 0, 0];
  const tc = {
    styles: { f1: { fontFamily: 'sans-serif', ascent: 0.8, descent: -0.2 } },
    items: [
      { str: 'Dikey', transform: [12, 0, 0, 12, 100, 200], width: 50, height: 12, fontName: 'f1', hasEOL: false }
    ]
  };
  const idx = SC.buildPageIndex(tc, V0_ROT90);
  const hits = SC.searchPage(idx, SC.foldQuery('dikey'), monoMeasure);
  assert.strictEqual(hits.length, 1, 'dondurulmus sayfada bulundu');
  approx(hits[0].rects[0].angle, Math.PI / 2, 0.01, '90 derece aci');
  approx(hits[0].rects[0].w, 50, 0.05, 'genislik korundu');
}

// 6. webSearch.ts betiginde sentaks + Turkce karakter destegi denetimi
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'webSearch.ts'), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', out)(mod, mod.exports);
  const script = mod.exports.searchScript('find', 'İstanbul');
  // Sentaks kontrolu (Node Function parse)
  assert.doesNotThrow(() => new Function(script), 'webSearch script valid JS');
  assert(!script.includes('if (l.length !== d.length) continue'), 'eski atlama hatasi yok');
  assert.deepStrictEqual(mod.exports.parseSearchMessage(JSON.stringify({ t: 'tdsearch', count: 3, index: 1 })), { count: 3, index: 1 });
}

console.log('pdf-search & webSearch tests OK');
