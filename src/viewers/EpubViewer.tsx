import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Modal, FlatList, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import JSZip from 'jszip';
import * as FileSystem from 'expo-file-system';
import { FileInfo, AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import { FileService } from '../services/fileService';
import {
  EpubBook, EpubError, TocEntry, readEpub, readChapterHtml, parseChapterLink,
} from '../utils/epubParse';

interface EpubViewerProps {
  file: FileInfo;
  appTheme?: AppThemeMode;
}

type ReaderTheme = 'sepia' | 'light' | 'dark' | 'oled';

interface ReaderPalette { bg: string; text: string; card: string; border: string; link: string; muted: string }

const READER_THEMES: ReaderTheme[] = ['sepia', 'light', 'dark', 'oled'];
const THEME_LABEL: Record<ReaderTheme, string> = { sepia: 'Sepya', light: 'Açık', dark: 'Koyu', oled: 'Siyah' };
const THEME_ICON: Record<ReaderTheme, React.ComponentProps<typeof Ionicons>['name']> = {
  sepia: 'color-palette', light: 'sunny', dark: 'moon', oled: 'contrast',
};
const PALETTES: Record<ReaderTheme, ReaderPalette> = {
  sepia: { bg: '#F8F1E3', text: '#3E342B', card: '#EFE3CE', border: '#E2D3B8', link: '#7C3AED', muted: '#6B5E50' },
  light: { bg: '#FFFFFF', text: '#1E293B', card: '#F1F5F9', border: '#E2E8F0', link: '#6D28D9', muted: '#475569' },
  dark: { bg: '#161F30', text: '#F1F5F9', card: '#1E2B42', border: '#2A3B5A', link: '#A78BFA', muted: '#A8B3C7' },
  oled: { bg: '#000000', text: '#E2E8F0', card: '#121212', border: '#262626', link: '#A78BFA', muted: '#A3A3A3' },
};
const ACCENT = '#8B5CF6';
const MIN_FONT = 14;
const MAX_FONT = 28;
const SAVE_DEBOUNCE_MS = 800;
const CHAPTER_CACHE_SIZE = 3;
const HIT = { top: 4, bottom: 4, left: 4, right: 4 };

function themeScript(p: ReaderPalette, fontSize: number): string {
  return `(function(){var r=document.documentElement.style;`
    + `r.setProperty('--bg','${p.bg}');r.setProperty('--fg','${p.text}');r.setProperty('--link','${p.link}');`
    + `r.setProperty('--card','${p.card}');r.setProperty('--border','${p.border}');r.setProperty('--fs','${fontSize}px');})();true;`;
}

function buildPage(content: string, p: ReaderPalette, fontSize: number): string {
  // Sayfa betik ÇALIŞTIRAMAZ (CSP: script-src yok); yalnız uygulamanın enjekte ettiği stil/kaydırma komutları çalışır.
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root { --bg: ${p.bg}; --fg: ${p.text}; --link: ${p.link}; --card: ${p.card}; --border: ${p.border}; --fs: ${fontSize}px; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: Georgia, "Times New Roman", serif;
      font-size: var(--fs);
      line-height: 1.65;
      padding: 20px 18px 60px 18px;
      margin: 0;
      word-wrap: break-word;
      overflow-wrap: anywhere;
    }
    p { margin: 0 0 1.2em 0; }
    h1, h2, h3, h4, h5, h6 { color: var(--fg); font-weight: bold; margin: 1.4em 0 0.6em 0; line-height: 1.3; }
    a { color: var(--link); text-decoration: underline; }
    img { max-width: 100%; height: auto; border-radius: 6px; margin: 12px auto; display: block; }
    blockquote { border-left: 4px solid ${ACCENT}; padding-left: 14px; margin-left: 0; opacity: 0.9; font-style: italic; }
    table { border-collapse: collapse; display: block; overflow-x: auto; max-width: 100%; margin: 1em 0; }
    th, td { border: 1px solid var(--border); padding: 6px 8px; }
    pre { overflow-x: auto; white-space: pre-wrap; word-break: break-word; background: var(--card); padding: 12px; border-radius: 6px; font-size: 0.9em; }
    code { font-family: Menlo, Consolas, monospace; font-size: 0.92em; }
    hr { border: 0; height: 1px; background: var(--border); margin: 1.5em 0; }
    .img-missing { opacity: 0.6; font-style: italic; }
  </style>
</head>
<body>
${content}
</body>
</html>`;
}

export const EpubViewer: React.FC<EpubViewerProps> = ({ file, appTheme = 'emerald' }) => {
  const currentColors = Colors[appTheme] || Colors.emerald;

  const [book, setBook] = useState<EpubBook | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [chapterIdx, setChapterIdx] = useState<number>(0);
  // Bölüm HTML'i hangi bölüme ait olduğuyla tutulur: bölüm değişiminde eski içerik yeni WebView'a verilmesin.
  const [chapterData, setChapterData] = useState<{ idx: number; html: string } | null>(null);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [chapterReload, setChapterReload] = useState<number>(0);
  const [fontSize, setFontSize] = useState<number>(18);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>('sepia');
  const [showToc, setShowToc] = useState<boolean>(false);

  const palette = PALETTES[readerTheme];
  const chapterHtml = chapterData && chapterData.idx === chapterIdx ? chapterData.html : null;

  const zipRef = useRef<JSZip | null>(null);
  const cacheRef = useRef<Map<number, string>>(new Map());
  const webRef = useRef<WebView>(null);
  const paletteRef = useRef<ReaderPalette>(palette);
  const fontRef = useRef<number>(fontSize);
  const pendingFragment = useRef<string>('');
  paletteRef.current = palette;
  fontRef.current = fontSize;

  // ---- Kitabı yükle
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setBook(null);
    setChapterData(null);
    cacheRef.current.clear();
    zipRef.current = null;

    (async () => {
      try {
        let b64 = file.base64;
        if (typeof file.size === 'number' && file.size > 50 * 1024 * 1024) {
          throw new EpubError(`Kitap çok büyük (${Math.round(file.size / 1048576)} MB). En fazla 50 MB desteklenir.`);
        }
        if (!b64) b64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
        if (!b64) throw new EpubError('Dosya boş veya okunamadı.');
        let zip: JSZip;
        try {
          zip = await JSZip.loadAsync(b64, { base64: true });
        } catch {
          throw new EpubError('Dosya geçerli bir EPUB (ZIP) arşivi değil.');
        }
        const parsed = await readEpub(zip, () => cancelled);
        if (cancelled) return;
        zipRef.current = zip;
        const saved = Math.floor((file.lastReadPage || 1) - 1);
        const start = Math.max(0, Math.min(parsed.chapters.length - 1, isFinite(saved) ? saved : 0));
        latestIdx.current = start;
        savedIdx.current = start;
        setBook(parsed);
        setChapterIdx(start);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.warn('EPUB okuma hatası:', e);
        setLoadError(e instanceof EpubError ? e.message : 'Bu e-kitap ayrıştırılamadı veya içeriği bozuk.');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.uri, file.base64, reloadKey]);

  // ---- Seçili bölümü hazırla (tembel; küçük önbellek)
  useEffect(() => {
    const zip = zipRef.current;
    if (!book || !zip) return;
    let cancelled = false;
    setChapterError(null);
    const cached = cacheRef.current.get(chapterIdx);
    if (cached !== undefined) {
      setChapterData({ idx: chapterIdx, html: cached });
      return;
    }
    setChapterData(null);
    (async () => {
      try {
        const html = await readChapterHtml(zip, book, chapterIdx);
        if (cancelled) return;
        const cache = cacheRef.current;
        cache.set(chapterIdx, html);
        while (cache.size > CHAPTER_CACHE_SIZE) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
        setChapterData({ idx: chapterIdx, html });
      } catch (e) {
        if (cancelled) return;
        console.warn('EPUB bölüm hatası:', e);
        setChapterError('Bu bölüm okunamadı.');
      }
    })();
    return () => { cancelled = true; };
  }, [book, chapterIdx, chapterReload]);

  // ---- Son okunan bölüm: debounce + unmount'ta son kayıt
  const latestIdx = useRef<number>(0);
  const savedIdx = useRef<number>(-1);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bookReady = useRef<boolean>(false);
  bookReady.current = book !== null;
  const fileIdRef = useRef<string>(file.id);
  fileIdRef.current = file.id;
  const isVirtual = useRef<boolean>(!!file.virtual);
  isVirtual.current = !!file.virtual;

  const flushSave = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (!bookReady.current || isVirtual.current) return;
    if (latestIdx.current !== savedIdx.current) {
      savedIdx.current = latestIdx.current;
      FileService.updateLastReadPage(fileIdRef.current, latestIdx.current + 1).catch(() => { /* kritik değil */ });
    }
  }, []);

  useEffect(() => {
    latestIdx.current = chapterIdx;
    if (!book) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }, [chapterIdx, book, flushSave]);

  useEffect(() => () => flushSave(), [flushSave]);

  // ---- Tema / yazı boyutu: sayfayı yeniden yüklemeden yerinde güncelle
  useEffect(() => {
    webRef.current?.injectJavaScript(themeScript(palette, fontSize));
  }, [palette, fontSize]);

  const pageHtml = useMemo(() => {
    if (chapterHtml === null) return null;
    return buildPage(chapterHtml, paletteRef.current, fontRef.current);
  }, [chapterHtml]);

  const goToChapter = useCallback((i: number, fragment = '') => {
    if (!book) return;
    const next = Math.max(0, Math.min(book.chapters.length - 1, i));
    if (next === chapterIdx) {
      // Aynı bölüm: yeniden yükleme olmaz; çapaya (yoksa başa) doğrudan kaydır.
      pendingFragment.current = '';
      webRef.current?.injectJavaScript(
        fragment
          ? `(function(){var e=document.getElementById(${JSON.stringify(fragment)});if(e)e.scrollIntoView();})();true;`
          : 'window.scrollTo(0,0);true;'
      );
      return;
    }
    pendingFragment.current = fragment;
    setChapterIdx(next);
  }, [book, chapterIdx]);

  const onShouldStart = useCallback((req: ShouldStartLoadRequest): boolean => {
    const url = req.url || '';
    if (url === 'about:blank' || url.startsWith('about:blank#') || url.startsWith('data:text/html')) return true;
    if (url.startsWith('#')) return true;
    const link = parseChapterLink(url);
    if (link) {
      goToChapter(link.chapterIdx, link.fragment);
      return false;
    }
    if (/^(https?:|mailto:|tel:)/i.test(url)) {
      Linking.openURL(url).catch(() => undefined);
    }
    return false;
  }, [goToChapter]);

  const onPageLoaded = useCallback(() => {
    const web = webRef.current;
    if (!web) return;
    web.injectJavaScript(themeScript(paletteRef.current, fontRef.current));
    const frag = pendingFragment.current;
    if (frag) {
      pendingFragment.current = '';
      web.injectJavaScript(`(function(){var e=document.getElementById(${JSON.stringify(frag)});if(e)e.scrollIntoView();})();true;`);
    }
  }, []);

  const currentChapter = book?.chapters[chapterIdx];
  const total = book?.chapters.length || 0;
  const isFirst = chapterIdx <= 0;
  const isLast = chapterIdx >= total - 1;
  const bookTitle = book?.title || file.name;

  const cycleTheme = () => setReaderTheme((t) => READER_THEMES[(READER_THEMES.indexOf(t) + 1) % READER_THEMES.length]);

  const toolBtn = (label: string, onPress: () => void, content: React.ReactNode, disabled = false) => (
    <TouchableOpacity
      style={[styles.toolBtn, { borderColor: palette.border, opacity: disabled ? 0.35 : 1 }]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={HIT}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      {content}
    </TouchableOpacity>
  );

  const renderTocItem = ({ item, index }: { item: TocEntry; index: number }) => {
    const active = item.chapterIdx === chapterIdx
      && (book?.toc.findIndex((t) => t.chapterIdx === chapterIdx) === index);
    return (
      <TouchableOpacity
        style={[styles.tocItem, { borderBottomColor: palette.border, backgroundColor: active ? palette.card : 'transparent', paddingLeft: 16 + item.depth * 16 }]}
        onPress={() => { setShowToc(false); goToChapter(item.chapterIdx, item.fragment); }}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, bölüm ${item.chapterIdx + 1}`}
        accessibilityState={{ selected: active }}
      >
        <Text style={[styles.tocText, { color: active ? ACCENT : palette.text, fontWeight: active ? '800' : '500' }]} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={[styles.tocNum, { color: palette.muted }]}>{item.chapterIdx + 1}</Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: currentColors.background }]}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={[styles.loadingText, { color: currentColors.textMuted }]}>E-kitap hazırlanıyor...</Text>
      </View>
    );
  }

  if (loadError || !book) {
    return (
      <View style={[styles.center, { backgroundColor: currentColors.background }]}>
        <Ionicons name="book-outline" size={48} color={currentColors.textMuted} />
        <Text style={[styles.errorText, { color: currentColors.textSecondary, marginTop: 12 }]}>
          {loadError || 'Bu e-kitap ayrıştırılamadı veya boş bir içerik.'}
        </Text>
        <TouchableOpacity
          style={[styles.retryBtn, { backgroundColor: ACCENT }]}
          onPress={() => setReloadKey((k) => k + 1)}
          accessibilityRole="button"
          accessibilityLabel="Yeniden dene"
        >
          <Text style={styles.retryText}>Yeniden dene</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.bg }]}>
      <View style={[styles.headerBar, { backgroundColor: palette.card, borderBottomColor: palette.border }]}>
        <View style={styles.bookInfo}>
          <Text style={[styles.bookTitle, { color: palette.text }]} numberOfLines={1}>{bookTitle}</Text>
          <Text style={[styles.chapterTitle, { color: ACCENT }]} numberOfLines={1}>
            {currentChapter?.title || `Bölüm ${chapterIdx + 1}`}
          </Text>
        </View>
        <View style={styles.toolGroup}>
          {toolBtn('İçindekiler', () => setShowToc(true), <Ionicons name="list" size={20} color={palette.text} />)}
          {toolBtn('Yazıyı küçült', () => setFontSize((f) => Math.max(MIN_FONT, f - 2)), <Text style={[styles.toolBtnText, { color: palette.text }]}>A-</Text>, fontSize <= MIN_FONT)}
          {toolBtn('Yazıyı büyüt', () => setFontSize((f) => Math.min(MAX_FONT, f + 2)), <Text style={[styles.toolBtnText, { color: palette.text }]}>A+</Text>, fontSize >= MAX_FONT)}
          {toolBtn(`Okuma teması: ${THEME_LABEL[readerTheme]}. Değiştir`, cycleTheme, <Ionicons name={THEME_ICON[readerTheme]} size={20} color={palette.text} />)}
        </View>
      </View>

      <View style={[styles.progressTrack, { backgroundColor: palette.border }]}>
        <View style={[styles.progressFill, { width: `${Math.round(((chapterIdx + 1) / Math.max(1, total)) * 100)}%` }]} />
      </View>

      <View style={styles.webViewWrapper}>
        {chapterError ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={44} color={palette.muted} />
            <Text style={[styles.errorText, { color: palette.text, marginTop: 12 }]}>{chapterError}</Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: ACCENT }]}
              onPress={() => setChapterReload((k) => k + 1)}
              accessibilityRole="button"
              accessibilityLabel="Bölümü yeniden dene"
            >
              <Text style={styles.retryText}>Yeniden dene</Text>
            </TouchableOpacity>
          </View>
        ) : pageHtml === null ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={ACCENT} />
          </View>
        ) : (
          <WebView
            key={`${chapterIdx}_${chapterReload}`}
            ref={webRef}
            originWhitelist={['*']}
            source={{ html: pageHtml }}
            style={{ backgroundColor: palette.bg }}
            showsVerticalScrollIndicator={false}
            javaScriptEnabled
            domStorageEnabled={false}
            setSupportMultipleWindows={false}
            allowFileAccess={false}
            allowUniversalAccessFromFileURLs={false}
            allowFileAccessFromFileURLs={false}
            mixedContentMode="never"
            startInLoadingState
            renderLoading={() => (
              <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: palette.bg }]}>
                <ActivityIndicator size="large" color={ACCENT} />
              </View>
            )}
            onShouldStartLoadWithRequest={onShouldStart}
            onLoadEnd={onPageLoaded}
            onError={() => setChapterError('Bölüm görüntülenemedi.')}
            onHttpError={() => setChapterError('Bölüm görüntülenemedi.')}
          />
        )}
      </View>

      <View style={[styles.bottomBar, { backgroundColor: palette.card, borderTopColor: palette.border }]}>
        <TouchableOpacity
          style={[styles.navBtn, isFirst && styles.navBtnDisabled]}
          onPress={() => goToChapter(chapterIdx - 1)}
          disabled={isFirst}
          accessibilityRole="button"
          accessibilityLabel="Önceki bölüm"
          accessibilityState={{ disabled: isFirst }}
        >
          <Ionicons name="chevron-back" size={20} color={palette.text} />
          <Text style={[styles.navBtnText, { color: palette.text }]}>Önceki</Text>
        </TouchableOpacity>

        <Text style={[styles.progressText, { color: palette.text }]} accessibilityLabel={`Bölüm ${chapterIdx + 1} / ${total}`}>
          {chapterIdx + 1} / {total}
        </Text>

        <TouchableOpacity
          style={[styles.navBtn, isLast && styles.navBtnDisabled]}
          onPress={() => goToChapter(chapterIdx + 1)}
          disabled={isLast}
          accessibilityRole="button"
          accessibilityLabel="Sonraki bölüm"
          accessibilityState={{ disabled: isLast }}
        >
          <Text style={[styles.navBtnText, { color: palette.text }]}>Sonraki</Text>
          <Ionicons name="chevron-forward" size={20} color={palette.text} />
        </TouchableOpacity>
      </View>

      <Modal visible={showToc} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowToc(false)}>
        <View style={[styles.modal, { backgroundColor: palette.bg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: palette.border }]}>
            <Text style={[styles.modalTitle, { color: palette.text }]}>İçindekiler</Text>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => setShowToc(false)}
              hitSlop={HIT}
              accessibilityRole="button"
              accessibilityLabel="Kapat"
            >
              <Ionicons name="close" size={24} color={palette.text} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={book.toc}
            keyExtractor={(t, i) => `${i}_${t.chapterIdx}_${t.fragment}`}
            renderItem={renderTocItem}
            initialNumToRender={20}
            windowSize={9}
            extraData={chapterIdx}
          />
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingText: { marginTop: 16, fontSize: 14 },
  errorText: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  retryBtn: { marginTop: 16, minHeight: 44, paddingHorizontal: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1 },
  bookInfo: { flex: 1, marginRight: 8 },
  bookTitle: { fontSize: 14, fontWeight: '800' },
  chapterTitle: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  toolGroup: { flexDirection: 'row', gap: 4 },
  toolBtn: { minWidth: 44, minHeight: 44, borderRadius: 8, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  toolBtnText: { fontSize: 14, fontWeight: '800' },
  progressTrack: { height: 3 },
  progressFill: { height: 3, backgroundColor: ACCENT },
  webViewWrapper: { flex: 1 },
  bottomBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 4, borderTopWidth: 1 },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, minWidth: 44, paddingHorizontal: 10 },
  navBtnDisabled: { opacity: 0.35 },
  navBtnText: { fontSize: 13, fontWeight: '700' },
  progressText: { fontSize: 13, fontWeight: '700' },
  modal: { flex: 1 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
  modalTitle: { fontSize: 17, fontWeight: '800' },
  closeBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  tocItem: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingRight: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  tocText: { flex: 1, fontSize: 15 },
  tocNum: { fontSize: 12, marginLeft: 8 },
});
