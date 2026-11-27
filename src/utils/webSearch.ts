// WebView içindeki belgede (Markdown, EPUB...) sayfa içi arama: eşleşmeleri <mark> ile işaretler, sayar, gezdirir.
// WebView'a injectJavaScript ile gönderilir; sonuç window.ReactNativeWebView.postMessage ile geri bildirilir.
// Türkçe büyük/küçük harf (İ/ı) toLocaleLowerCase('tr-TR') ile ele alınır.

export type SearchCommand = 'find' | 'next' | 'prev' | 'clear';

export interface SearchStatus {
  count: number;
  /** Geçerli eşleşmenin 0 tabanlı sırası; eşleşme yoksa -1 */
  index: number;
}

const LIB = `
(function(){
  var S = window.__tdS = window.__tdS || { marks: [], cur: -1 };
  function post(){ try { window.ReactNativeWebView.postMessage(JSON.stringify({ t: 'tdsearch', count: S.marks.length, index: S.cur })); } catch(e){} }
  function foldMap(str){
    var folded = '', key = '', idx = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code === 0x00ad) continue;
      if (code === 0x0307) {
        if (folded.length && folded.charAt(folded.length - 1) === 'I') folded = folded.slice(0, -1) + 'i';
        continue;
      }
      if (code === 0x0049) { folded += 'I'; key += 'i'; idx.push(i); }
      else if (code === 0x0130) { folded += 'i'; key += 'i'; idx.push(i); }
      else if (code === 0x0131) { folded += '\\u0131'; key += 'i'; idx.push(i); }
      else {
        var lo = str.charAt(i).toLowerCase();
        for (var j = 0; j < lo.length; j++) {
          var lc = lo.charCodeAt(j);
          if (lc === 0x0307) continue;
          var ch = lo.charAt(j);
          folded += ch; key += (lc === 0x0131 ? 'i' : ch); idx.push(i);
        }
      }
    }
    return { folded: folded, key: key, idx: idx };
  }
  function compat(a, b){
    return a === b || (a === 'I' && (b === 'i' || b === '\\u0131')) || (b === 'I' && (a === 'i' || a === '\\u0131'));
  }
  function ensureStyle(){
    if (document.getElementById('tdsearch-style')) return;
    var st = document.createElement('style'); st.id = 'tdsearch-style';
    st.textContent = 'mark.tdm{background:#fef08a;color:#111;border-radius:3px;padding:0 1px}mark.tdm.tdc{background:#fb923c;color:#111;box-shadow:0 0 0 1.5px #ea580c}';
    (document.head || document.documentElement).appendChild(st);
  }
  function clear(){
    for (var i = 0; i < S.marks.length; i++) {
      var m = S.marks[i], p = m.parentNode;
      if (!p) continue;
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    }
    S.marks = []; S.cur = -1;
  }
  function find(q){
    clear();
    if (!q) { post(); return; }
    ensureStyle();
    var qm = foldMap(q);
    var qk = qm.key, qf = qm.folded, qlen = qk.length;
    if (!qlen) { post(); return; }
    var nodes = [];
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false), n;
    while ((n = w.nextNode())) {
      var tag = n.parentNode && n.parentNode.nodeName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'MARK') continue;
      if (n.data && n.data.length >= qlen) nodes.push(n);
    }
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i], d = node.data, dm = foldMap(d);
      if (dm.key.length < qlen) continue;
      var ranges = [], at = dm.key.indexOf(qk);
      while (at >= 0) {
        var ok = true;
        for (var c = 0; c < qlen; c++) {
          if (!compat(dm.folded.charAt(at + c), qf.charAt(c))) { ok = false; break; }
        }
        if (ok) {
          var s0 = dm.idx[at];
          var e0 = dm.idx[at + qlen - 1] + 1;
          while (e0 < d.length && d.charCodeAt(e0) === 0x0307) e0++;
          ranges.push([s0, e0]);
          at = dm.key.indexOf(qk, at + qlen);
        } else {
          at = dm.key.indexOf(qk, at + 1);
        }
      }
      var created = [];
      for (var k = ranges.length - 1; k >= 0; k--) {
        var s0 = ranges[k][0], len0 = ranges[k][1] - s0;
        var mid = node.splitText(s0);
        mid.splitText(len0);
        var mk = document.createElement('mark'); mk.className = 'tdm';
        mid.parentNode.replaceChild(mk, mid); mk.appendChild(mid);
        created.push(mk);
      }
      created.reverse();
      for (var j = 0; j < created.length; j++) S.marks.push(created[j]);
    }
    if (S.marks.length) go(0, true); else post();
  }
  function go(dir, absolute){
    if (!S.marks.length) { post(); return; }
    if (S.cur >= 0 && S.marks[S.cur]) S.marks[S.cur].className = 'tdm';
    S.cur = absolute ? dir : (S.cur + dir + S.marks.length) % S.marks.length;
    var el = S.marks[S.cur];
    el.className = 'tdm tdc';
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch(e){}
    post();
  }
  window.__tdSearchCmd = function(cmd, q){
    if (cmd === 'find') find(q); else if (cmd === 'next') go(1); else if (cmd === 'prev') go(-1); else { clear(); post(); }
  };
})();
`;

/** WebView.injectJavaScript için komut betiği. */
export function searchScript(cmd: SearchCommand, query = ''): string {
  return `${LIB}\nwindow.__tdSearchCmd(${JSON.stringify(cmd)}, ${JSON.stringify(query)});true;`;
}

/** onMessage verisinden arama durumunu çıkarır; arama mesajı değilse null. */
export function parseSearchMessage(data: unknown): SearchStatus | null {
  if (typeof data !== 'string' || data.indexOf('tdsearch') < 0) return null;
  try {
    const m = JSON.parse(data) as { t?: string; count?: unknown; index?: unknown };
    if (m.t !== 'tdsearch') return null;
    const count = typeof m.count === 'number' && isFinite(m.count) ? m.count : 0;
    const index = typeof m.index === 'number' && isFinite(m.index) ? m.index : -1;
    return { count, index };
  } catch {
    return null;
  }
}
