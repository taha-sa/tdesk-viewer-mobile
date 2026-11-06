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
  function lc(s){ try { return s.toLocaleLowerCase('tr-TR'); } catch(e){ return s.toLowerCase(); } }
  function ensureStyle(){
    if (document.getElementById('tdsearch-style')) return;
    var st = document.createElement('style'); st.id = 'tdsearch-style';
    st.textContent = 'mark.tdm{background:#fde047;color:#111;border-radius:2px;padding:0}mark.tdm.tdc{background:#fb923c;outline:2px solid #ea580c}';
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
    var ql = lc(q);
    var nodes = [];
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false), n;
    while ((n = w.nextNode())) {
      var tag = n.parentNode && n.parentNode.nodeName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'MARK') continue;
      if (n.data && n.data.length >= ql.length) nodes.push(n);
    }
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i], d = node.data, l = lc(d);
      if (l.length !== d.length) l = d.toLowerCase();
      if (l.length !== d.length) continue;
      var pos = [], at = l.indexOf(ql);
      while (at >= 0) { pos.push(at); at = l.indexOf(ql, at + ql.length); }
      var created = [];
      for (var k = pos.length - 1; k >= 0; k--) {
        var mid = node.splitText(pos[k]);
        mid.splitText(ql.length);
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
