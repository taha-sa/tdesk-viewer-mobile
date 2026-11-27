/* T-Desk PDF arama ve koordinat tabanli isaretleme cekirdegi.
   Hem WebView (window.__pdfSearchCore) hem Node birim testleri (module.exports) icin saf JS. */
(function (root) {
  'use strict';

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function mulTransform(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }

  function isWs(code) {
    return code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 160 ||
      (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x3000;
  }

  // Turkce + Ingilizce uyumlu katlama:
  // - 'İ' -> 'i' (birlesik nokta \u0307 atlanir)
  // - 'I' -> folded='I', key='i' (hem 'i' hem 'ı' ile eslesir; 'i' ile 'ı' birbirine karismaz)
  // - 'ı' -> folded='ı', key='i'
  // - Yumusak tire (\u00AD) atlanir; bosluklar tek ' ' olarak birlestirilir.
  function foldQuery(raw) {
    var s = String(raw || '');
    var folded = '', key = '';
    var prevSpace = true;
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code === 0x00ad) continue; // soft hyphen
      if (code === 0x0307) {
        if (folded.length && folded.charAt(folded.length - 1) === 'I') {
          folded = folded.slice(0, -1) + 'i';
        }
        continue;
      }
      if (isWs(code)) {
        if (!prevSpace) { folded += ' '; key += ' '; prevSpace = true; }
        continue;
      }
      prevSpace = false;
      if (code === 0x0049) { // 'I'
        folded += 'I'; key += 'i';
      } else if (code === 0x0130) { // 'İ'
        folded += 'i'; key += 'i';
      } else if (code === 0x0131) { // 'ı'
        folded += '\u0131'; key += 'i';
      } else {
        var lo = s.charAt(i).toLowerCase();
        for (var j = 0; j < lo.length; j++) {
          var lc = lo.charCodeAt(j);
          if (lc === 0x0307) continue;
          var ch = lo.charAt(j);
          folded += ch;
          key += (lc === 0x0131 ? 'i' : ch);
        }
      }
    }
    if (folded.length && folded.charAt(folded.length - 1) === ' ') {
      folded = folded.slice(0, -1);
      key = key.slice(0, -1);
    }
    return { folded: folded, key: key };
  }

  function charsCompat(a, b) {
    if (a === b) return true;
    if (a === 'I' && (b === 'i' || b === '\u0131')) return true;
    if (b === 'I' && (a === 'i' || a === '\u0131')) return true;
    return false;
  }

  function matchCompat(docFolded, at, qFolded) {
    for (var i = 0; i < qFolded.length; i++) {
      if (!charsCompat(docFolded.charAt(at + i), qFolded.charAt(i))) return false;
    }
    return true;
  }

  // Iki ardisik metin ogesi arasinda kelime boslugu/satir sonu gerekli mi?
  function needsSpaceBetween(prev, curr, pendingEOL) {
    if (pendingEOL || prev.hasEOL) return true;
    var fh = Math.max(prev.fh, curr.fh, 1);
    var minFh = Math.min(prev.fh, curr.fh) || fh;
    if (prev.angle === 0 && curr.angle === 0) {
      if (Math.abs(curr.y - prev.y) > fh * 0.55) return true;
      var gap = curr.x - (prev.x + prev.w);
      if (gap > minFh * 0.18 || gap < -fh * 0.5) return true;
      return false;
    }
    if (Math.abs(prev.angle - curr.angle) > 0.12) return true;
    var c = Math.cos(prev.angle), s = Math.sin(prev.angle);
    var dx = curr.x - prev.x, dy = curr.y - prev.y;
    var along = dx * c + dy * s;
    var perp = -dx * s + dy * c;
    if (Math.abs(perp) > fh * 0.55) return true;
    var rgap = along - prev.w;
    return rgap > minFh * 0.18 || rgap < -fh * 0.5;
  }

  // Sayfa metin + olcek-1 geometri indeksi olustur (sayfa basina yalniz 1 kez calisir).
  function buildPageIndex(tc, v0Transform, utilTransform) {
    var mul = utilTransform || mulTransform;
    var rawItems = (tc && tc.items) || [];
    var styles = (tc && tc.styles) || {};
    var items = [];
    var foldedArr = [];
    var keyArr = [];
    var mapItem = [];
    var mapChar = [];
    var prevItem = null;
    var pendingEOL = false;
    var prevSpace = true;

    for (var i = 0; i < rawItems.length; i++) {
      var raw = rawItems[i];
      if (!raw || raw.str === undefined) continue;
      var str = String(raw.str);
      if (!str.length) {
        if (raw.hasEOL) pendingEOL = true;
        continue;
      }

      var st = styles[raw.fontName] || {};
      var vertical = !!st.vertical;
      var tx = mul(v0Transform, raw.transform || [1, 0, 0, 1, 0, 0]);
      var angle = Math.atan2(tx[1], tx[0]);
      if (vertical) angle += Math.PI / 2;
      if (Math.abs(angle) < 1e-4) angle = 0;

      var fh = Math.hypot(tx[2], tx[3]);
      if (!fh || fh < 0.5) fh = Math.hypot(tx[0], tx[1]) || raw.height || 10;

      var ascent = (typeof st.ascent === 'number' && st.ascent > 0.3 && st.ascent < 1.3) ? st.ascent : 0.85;
      var descent = (typeof st.descent === 'number' && st.descent < -0.05 && st.descent > -0.6) ? -st.descent : 0.22;
      var fontAscent = fh * ascent;
      var boxH = fh * (ascent + descent);
      var left = angle === 0 ? tx[4] : tx[4] + fontAscent * Math.sin(angle);
      var top = angle === 0 ? tx[5] - fontAscent : tx[5] - fontAscent * Math.cos(angle);
      var w = vertical ? (raw.height || 0) : (raw.width || 0);
      if (!(w > 0)) w = str.length * fh * 0.5;

      var itemIdx = items.length;
      var item = {
        str: str,
        x: left,
        y: top,
        w: w,
        h: boxH,
        fh: fh,
        angle: angle,
        ff: st.fontFamily || 'sans-serif',
        dir: raw.dir === 'rtl' ? 'rtl' : 'ltr',
        hasEOL: !!raw.hasEOL
      };
      items.push(item);

      if (prevItem && !prevSpace && needsSpaceBetween(prevItem, item, pendingEOL)) {
        foldedArr.push(' ');
        keyArr.push(' ');
        mapItem.push(-1);
        mapChar.push(-1);
        prevSpace = true;
      }
      pendingEOL = false;

      for (var c = 0; c < str.length; c++) {
        var code = str.charCodeAt(c);
        if (code === 0x00ad) continue;
        if (code === 0x0307) {
          if (foldedArr.length && foldedArr[foldedArr.length - 1] === 'I') {
            foldedArr[foldedArr.length - 1] = 'i';
          }
          continue;
        }
        if (isWs(code)) {
          if (!prevSpace) {
            foldedArr.push(' ');
            keyArr.push(' ');
            mapItem.push(itemIdx);
            mapChar.push(c);
            prevSpace = true;
          }
          continue;
        }
        prevSpace = false;
        if (code === 0x0049) {
          foldedArr.push('I'); keyArr.push('i'); mapItem.push(itemIdx); mapChar.push(c);
        } else if (code === 0x0130) {
          foldedArr.push('i'); keyArr.push('i'); mapItem.push(itemIdx); mapChar.push(c);
        } else if (code === 0x0131) {
          foldedArr.push('\u0131'); keyArr.push('i'); mapItem.push(itemIdx); mapChar.push(c);
        } else {
          var lo = str.charAt(c).toLowerCase();
          for (var j = 0; j < lo.length; j++) {
            var lc = lo.charCodeAt(j);
            if (lc === 0x0307) continue;
            var ch = lo.charAt(j);
            foldedArr.push(ch);
            keyArr.push(lc === 0x0131 ? 'i' : ch);
            mapItem.push(itemIdx);
            mapChar.push(c);
          }
        }
      }

      prevItem = item;
    }

    return {
      items: items,
      folded: foldedArr.join(''),
      key: keyArr.join(''),
      mapItem: new Int32Array(mapItem),
      mapChar: new Int32Array(mapChar)
    };
  }

  function mergeRects(rects) {
    if (rects.length <= 1) return rects;
    var out = [rects[0]];
    for (var i = 1; i < rects.length; i++) {
      var prev = out[out.length - 1];
      var cur = rects[i];
      var maxH = Math.max(prev.h, cur.h, 1);
      if (
        prev.angle === 0 && cur.angle === 0 &&
        Math.abs(prev.y - cur.y) <= maxH * 0.45 &&
        Math.abs(prev.h - cur.h) <= maxH * 0.55 &&
        cur.x >= prev.x - maxH * 0.3 &&
        cur.x <= (prev.x + prev.w) + maxH * 0.85
      ) {
        var nx = Math.min(prev.x, cur.x);
        var nr = Math.max(prev.x + prev.w, cur.x + cur.w);
        var ny = Math.min(prev.y, cur.y);
        var nb = Math.max(prev.y + prev.h, cur.y + cur.h);
        out[out.length - 1] = { x: nx, y: ny, w: nr - nx, h: nb - ny, angle: 0 };
      } else {
        out.push(cur);
      }
    }
    return out;
  }

  // Bir eslesmeyi [start, end) olcek-1 sayfa dikdortgenlerine cevirir.
  function matchToRects(pageIndex, start, end, measureFn) {
    var segs = [];
    var curSeg = null;
    for (var k = start; k < end; k++) {
      var ii = pageIndex.mapItem[k];
      var ci = pageIndex.mapChar[k];
      if (ii < 0 || ci < 0) continue;
      if (curSeg && curSeg.itemIdx === ii) {
        if (ci + 1 > curSeg.charEnd) curSeg.charEnd = ci + 1;
      } else {
        curSeg = { itemIdx: ii, charStart: ci, charEnd: ci + 1 };
        segs.push(curSeg);
      }
    }

    var rects = [];
    for (var s = 0; s < segs.length; s++) {
      var seg = segs[s];
      var item = pageIndex.items[seg.itemIdx];
      if (!item || !item.str.length || !(item.w > 0)) continue;
      var len = item.str.length;
      var cs = clamp(seg.charStart, 0, len);
      var ce = clamp(seg.charEnd, cs, len);
      while (ce < len && item.str.charCodeAt(ce) === 0x0307) ce++;
      if (ce <= cs) continue;

      var f0 = 0, f1 = 1;
      if (cs > 0 || ce < len) {
        var total = measureFn ? measureFn(item.str, item.ff) : 0;
        if (total > 0) {
          var pre = cs > 0 ? measureFn(item.str.slice(0, cs), item.ff) : 0;
          var till = ce < len ? measureFn(item.str.slice(0, ce), item.ff) : total;
          f0 = clamp(pre / total, 0, 1);
          f1 = clamp(till / total, f0, 1);
        } else {
          f0 = cs / len;
          f1 = ce / len;
        }
      }
      if (item.dir === 'rtl') {
        var rf0 = 1 - f1;
        f1 = 1 - f0;
        f0 = rf0;
      }
      var rw = Math.max((f1 - f0) * item.w, 1);
      if (item.angle === 0) {
        rects.push({ x: item.x + f0 * item.w, y: item.y, w: rw, h: item.h, angle: 0 });
      } else {
        var cos = Math.cos(item.angle), sin = Math.sin(item.angle);
        rects.push({
          x: item.x + f0 * item.w * cos,
          y: item.y + f0 * item.w * sin,
          w: rw,
          h: item.h,
          angle: item.angle
        });
      }
    }
    return mergeRects(rects);
  }

  function searchPage(pageIndex, qObj, measureFn) {
    var out = [];
    if (!pageIndex || !qObj || !qObj.key.length) return out;
    var key = pageIndex.key;
    var folded = pageIndex.folded;
    var qk = qObj.key;
    var qf = qObj.folded;
    var qlen = qk.length;
    if (key.length < qlen) return out;

    var at = key.indexOf(qk);
    while (at >= 0) {
      if (matchCompat(folded, at, qf)) {
        var rects = matchToRects(pageIndex, at, at + qlen, measureFn);
        if (rects.length) {
          out.push({ start: at, len: qlen, rects: rects });
        }
        at = key.indexOf(qk, at + qlen);
      } else {
        at = key.indexOf(qk, at + 1);
      }
    }
    return out;
  }

  var api = {
    mulTransform: mulTransform,
    foldQuery: foldQuery,
    charsCompat: charsCompat,
    buildPageIndex: buildPageIndex,
    matchToRects: matchToRects,
    mergeRects: mergeRects,
    searchPage: searchPage
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.__pdfSearchCore = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
