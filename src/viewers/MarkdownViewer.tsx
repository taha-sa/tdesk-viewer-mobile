import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Share, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { searchScript, parseSearchMessage } from '../utils/webSearch';
import { WebSearchBar } from './WebSearchBar';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import * as Clipboard from 'expo-clipboard';
import { marked } from 'marked';
import { FileInfo, AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import { sanitizeDocumentHtml, escapeHtmlText } from '../utils/sanitizeHtml';
import { t } from '../i18n';

interface MarkdownViewerProps {
  file: FileInfo;
  appTheme?: AppThemeMode;
}

const MIN_FONT = 12;
const MAX_FONT = 28;
const DEFAULT_FONT = 16;
const ID_PREFIX = 'u-';
const KATEX_BASE = 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist';

interface MathItem { tex: string; display: boolean }

/**
 * Kod bloklarını/satır içi kodu atlayarak matematik ifadelerini yer tutucuyla değiştirir.
 * Böylece marked, `_` `*` gibi karakterleri matematiğin içinde bozamaz ve tek `$` para birimi sanılmaz.
 * Tek `$` kuralı (pandoc benzeri): açılıştan sonra boşluk yok, kapanıştan önce boşluk yok,
 * kapanıştan sonra rakam yok, açılıştan önce harf/rakam/`\` yok.
 */
function extractMath(md: string): { text: string; maths: MathItem[] } {
  const maths: MathItem[] = [];
  const push = (tex: string, display: boolean) => {
    maths.push({ tex: tex.trim(), display });
    return `tdeskmath${maths.length - 1}x`;
  };
  const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(^|[^\\$0-9A-Za-z])\$(?![\s$])((?:[^$\n\\]|\\.)*?[^\s$\\])\$(?![0-9$])/g;
  const processText = (seg: string): string =>
    seg.replace(MATH_RE, (m: string, d1?: string, d2?: string, i1?: string, pre?: string, i2?: string) => {
      if (d1 !== undefined) return push(d1, true);
      if (d2 !== undefined) return push(d2, true);
      if (i1 !== undefined) return push(i1, false);
      if (i2 !== undefined) {
        // Para birimi sezgisi: rakamla başlayan ve boşluk içeren "$10 ... 20$" matematik sayılmaz.
        if (/^\d/.test(i2) && /\s/.test(i2)) return m;
        return `${pre ?? ''}${push(i2, false)}`;
      }
      return m;
    });
  const CODE_RE = /(^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]{0,3}\2[`~]*[ \t]*(?=\n|$)|$)|``[\s\S]*?``|`[^`\n]+`/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = CODE_RE.exec(md)) !== null) {
    out += processText(md.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
    if (m[0].length === 0) CODE_RE.lastIndex++;
  }
  out += processText(md.slice(last));
  return { text: out, maths };
}

/** Başlıklara GitHub tarzı çapa kimliği ekler (marked başlık id'si üretmez). */
function addHeadingIds(html: string): string {
  const used: Record<string, number> = {};
  return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (m: string, level: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, '').replace(/&[a-zA-Z#0-9]+;/g, '').trim().toLowerCase();
    let slug = text.replace(/[!-,./:-@[-^`{-~]/g, '').replace(/\s+/g, '-');
    if (!slug) return m;
    const n = used[slug] || 0;
    used[slug] = n + 1;
    if (n > 0) slug = `${slug}-${n}`;
    return `<h${level} id="${slug}">${inner}</h${level}>`;
  });
}

function renderMarkdown(source: string): { html: string; hasMath: boolean; failed: boolean } {
  try {
    const { text, maths } = extractMath(source);
    const rawHtml = marked.parse(text, { async: false, gfm: true }) as string;
    let html = sanitizeDocumentHtml(addHeadingIds(rawHtml), { allowImages: true, idPrefix: ID_PREFIX });
    let used = 0;
    html = html.replace(/tdeskmath(\d+)x/g, (m: string, idx: string) => {
      const item = maths[Number(idx)];
      if (!item) return m;
      used++;
      return `<span class="tdesk-math" data-d="${item.display ? '1' : '0'}">${escapeHtmlText(item.tex)}</span>`;
    });
    return { html, hasMath: used > 0, failed: false };
  } catch {
    return {
      html: `<p class="note">${t('markdown.rawNote')}</p><pre>${escapeHtmlText(source)}</pre>`,
      hasMath: false,
      failed: true,
    };
  }
}

function makeNonce(): string {
  let s = '';
  for (let i = 0; i < 24; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ file, appTheme = 'emerald' }) => {
  const c = Colors[appTheme] || Colors.emerald;
  const webRef = useRef<WebView>(null);
  const initialFont = useRef(DEFAULT_FONT).current;
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT);
  const fontRef = useRef<number>(DEFAULT_FONT);
  const [loading, setLoading] = useState<boolean>(true);
  const [failed, setFailed] = useState<boolean>(false);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [toast, setToast] = useState<string>('');
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchText, setSearchText] = useState<string>('');
  const [searchCount, setSearchCount] = useState<number>(0);
  const [searchIndex, setSearchIndex] = useState<number>(-1);
  const searchRef = useRef<string>('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const content = file.content || '';
  const rendered = useMemo(() => renderMarkdown(content), [content]);

  const htmlContent = useMemo(() => {
    const nonce = makeNonce();
    const math = rendered.hasMath;
    const csp = math
      ? `default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' https://cdn.jsdelivr.net; font-src https://cdn.jsdelivr.net data:; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net`
      : `default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
    const katexTags = math
      ? `<link rel="stylesheet" href="${KATEX_BASE}/katex.min.css" crossorigin="anonymous">
      <script src="${KATEX_BASE}/katex.min.js" crossorigin="anonymous"></script>`
      : '';
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${katexTags}
  <style>
    html { -webkit-text-size-adjust: 100%; }
    body {
      background-color: ${c.background};
      color: ${c.text};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: ${initialFont}px;
      padding: 16px 16px 60px 16px;
      line-height: 1.65;
      margin: 0;
      word-wrap: break-word;
      overflow-wrap: anywhere;
    }
    h1, h2, h3, h4, h5, h6 { color: ${c.primary}; margin-top: 1.5em; font-weight: 800; line-height: 1.3; }
    h1 { border-bottom: 1px solid ${c.border}; padding-bottom: 8px; }
    a { color: ${c.primary}; text-decoration: underline; }
    code {
      background-color: ${c.surface};
      color: ${c.accent || c.primary};
      padding: 2px 6px;
      border-radius: 4px;
      font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
      font-size: 0.9em;
    }
    pre {
      background-color: ${c.surface};
      padding: 14px;
      border-radius: 8px;
      overflow-x: auto;
      border: 1px solid ${c.border};
    }
    pre code { background-color: transparent; padding: 0; color: ${c.text}; }
    blockquote {
      border-left: 4px solid ${c.primary};
      margin: 16px 0;
      padding: 8px 16px;
      background-color: ${c.surfaceLight || c.surface};
      border-radius: 0 8px 8px 0;
      color: ${c.textSecondary};
    }
    img { max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0; }
    .img-missing { color: ${c.textMuted}; font-style: italic; }
    table { border-collapse: collapse; margin: 16px 0; font-size: 0.95em; display: block; overflow-x: auto; max-width: 100%; }
    th, td { border: 1px solid ${c.border}; padding: 10px; text-align: left; }
    th { background-color: ${c.surface}; color: ${c.primary}; }
    hr { border: 0; height: 1px; background-color: ${c.border}; margin: 24px 0; }
    ul, ol { padding-left: 1.5em; }
    li > input[type="checkbox"] { margin-right: 6px; }
    .note { color: ${c.textMuted}; font-style: italic; }
    .tdesk-math { font-family: "KaTeX_Main", "Times New Roman", serif; color: ${c.primary}; padding: 0 2px; }
    .tdesk-math[data-d="1"] {
      display: block; text-align: center; margin: 16px 0; padding: 12px; overflow-x: auto;
      background-color: ${c.surface}; border-radius: 8px; border: 1px solid ${c.border};
    }
  </style>
</head>
<body>
  <div id="tdesk-content">${rendered.html}</div>
  <script nonce="${nonce}">
    (function () {
      function renderMath() {
        if (!window.katex) return;
        var els = document.querySelectorAll('.tdesk-math');
        for (var i = 0; i < els.length; i++) {
          try {
            window.katex.render(els[i].textContent, els[i], { displayMode: els[i].getAttribute('data-d') === '1', throwOnError: false });
          } catch (e) {}
        }
      }
      renderMath();
      document.addEventListener('click', function (ev) {
        var n = ev.target;
        while (n && n.nodeType === 1 && n.tagName !== 'A') n = n.parentNode;
        if (!n || n.nodeType !== 1) return;
        var h = n.getAttribute('href');
        if (h && h.charAt(0) === '#') {
          ev.preventDefault();
          var id = h.slice(1);
          try { id = decodeURIComponent(id); } catch (e) {}
          var t = document.getElementById(id);
          if (t) t.scrollIntoView();
        }
      }, true);
    })();
  </script>
</body>
</html>`;
  }, [rendered, c, initialFont]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1800);
  }, []);

  // Arama: yazdıkça (gecikmeli) belgede işaretle; kapatınca temizle.
  useEffect(() => {
    searchRef.current = searchOpen ? searchText : '';
    const h = setTimeout(() => {
      webRef.current?.injectJavaScript(searchScript('find', searchOpen ? searchText.trim() : ''));
    }, 250);
    return () => clearTimeout(h);
  }, [searchOpen, searchText]);

  const searchNext = useCallback(() => { webRef.current?.injectJavaScript(searchScript('next')); }, []);
  const searchPrev = useCallback(() => { webRef.current?.injectJavaScript(searchScript('prev')); }, []);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchText('');
    setSearchCount(0);
    setSearchIndex(-1);
  }, []);
  const onWebMessage = useCallback((e: { nativeEvent: { data: string } }) => {
    const st = parseSearchMessage(e.nativeEvent.data);
    if (st) { setSearchCount(st.count); setSearchIndex(st.index); }
  }, []);

  const changeFont = useCallback((delta: number) => {
    setFontSize((f) => {
      const next = Math.max(MIN_FONT, Math.min(MAX_FONT, f + delta));
      fontRef.current = next;
      webRef.current?.injectJavaScript(`document.body.style.fontSize='${next}px';true;`);
      return next;
    });
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(content);
      showToast(t('details.copied'));
    } catch {
      showToast(t('details.copyFailTitle'));
    }
  }, [content, showToast]);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({ message: content, title: file.name });
    } catch {
      showToast(t('common.shareFailTitle'));
    }
  }, [content, file.name, showToast]);

  const onShouldStart = useCallback((req: ShouldStartLoadRequest): boolean => {
    const url = req.url || '';
    // İlk yükleme (html kaynağı) ve sayfa içi çapalar WebView'da kalır.
    if (url === 'about:blank' || url.startsWith('about:blank#') || url.startsWith('data:text/html')) return true;
    if (url.startsWith('#')) return true;
    if (/^(https?:|mailto:|tel:)/i.test(url)) {
      Linking.openURL(url).catch(() => showToast(t('docx.linkFailTitle')));
    }
    return false;
  }, [showToast]);

  const barBtn = (label: string, icon: React.ComponentProps<typeof Ionicons>['name'] | null, text: string | null, onPress: () => void, disabled = false) => (
    <TouchableOpacity
      key={label}
      style={[styles.barBtn, { borderColor: c.border, opacity: disabled ? 0.4 : 1 }]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    >
      {icon ? <Ionicons name={icon} size={20} color={c.text} /> : <Text style={[styles.barBtnText, { color: c.text }]}>{text}</Text>}
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={[styles.toolbar, { backgroundColor: c.card, borderBottomColor: c.border }]}>
        <View style={styles.toolGroup}>
          {barBtn(t('epub.fontSmaller'), null, 'A-', () => changeFont(-2), fontSize <= MIN_FONT)}
          {barBtn(t('epub.fontLarger'), null, 'A+', () => changeFont(2), fontSize >= MAX_FONT)}
        </View>
        {toast ? <Text style={[styles.toast, { color: c.textSecondary }]} accessibilityLiveRegion="polite">{toast}</Text> : <View style={{ flex: 1 }} />}
        <View style={styles.toolGroup}>
          {barBtn(t('viewers.searchInDoc'), 'search', null, () => setSearchOpen((o) => !o))}
          {barBtn(t('viewers.copyAll'), 'copy-outline', null, handleCopy)}
          {barBtn(t('markdown.shareText'), 'share-outline', null, handleShare)}
        </View>
      </View>

      {searchOpen ? (
        <WebSearchBar
          colors={c}
          value={searchText}
          onChange={setSearchText}
          count={searchCount}
          index={searchIndex}
          onNext={searchNext}
          onPrev={searchPrev}
          onClose={closeSearch}
        />
      ) : null}

      {failed ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={44} color={c.textMuted} />
          <Text style={[styles.errText, { color: c.textSecondary }]}>{t('markdown.displayFail')}</Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: c.primary }]}
            onPress={() => { setFailed(false); setLoading(true); setReloadKey((k) => k + 1); }}
            accessibilityRole="button"
            accessibilityLabel={t('common.retry')}
          >
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.flex}>
          <WebView
            key={reloadKey}
            ref={webRef}
            originWhitelist={['*']}
            source={{ html: htmlContent }}
            style={styles.webview}
            javaScriptEnabled
            domStorageEnabled={false}
            setSupportMultipleWindows={false}
            scalesPageToFit={false}
            allowFileAccess={false}
            allowUniversalAccessFromFileURLs={false}
            allowFileAccessFromFileURLs={false}
            mixedContentMode="never"
            onShouldStartLoadWithRequest={onShouldStart}
            onMessage={onWebMessage}
            onLoadEnd={() => {
              setLoading(false);
              if (searchRef.current.trim()) webRef.current?.injectJavaScript(searchScript('find', searchRef.current.trim()));
              if (fontRef.current !== initialFont) webRef.current?.injectJavaScript(`document.body.style.fontSize='${fontRef.current}px';true;`);
            }}
            onError={() => { setLoading(false); setFailed(true); }}
            onHttpError={() => { /* alt kaynak (görsel/KaTeX) hataları belgeyi bozmaz */ }}
          />
          {loading && (
            <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: c.background }]} pointerEvents="none">
              <ActivityIndicator size="large" color={c.primary} />
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  webview: { flex: 1, backgroundColor: 'transparent' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1 },
  toolGroup: { flexDirection: 'row', gap: 8 },
  barBtn: { minWidth: 44, minHeight: 44, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  barBtnText: { fontSize: 14, fontWeight: '800' },
  toast: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errText: { marginTop: 12, fontSize: 15, textAlign: 'center' },
  retryBtn: { marginTop: 16, minHeight: 44, paddingHorizontal: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#0B0F19', fontWeight: '700', fontSize: 14 },
});
