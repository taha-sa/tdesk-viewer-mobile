/* T-Desk pdf.js görüntüleyici (WebView içinde çalışır). React Native tarafı window.__pdf.* ile sürer,
   sonuçlar window.ReactNativeWebView.postMessage ile döner. Yalnızca metin içeren PDF'lerde arama yapar. */
(function () {
  'use strict';
  var RN = window.ReactNativeWebView;
  function post(o) { try { RN.postMessage(JSON.stringify(o)); } catch (e) { /* köprü yok */ } }
  var pdfjs = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
  var SC = window.__pdfSearchCore;
  var root = document.getElementById('pages');
  var S = {
    doc: null, n: 0, z: 1, fit: 1, quality: 1, buf: null, pw: null,
    pages: [], pwCb: null, sToken: 0, results: [], byPage: {}, cur: -1, q: '', scanned: 0,
    loadedW: 0, textCache: {}
  };
  var MAX_Z = 6, MIN_Z = 1, PAD = 16;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  // Tek bir offscreen canvas ile alt-metin genisligi olcumu (WebView 8px minimumFontSize etkisinden bagimsiz)
  var mCtx = null, mLastFont = '';
  function measureText(str, fontFamily) {
    if (!str) return 0;
    if (!mCtx) {
      var c = document.createElement('canvas');
      mCtx = c.getContext('2d');
    }
    if (!mCtx) return 0;
    var f = '32px ' + (fontFamily || 'sans-serif');
    if (mLastFont !== f) { mCtx.font = f; mLastFont = f; }
    return mCtx.measureText(str).width;
  }

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
      var p = {
        num: i, div: d, pw: S.pw1, ph: S.ph1,
        canvas: null, layer: null, hlLayer: null,
        rendered: false, rendering: false, token: 0, visible: false
      };
      S.pages.push(p);
      root.appendChild(d);
      sizeWrapper(p);
    }
    observe();
  }

  var io = null;
  function observe() {
    if (io) io.disconnect();
    if (typeof IntersectionObserver === 'undefined') {
      S.pages.forEach(function (p) { p.visible = true; renderHighlights(p); });
      pump();
      return;
    }
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var p = S.pages[Number(en.target.getAttribute('data-n')) - 1];
        if (!p) return;
        p.visible = en.isIntersecting;
        if (en.isIntersecting) {
          if (S.byPage[p.num] && S.byPage[p.num].length && !p.hlLayer) renderHighlights(p);
        } else if (p.rendered || p.hlLayer) {
          release(p);
        }
      });
      pump();
    }, { rootMargin: '120% 0px 120% 0px' });
    S.pages.forEach(function (p) { io.observe(p.div); });
  }

  function clearPageHighlights(p) {
    if (p.hlLayer && p.hlLayer.parentNode) p.hlLayer.parentNode.removeChild(p.hlLayer);
    p.hlLayer = null;
    var idxs = S.byPage[p.num];
    if (idxs) {
      for (var i = 0; i < idxs.length; i++) {
        var r = S.results[idxs[i]];
        if (r) r.els = null;
      }
    }
  }

  function release(p) {
    p.token++; // sürmekte olan çizimi iptal et
    if (p.canvas && p.canvas.parentNode) p.canvas.parentNode.removeChild(p.canvas);
    if (p.layer && p.layer.parentNode) p.layer.parentNode.removeChild(p.layer);
    clearPageHighlights(p);
    p.canvas = null; p.layer = null; p.rendered = false; p.rendering = false;
  }

  // Yeniden çizim gerekiyor ama eski görüntü yeni hazır olana kadar KALIR (beyaz flaş olmasın).
  // stretch: yakınlaştırmada eski canvas yeni boyuta CSS ile gerilir (kısa süre bulanık, ama beyaz değil).
  function markStale(p, stretch) {
    if (!p.visible) { release(p); return; }
    p.token++;              // sürmekte olan çizimi iptal et
    p.rendering = false;
    p.rendered = false;
    if (p.layer && p.layer.parentNode) p.layer.parentNode.removeChild(p.layer); // metin katmanı ölçeğe bağlı; yenisi gelecek
    p.layer = null;
    if (stretch && p.canvas) {
      var sz = pageCssSize(p);
      p.canvas.style.width = sz.w + 'px';
      p.canvas.style.height = sz.h + 'px';
    }
    if (S.byPage[p.num] && S.byPage[p.num].length) renderHighlights(p);
  }

  var active = 0, MAX_ACTIVE = 2;
  function pump() {
    if (!S.doc) return;
    for (var i = 0; i < S.pages.length && active < MAX_ACTIVE; i++) {
      var p = S.pages[i];
      if (p.visible && !p.rendered && !p.rendering) renderPage(p);
    }
  }

  function cachePageText(pageNum, tc, v0Transform) {
    if (!S.textCache[pageNum] && SC) {
      S.textCache[pageNum] = SC.buildPageIndex(tc, v0Transform, pdfjs.Util && pdfjs.Util.transform);
    }
    return S.textCache[pageNum];
  }

  function renderPage(p) {
    p.rendering = true; active++;
    var token = ++p.token;
    var finish = function () { if (token === p.token) p.rendering = false; active = Math.max(0, active - 1); pump(); };
    S.doc.getPage(p.num).then(function (page) {
      if (token !== p.token) return;
      var v0 = page.getViewport({ scale: 1 });
      if (Math.abs(v0.width - p.pw) > 0.5 || Math.abs(v0.height - p.ph) > 0.5) {
        p.pw = v0.width; p.ph = v0.height; sizeWrapper(p);
      }
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
        if (S.byPage[p.num] && S.byPage[p.num].length && !p.hlLayer) renderHighlights(p);
        return page.getTextContent().then(function (tc) {
          if (token !== p.token) return;
          cachePageText(p.num, tc, v0.transform);
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
            p.layer = layer; p.rendered = true;
          });
        });
      });
    }).catch(function (e) {
      if (token === p.token) post({ t: 'pageerror', page: p.num, message: String(e && e.message || e) });
    }).then(finish, finish);
  }

  function relayoutAll(anchor) {
    S.pages.forEach(function (p) {
      sizeWrapper(p);
      if (p.rendered || p.rendering || p.canvas) markStale(p, true);
      else if (p.visible && S.byPage[p.num] && S.byPage[p.num].length) renderHighlights(p);
    });
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
          S.pages.forEach(function (p) { if (p.rendered) markStale(p, false); });
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

  // ---------- PDF koordinatli arama isaretleri (.highlightLayer) ----------
  function clearAllHighlights() {
    for (var i = 0; i < S.pages.length; i++) {
      var p = S.pages[i];
      if (p.hlLayer && p.hlLayer.parentNode) p.hlLayer.parentNode.removeChild(p.hlLayer);
      p.hlLayer = null;
    }
    for (var j = 0; j < S.results.length; j++) S.results[j].els = null;
  }

  function renderHighlights(p) {
    clearPageHighlights(p);
    var idxs = S.byPage[p.num];
    if (!idxs || !idxs.length) return;
    var scale = S.fit * S.z;
    var padX = clamp(scale * 1.2, 0.8, 2);
    var padY = clamp(scale * 0.7, 0.4, 1.5);
    var layer = el('div', 'highlightLayer');
    var frag = document.createDocumentFragment();
    for (var i = 0; i < idxs.length; i++) {
      var ri = idxs[i];
      var r = S.results[ri];
      if (!r || !r.rects || !r.rects.length) continue;
      var isCur = ri === S.cur;
      var els = [];
      for (var k = 0; k < r.rects.length; k++) {
        var rc = r.rects[k];
        var d = el('div', isCur ? 'hl hl-cur' : 'hl');
        if (rc.angle === 0) {
          d.style.left = (rc.x * scale - padX).toFixed(2) + 'px';
          d.style.top = (rc.y * scale - padY).toFixed(2) + 'px';
          d.style.width = Math.max(2, rc.w * scale + padX * 2).toFixed(2) + 'px';
          d.style.height = Math.max(4, rc.h * scale + padY * 2).toFixed(2) + 'px';
        } else {
          d.style.left = (rc.x * scale).toFixed(2) + 'px';
          d.style.top = (rc.y * scale).toFixed(2) + 'px';
          d.style.width = Math.max(2, rc.w * scale).toFixed(2) + 'px';
          d.style.height = Math.max(4, rc.h * scale).toFixed(2) + 'px';
          d.style.transform = 'rotate(' + (rc.angle * 180 / Math.PI).toFixed(2) + 'deg)';
        }
        frag.appendChild(d);
        els.push(d);
      }
      r.els = els;
    }
    layer.appendChild(frag);
    if (p.layer && p.layer.parentNode === p.div) p.div.insertBefore(layer, p.layer);
    else p.div.appendChild(layer);
    p.hlLayer = layer;
  }

  function setActiveClass(prevCur, nextCur) {
    if (prevCur >= 0 && S.results[prevCur] && S.results[prevCur].els) {
      var prevEls = S.results[prevCur].els;
      for (var i = 0; i < prevEls.length; i++) prevEls[i].className = 'hl';
    }
    if (nextCur >= 0 && S.results[nextCur] && S.results[nextCur].els) {
      var nextEls = S.results[nextCur].els;
      for (var j = 0; j < nextEls.length; j++) nextEls[j].className = 'hl hl-cur';
    }
  }

  function scrollToResult(r) {
    if (!r) return;
    var p = S.pages[r.page - 1];
    if (!p) return;
    if (!r.els || !r.els.length) renderHighlights(p);
    var target = r.els && r.els[0];
    if (target) {
      try {
        target.scrollIntoView({ block: 'center', inline: 'center' });
      } catch (e) {
        var scale = S.fit * S.z;
        var y = p.div.offsetTop + (r.rects[0] ? r.rects[0].y * scale : 0) - window.innerHeight * 0.4;
        window.scrollTo(window.scrollX, Math.max(0, y));
      }
    } else {
      window.scrollTo(window.scrollX, p.div.offsetTop);
    }
    pump();
  }

  function goToResult(i) {
    if (!S.results.length) return;
    var prev = S.cur;
    S.cur = (i + S.results.length) % S.results.length;
    var r = S.results[S.cur];
    var p = S.pages[r.page - 1];
    if (p && !p.hlLayer) renderHighlights(p);
    setActiveClass(prev, S.cur);
    scrollToResult(r);
    postSearch(false);
  }

  function postSearch(done) {
    post({ t: 'search', count: S.results.length, index: S.cur, scanned: S.scanned || 0, total: S.n, done: !!done });
  }

  function clearSearch() {
    S.sToken++;
    clearAllHighlights();
    S.results = [];
    S.byPage = {};
    S.cur = -1;
    S.q = '';
    S.scanned = 0;
  }

  function rebuildResults(byPageMatches, activeRef) {
    var results = [];
    var byPage = {};
    var nextCur = -1;
    for (var p = 1; p <= S.n; p++) {
      var list = byPageMatches[p];
      if (!list || !list.length) continue;
      var idxs = [];
      for (var j = 0; j < list.length; j++) {
        var m = list[j];
        var idx = results.length;
        results.push(m);
        idxs.push(idx);
        if (m === activeRef) nextCur = idx;
      }
      byPage[p] = idxs;
    }
    S.results = results;
    S.byPage = byPage;
    S.cur = nextCur;
  }

  function getPageIndex(pageNum) {
    var cached = S.textCache[pageNum];
    if (cached) return Promise.resolve(cached);
    return S.doc.getPage(pageNum).then(function (page) {
      var v0 = page.getViewport({ scale: 1 });
      var pp = S.pages[pageNum - 1];
      if (pp && (Math.abs(v0.width - pp.pw) > 0.5 || Math.abs(v0.height - pp.ph) > 0.5)) {
        pp.pw = v0.width; pp.ph = v0.height; sizeWrapper(pp);
      }
      return page.getTextContent().then(function (tc) {
        var idx = cachePageText(pageNum, tc, v0.transform);
        if (!pp || (!pp.visible && !pp.rendering)) {
          try { page.cleanup(); } catch (e) { /* onemsiz */ }
        }
        return idx;
      });
    });
  }

  function search(query) {
    clearSearch();
    query = String(query || '').trim();
    if (!query || !S.doc || !SC) { postSearch(true); return; }
    var qObj = SC.foldQuery(query);
    if (!qObj.key.length) { postSearch(true); return; }
    S.q = query;
    var token = S.sToken;
    S.scanned = 0;

    // Gorunen sayfadan baslayip ileri sar, sonra basa don (aninda ekranda sonuc)
    var startPage = clamp(currentPage(), 1, S.n);
    var order = [];
    for (var a = startPage; a <= S.n; a++) order.push(a);
    for (var b = 1; b < startPage; b++) order.push(b);

    var byPageMatches = {};
    var activeRef = null;
    var firstJumped = false;

    function processPage(pageNum, pageIdx) {
      var hits = SC.searchPage(pageIdx, qObj, measureText);
      if (hits.length) {
        var list = [];
        for (var h = 0; h < hits.length; h++) {
          list.push({ page: pageNum, start: hits[h].start, len: hits[h].len, rects: hits[h].rects, els: null });
        }
        byPageMatches[pageNum] = list;
        if (!activeRef) activeRef = list[0];
        return true;
      }
      return false;
    }

    (async function () {
      var pos = 0;
      var lastReport = 0;
      while (pos < order.length) {
        if (token !== S.sToken) return;

        // Ilk sayfa (gorunen) tek basina hemen islenir; onbellekteki sayfalar toplu, digerleri 4'lu paralel islenir
        var batchEnd = pos === 0 ? 1 : Math.min(order.length, pos + (S.textCache[order[pos]] ? 24 : 4));
        var cachedOnly = true;
        for (var k = pos; k < batchEnd; k++) {
          if (!S.textCache[order[k]]) { cachedOnly = false; break; }
        }

        var changedPages = [];
        if (cachedOnly) {
          for (var c = pos; c < batchEnd; c++) {
            var pn = order[c];
            if (processPage(pn, S.textCache[pn])) changedPages.push(pn);
          }
        } else {
          var slice = order.slice(pos, batchEnd);
          var idxs = await Promise.all(slice.map(function (num) { return getPageIndex(num); }));
          if (token !== S.sToken) return;
          for (var u = 0; u < slice.length; u++) {
            if (processPage(slice[u], idxs[u])) changedPages.push(slice[u]);
          }
        }

        pos = batchEnd;
        S.scanned = pos;

        if (changedPages.length) {
          var curRef = (S.cur >= 0 && S.results[S.cur]) ? S.results[S.cur] : activeRef;
          rebuildResults(byPageMatches, curRef);
          for (var m = 0; m < changedPages.length; m++) {
            var rp = S.pages[changedPages[m] - 1];
            if (rp && rp.visible) renderHighlights(rp);
          }
          if (!firstJumped && activeRef) {
            firstJumped = true;
            scrollToResult(activeRef);
          }
        }

        var done = pos >= order.length;
        if (done || pos === 1 || pos - lastReport >= 8 || changedPages.length) {
          lastReport = pos;
          postSearch(done);
        }
        if (!done && !cachedOnly) {
          await new Promise(function (r) { setTimeout(r, 0); });
        }
      }
      if (token === S.sToken) postSearch(true);
    })().catch(function (e) { post({ t: 'error', name: 'SearchError', message: String(e && e.message || e) }); });
  }

  // ---------- Belge açma ----------
  function openDoc(password) {
    if (!pdfjs) { post({ t: 'error', name: 'NoEngine', message: 'pdf.js yüklenemedi.' }); return; }
    S.textCache = {};
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
              if (!pp || (!pp.visible && !pp.rendering)) {
                try { pg.cleanup(); } catch (e) { /* önemsiz */ }
              }
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
