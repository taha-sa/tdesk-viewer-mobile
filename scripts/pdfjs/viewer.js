/* T-Desk pdf.js görüntüleyici (WebView içinde çalışır). React Native tarafı window.__pdf.* ile sürer,
   sonuçlar window.ReactNativeWebView.postMessage ile döner. Yalnızca metin içeren PDF'lerde arama yapar. */
(function () {
  'use strict';
  var RN = window.ReactNativeWebView;
  function post(o) { try { RN.postMessage(JSON.stringify(o)); } catch (e) { /* köprü yok */ } }
  var pdfjs = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
  var root = document.getElementById('pages');
  var S = {
    doc: null, n: 0, z: 1, fit: 1, quality: 1, buf: null, pw: null,
    pages: [], pwCb: null, sToken: 0, results: [], byPage: {}, cur: -1, q: '', scanning: false,
    loadedW: 0
  };
  var MAX_Z = 6, MIN_Z = 1, PAD = 16;

  function lc(s) { try { return s.toLocaleLowerCase('tr-TR'); } catch (e) { return s.toLowerCase(); } }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  // ---------- Sayfa düzeni ----------
  function pageCssSize(p) { var s = S.fit * S.z; return { w: p.pw * s, h: p.ph * s }; }

  function sizeWrapper(p) {
    var sz = pageCssSize(p);
    var oldH = p.div.offsetHeight;
    p.div.style.width = sz.w + 'px';
    p.div.style.height = sz.h + 'px';
    if (p.div.offsetTop + oldH <= window.scrollY && oldH && Math.abs(sz.h - oldH) > 1) {
      window.scrollBy(0, sz.h - oldH); // üstteki sayfa boyutu değişti: görünen yer kaymasın
    }
  }

  function buildPages() {
    root.innerHTML = '';
    S.pages = [];
    for (var i = 1; i <= S.n; i++) {
      var d = el('div', 'page');
      d.setAttribute('data-n', String(i));
      var p = { num: i, div: d, pw: S.pw1, ph: S.ph1, canvas: null, layer: null, divs: [], strs: [], rendered: false, rendering: false, token: 0, visible: false, pending: -1 };
      S.pages.push(p);
      root.appendChild(d);
      sizeWrapper(p);
    }
    observe();
  }

  var io = null;
  function observe() {
    if (io) io.disconnect();
    if (typeof IntersectionObserver === 'undefined') { S.pages.forEach(function (p) { p.visible = true; }); pump(); return; }
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var p = S.pages[Number(en.target.getAttribute('data-n')) - 1];
        if (!p) return;
        p.visible = en.isIntersecting;
        if (!en.isIntersecting && p.rendered) release(p);
      });
      pump();
    }, { rootMargin: '120% 0px 120% 0px' });
    S.pages.forEach(function (p) { io.observe(p.div); });
  }

  function release(p) {
    p.token++; // sürmekte olan çizimi iptal et
    if (p.canvas && p.canvas.parentNode) p.canvas.parentNode.removeChild(p.canvas);
    if (p.layer && p.layer.parentNode) p.layer.parentNode.removeChild(p.layer);
    p.canvas = null; p.layer = null; p.divs = []; p.strs = []; p.rendered = false; p.rendering = false;
    clearMarkRefs(p.num);
  }

  var active = 0, MAX_ACTIVE = 2;
  function pump() {
    if (!S.doc) return;
    for (var i = 0; i < S.pages.length && active < MAX_ACTIVE; i++) {
      var p = S.pages[i];
      if (p.visible && !p.rendered && !p.rendering) renderPage(p);
    }
  }

  function renderPage(p) {
    p.rendering = true; active++;
    var token = ++p.token;
    var finish = function () { if (token === p.token) p.rendering = false; active = Math.max(0, active - 1); pump(); };
    S.doc.getPage(p.num).then(function (page) {
      if (token !== p.token) return;
      var v0 = page.getViewport({ scale: 1 });
      if (Math.abs(v0.width - p.pw) > 0.5 || Math.abs(v0.height - p.ph) > 0.5) { p.pw = v0.width; p.ph = v0.height; sizeWrapper(p); }
      var vp = page.getViewport({ scale: S.fit * S.z });
      var out = Math.min(window.devicePixelRatio || 1, 3) * S.quality;
      var maxPx = 14e6;
      if (vp.width * vp.height * out * out > maxPx) out = Math.sqrt(maxPx / (vp.width * vp.height));
      var canvas = el('canvas');
      canvas.width = Math.max(1, Math.floor(vp.width * out));
      canvas.height = Math.max(1, Math.floor(vp.height * out));
      canvas.style.width = vp.width + 'px';
      canvas.style.height = vp.height + 'px';
      var ctx = canvas.getContext('2d', { alpha: false });
      var task = page.render({ canvasContext: ctx, viewport: vp, transform: out !== 1 ? [out, 0, 0, out, 0, 0] : null, background: 'rgb(255,255,255)' });
      return task.promise.then(function () {
        if (token !== p.token) return;
        if (p.canvas && p.canvas.parentNode) p.canvas.parentNode.removeChild(p.canvas);
        p.canvas = canvas;
        p.div.insertBefore(canvas, p.div.firstChild);
        return page.getTextContent().then(function (tc) {
          if (token !== p.token) return;
          var layer = el('div', 'textLayer');
          layer.style.setProperty('--scale-factor', String(vp.scale));
          layer.style.width = vp.width + 'px';
          layer.style.height = vp.height + 'px';
          p.div.appendChild(layer);
          var divs = [], strs = [];
          var tl = pdfjs.renderTextLayer({ textContentSource: tc, container: layer, viewport: vp, textDivs: divs, textContentItemsStr: strs });
          return tl.promise.then(function () {
            if (token !== p.token) { if (layer.parentNode) layer.parentNode.removeChild(layer); return; }
            if (p.layer && p.layer.parentNode) p.layer.parentNode.removeChild(p.layer);
            p.layer = layer; p.divs = divs; p.strs = strs; p.rendered = true;
            applyHighlights(p);
          });
        });
      });
    }).catch(function (e) {
      if (token === p.token) post({ t: 'pageerror', page: p.num, message: String(e && e.message || e) });
    }).then(finish, finish);
  }

  function relayoutAll(anchor) {
    S.pages.forEach(function (p) { sizeWrapper(p); if (p.rendered || p.rendering) release(p); });
    if (anchor) restoreAnchor(anchor);
    if (io) { io.disconnect(); observe(); } else pump();
  }

  // ---------- Kaydırma / sayfa takibi ----------
  function currentPage() {
    var mid = window.scrollY + window.innerHeight / 2;
    var lo = 0, hi = S.pages.length - 1, ans = 0;
    while (lo <= hi) {
      var m = (lo + hi) >> 1, d = S.pages[m].div;
      if (d.offsetTop <= mid) { ans = m; lo = m + 1; } else hi = m - 1;
    }
    return ans + 1;
  }
  function captureAnchor() {
    var n = currentPage(), p = S.pages[n - 1];
    if (!p) return null;
    var h = p.div.offsetHeight || 1;
    return { n: n, frac: clamp((window.scrollY - p.div.offsetTop) / h, -1, 2) };
  }
  function restoreAnchor(a) {
    var p = S.pages[a.n - 1];
    if (p) window.scrollTo(window.scrollX, p.div.offsetTop + a.frac * p.div.offsetHeight);
  }
  var lastPosted = 0, scrollTimer = null;
  function onScroll() {
    if (scrollTimer) return;
    scrollTimer = setTimeout(function () {
      scrollTimer = null;
      if (!S.doc) return;
      var n = currentPage();
      if (n !== lastPosted) { lastPosted = n; post({ t: 'page', n: n }); }
    }, 120);
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  // Yakınlaştırma (çimdik) sonrası netleştirme: görünür sayfaları daha yüksek çözünürlükte yeniden çiz.
  var vvTimer = null;
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () {
      if (vvTimer) clearTimeout(vvTimer);
      vvTimer = setTimeout(function () {
        var q = clamp(window.visualViewport.scale || 1, 1, 4);
        if (Math.abs(q - S.quality) > 0.25) {
          S.quality = q;
          S.pages.forEach(function (p) { if (p.rendered) release(p); });
          pump();
        }
      }, 250);
    });
  }
  var rzTimer = null;
  window.addEventListener('resize', function () {
    if (!S.doc) return;
    if (rzTimer) clearTimeout(rzTimer);
    rzTimer = setTimeout(function () {
      var w = window.innerWidth;
      if (Math.abs(w - S.loadedW) < 20) return;
      var a = captureAnchor();
      S.loadedW = w;
      S.fit = (w - PAD) / S.pw1;
      relayoutAll(a);
    }, 250);
  });

  // ---------- Arama işaretleri ----------
  function clearMarkRefs(num) {
    (S.byPage[num] || []).forEach(function (i) { if (S.results[i]) S.results[i].el = null; });
  }
  function unwrapAllMarks() {
    var ms = document.querySelectorAll('mark.tdh');
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i], par = m.parentNode;
      if (!par) continue;
      par.replaceChild(document.createTextNode(m.textContent), m);
      par.normalize();
    }
    S.results.forEach(function (r) { r.el = null; });
  }
  function applyHighlights(p) {
    var idxs = S.byPage[p.num];
    if (!idxs || !idxs.length || !p.divs.length) return;
    // aynı öğedeki eşleşmeleri sondan başa işle (kayma olmasın)
    var order = idxs.slice().sort(function (a, b) {
      var ra = S.results[a], rb = S.results[b];
      return ra.item !== rb.item ? rb.item - ra.item : rb.start - ra.start;
    });
    order.forEach(function (ri) {
      var r = S.results[ri], d = p.divs[r.item];
      if (!d || r.el) return;
      var tn = d.firstChild;
      if (!tn || tn.nodeType !== 3 || r.start + r.len > tn.data.length) return;
      var mid = tn.splitText(r.start);
      mid.splitText(r.len);
      var mk = el('mark', 'tdh');
      d.replaceChild(mk, mid);
      mk.appendChild(mid);
      r.el = mk;
    });
    if (S.cur >= 0 && S.results[S.cur] && S.results[S.cur].page === p.num) markCurrent(true);
  }
  function markCurrent(scroll) {
    S.results.forEach(function (r, i) { if (r.el) r.el.className = 'tdh' + (i === S.cur ? ' tdc' : ''); });
    var r = S.results[S.cur];
    if (scroll && r && r.el) {
      try { r.el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { /* eski WebView */ }
    }
  }
  function goToResult(i) {
    if (!S.results.length) return;
    S.cur = (i + S.results.length) % S.results.length;
    var r = S.results[S.cur], p = S.pages[r.page - 1];
    if (r.el) { markCurrent(true); }
    else if (p) {
      // sayfaya git; çizilince applyHighlights işareti bulup kaydırır
      window.scrollTo(window.scrollX, p.div.offsetTop);
      markCurrent(false);
      pump();
    }
    postSearch(false);
  }
  function postSearch(done) {
    post({ t: 'search', count: S.results.length, index: S.cur, scanned: S.scanned || 0, total: S.n, done: !!done });
  }
  function clearSearch() {
    S.sToken++; S.results = []; S.byPage = {}; S.cur = -1; S.q = ''; S.scanned = 0;
    unwrapAllMarks();
  }

  function search(query) {
    clearSearch();
    query = String(query || '').trim();
    if (!query || !S.doc) { postSearch(true); return; }
    S.q = query;
    var token = S.sToken, ql = lc(query);
    S.scanned = 0;
    (async function () {
      for (var i = 1; i <= S.n; i++) {
        if (token !== S.sToken) return;
        var page = await S.doc.getPage(i);
        var tc = await page.getTextContent();
        if (token !== S.sToken) return;
        var k = 0;
        for (var j = 0; j < tc.items.length; j++) {
          var it = tc.items[j];
          if (it.str === undefined) continue; // renderTextLayer da bunları atlar
          var s = it.str, l = lc(s);
          if (l.length !== s.length) l = s.toLowerCase();
          if (l.length === s.length && l.length >= ql.length) {
            var at = l.indexOf(ql);
            while (at >= 0) {
              var idx = S.results.length;
              S.results.push({ page: i, item: k, start: at, len: ql.length, el: null });
              (S.byPage[i] = S.byPage[i] || []).push(idx);
              at = l.indexOf(ql, at + ql.length);
            }
          }
          k++;
        }
        try { page.cleanup(); } catch (e) { /* önemsiz */ }
        S.scanned = i;
        var rp = S.pages[i - 1];
        if (rp && rp.rendered) applyHighlights(rp);
        if (S.cur < 0 && S.results.length) goToResult(0);
        if (i % 4 === 0 || i === S.n) { postSearch(i === S.n); await new Promise(function (r) { setTimeout(r, 0); }); }
      }
      if (token === S.sToken) postSearch(true);
    })().catch(function (e) { post({ t: 'error', name: 'SearchError', message: String(e && e.message || e) }); });
  }

  // ---------- Belge açma ----------
  function openDoc(password) {
    if (!pdfjs) { post({ t: 'error', name: 'NoEngine', message: 'pdf.js yüklenemedi.' }); return; }
    try {
      var blob = new Blob([document.getElementById('pdfworker').textContent], { type: 'text/javascript' });
      pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    } catch (e) { /* sahte worker'a düşer */ }
    var task = pdfjs.getDocument({ data: S.buf, password: password || undefined, isEvalSupported: false, useSystemFonts: true, disableAutoFetch: true, disableStream: true });
    task.onPassword = function (cb, reason) { S.pwCb = cb; post({ t: 'password', reason: reason }); };
    task.onProgress = function (p) { if (p && p.total) post({ t: 'progress', loaded: p.loaded, total: p.total }); };
    task.promise.then(function (doc) {
      S.doc = doc; S.n = doc.numPages;
      return doc.getPage(1).then(function (page) {
        var v = page.getViewport({ scale: 1 });
        S.pw1 = v.width; S.ph1 = v.height;
        S.loadedW = window.innerWidth;
        S.fit = (window.innerWidth - PAD) / S.pw1;
        buildPages();
        var m = document.getElementById('msg'); if (m) m.remove();
        post({ t: 'loaded', pages: S.n });
        pump();
        // gerçek sayfa boyutlarını arka planda öğren (farklı boyutlu sayfalar için)
        var i = 2;
        (function step() {
          var end = Math.min(S.n, i + 8);
          var jobs = [];
          for (; i <= end; i++) (function (num) {
            jobs.push(doc.getPage(num).then(function (pg) {
              var vv = pg.getViewport({ scale: 1 }), pp = S.pages[num - 1];
              if (pp && (Math.abs(vv.width - pp.pw) > 0.5 || Math.abs(vv.height - pp.ph) > 0.5)) { pp.pw = vv.width; pp.ph = vv.height; sizeWrapper(pp); }
              try { pg.cleanup(); } catch (e) { /* önemsiz */ }
            }).catch(function () { /* boyut öğrenilemedi */ }));
          })(i);
          Promise.all(jobs).then(function () { if (i <= S.n) setTimeout(step, 0); });
        })();
      });
    }).catch(function (e) {
      if (e && e.name === 'PasswordException') return; // onPassword akışı yönetir
      post({ t: 'error', name: String(e && e.name || 'Error'), message: String(e && e.message || e) });
    });
  }

  function zoomTo(z) {
    if (!S.doc) return;
    z = clamp(z, MIN_Z, MAX_Z);
    if (Math.abs(z - S.z) < 0.01) return;
    var a = captureAnchor();
    S.z = z;
    relayoutAll(a);
    post({ t: 'zoom', z: S.z });
  }

  window.__pdf = {
    begin: function (total) { S.buf = new Uint8Array(total); post({ t: 'ack', off: 0 }); },
    chunk: function (off, b64) {
      var bin = atob(b64), n = bin.length;
      for (var i = 0; i < n; i++) S.buf[off + i] = bin.charCodeAt(i);
      post({ t: 'ack', off: off + n });
    },
    open: function (pw) { openDoc(pw); },
    pw: function (text) { if (S.pwCb) { var cb = S.pwCb; S.pwCb = null; cb(text); } },
    goto: function (n) {
      var p = S.pages[clamp(Math.floor(n), 1, S.n) - 1];
      if (p) { window.scrollTo(window.scrollX, p.div.offsetTop); lastPosted = 0; onScroll(); pump(); }
    },
    zoomBy: function (f) { zoomTo(S.z * f); },
    zoomReset: function () { zoomTo(1); },
    search: search,
    next: function () { goToResult(S.cur + 1); },
    prev: function () { goToResult(S.cur - 1); },
    clear: function () { clearSearch(); postSearch(true); },
    _state: S // testler için
  };
  post({ t: 'ready' });
})();
