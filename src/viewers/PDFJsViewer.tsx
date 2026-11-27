// Gelişmiş PDF görüntüleyici: pdf.js (WebView, tamamen çevrimdışı). Metin içeren PDF'lerde arama + sayfa içi işaretleme.
// Taranmış (resim) PDF'lerde metin olmadığı için arama sonuç vermez (OCR yoktur).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ActivityIndicator, Keyboard } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { FileInfo, AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import { FileService } from '../services/fileService';
import { buildPdfHtml, PDFJS_BASE_URL } from './pdfjs/buildHtml';
import { WebSearchBar } from './WebSearchBar';
import { t } from '../i18n';

interface Props {
  file: FileInfo;
  appTheme?: AppThemeMode;
  /** Gelişmiş motor açamazsa kullanıcı hızlı (yerel) motora geçebilsin. */
  onFallback?: () => void;
}

const CHUNK_BYTES = 786432; // 3'ün katı: her parça bağımsız base64 çözülebilir
const SAVE_DEBOUNCE_MS = 1000;
const HIT = { top: 6, bottom: 6, left: 6, right: 6 };

type Status = 'loading' | 'ready' | 'error';

interface WebMsg {
  t: string;
  [k: string]: unknown;
}

function friendlyError(name: string, message: string): string {
  switch (name) {
    case 'InvalidPDFException': return t('pdf.err.invalid');
    case 'MissingPDFException': return t('pdf.err.missing');
    case 'PasswordException': return t('pdf.passwordProtected');
    case 'NoEngine': return t('pdf.err.noEngine');
    default: return message ? t('pdf.err.withMessage', { message }) : t('pdf.openFailTitle');
  }
}

export const PDFJsViewer: React.FC<Props> = ({ file, appTheme = 'emerald', onFallback }) => {
  const c = Colors[appTheme] || Colors.emerald;
  const webRef = useRef<WebView>(null);
  const html = useMemo(() => buildPdfHtml(c.background, c.textMuted), [c.background, c.textMuted]);

  const initialPage = useRef<number>(Math.max(1, Math.floor(file.lastReadPage || 1))).current;
  const [status, setStatus] = useState<Status>('loading');
  const [errorText, setErrorText] = useState<string>('');
  const [transferPct, setTransferPct] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [pageInput, setPageInput] = useState<string>(String(initialPage));
  const [reloadKey, setReloadKey] = useState<number>(0);

  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchText, setSearchText] = useState<string>('');
  const [searchCount, setSearchCount] = useState<number>(0);
  const [searchIndex, setSearchIndex] = useState<number>(-1);
  const [scanPct, setScanPct] = useState<number | null>(null);

  const [pwVisible, setPwVisible] = useState<boolean>(false);
  const [pwWrong, setPwWrong] = useState<boolean>(false);
  const [pwDraft, setPwDraft] = useState<string>('');

  const alive = useRef(true);
  const transferStarted = useRef(false);
  const ackResolver = useRef<(() => void) | null>(null);
  const latestPage = useRef<number>(initialPage);
  const savedPage = useRef<number>(file.lastReadPage || 0);
  const loadedRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback((js: string) => { webRef.current?.injectJavaScript(`${js};true;`); }, []);

  // ---- Son okunan sayfa
  const flushSave = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (!loadedRef.current || file.virtual) return;
    const p = latestPage.current;
    if (p !== savedPage.current) {
      savedPage.current = p;
      FileService.updateLastReadPage(file.id, p).catch(() => undefined);
    }
  }, [file.id, file.virtual]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const r = ackResolver.current;
      ackResolver.current = null;
      r?.();
      flushSave();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [flushSave]);

  const waitAck = useCallback(() => new Promise<void>((resolve) => { ackResolver.current = resolve; }), []);

  // ---- Dosyayı parça parça WebView'a aktar
  const transfer = useCallback(async () => {
    try {
      const info = await FileSystem.getInfoAsync(file.uri);
      const size = info.exists && typeof info.size === 'number' ? info.size : 0;
      if (!size) throw new Error(t('epub.emptyFile'));
      const first = waitAck();
      run(`window.__pdf.begin(${size})`);
      await first;
      for (let off = 0; off < size; off += CHUNK_BYTES) {
        if (!alive.current) return;
        const len = Math.min(CHUNK_BYTES, size - off);
        const b64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64, position: off, length: len });
        const ack = waitAck();
        run(`window.__pdf.chunk(${off},"${b64}")`);
        await ack;
        if (alive.current) setTransferPct(Math.round(((off + len) / size) * 100));
      }
      if (alive.current) run('window.__pdf.open("")');
    } catch (e) {
      if (!alive.current) return;
      setErrorText(e instanceof Error && e.message ? e.message : t('codeViewer.readFailShort'));
      setStatus('error');
    }
  }, [file.uri, run, waitAck]);

  // ---- Arama (hizli gecikme; temizlemede aninda)
  useEffect(() => {
    if (status !== 'ready') return;
    const q = searchOpen ? searchText.trim() : '';
    if (!q) {
      run('window.__pdf.clear()');
      setSearchCount(0);
      setSearchIndex(-1);
      setScanPct(null);
      return;
    }
    const h = setTimeout(() => {
      run(`window.__pdf.search(${JSON.stringify(q)})`);
    }, 150);
    return () => clearTimeout(h);
  }, [searchOpen, searchText, status, run]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let m: WebMsg;
    try { m = JSON.parse(e.nativeEvent.data) as WebMsg; } catch { return; }
    switch (m.t) {
      case 'ready':
        if (!transferStarted.current) { transferStarted.current = true; void transfer(); }
        break;
      case 'ack': {
        const r = ackResolver.current; ackResolver.current = null; r?.();
        break;
      }
      case 'password':
        setPwWrong(m.reason === 2);
        setPwDraft('');
        setPwVisible(true);
        break;
      case 'loaded': {
        loadedRef.current = true;
        setPwVisible(false);
        setTotalPages(Number(m.pages) || 0);
        setStatus('ready');
        if (initialPage > 1) run(`window.__pdf.goto(${initialPage})`);
        break;
      }
      case 'page': {
        const n = Number(m.n);
        if (!isFinite(n) || n < 1) break;
        latestPage.current = n;
        setCurrentPage(n);
        setPageInput(String(n));
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
        break;
      }
      case 'search': {
        setSearchCount(Number(m.count) || 0);
        setSearchIndex(typeof m.index === 'number' ? m.index : -1);
        const total = Number(m.total) || 0;
        setScanPct(m.done || !total ? null : Math.round(((Number(m.scanned) || 0) / total) * 100));
        break;
      }
      case 'error':
        setErrorText(friendlyError(String(m.name || ''), String(m.message || '')));
        setStatus('error');
        break;
      default:
        break;
    }
  }, [transfer, run, initialPage, flushSave]);

  const retry = useCallback(() => {
    transferStarted.current = false;
    ackResolver.current = null;
    loadedRef.current = false;
    setStatus('loading');
    setErrorText('');
    setTransferPct(0);
    setTotalPages(0);
    setReloadKey((k) => k + 1);
  }, []);

  const goToPage = useCallback((raw: number) => {
    if (!isFinite(raw)) return;
    const page = Math.max(1, Math.min(totalPages || 1, Math.floor(raw)));
    run(`window.__pdf.goto(${page})`);
    latestPage.current = page;
    setCurrentPage(page);
    setPageInput(String(page));
  }, [run, totalPages]);

  const submitPageInput = useCallback(() => {
    Keyboard.dismiss();
    const n = parseInt(pageInput, 10);
    if (isNaN(n)) { setPageInput(String(currentPage)); return; }
    goToPage(n);
  }, [pageInput, currentPage, goToPage]);

  const submitPassword = useCallback(() => {
    if (!pwDraft) return;
    Keyboard.dismiss();
    setPwVisible(false);
    run(`window.__pdf.pw(${JSON.stringify(pwDraft)})`);
  }, [pwDraft, run]);

  const iconBtn = (label: string, icon: React.ComponentProps<typeof Ionicons>['name'], onPress: () => void, disabled = false) => (
    <TouchableOpacity
      key={label}
      style={[styles.iconBtn, disabled && { opacity: 0.4 }]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={HIT}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Ionicons name={icon} size={22} color={c.text} />
    </TouchableOpacity>
  );

  if (status === 'error') {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <Ionicons name="alert-circle-outline" size={56} color={c.textMuted} />
        <Text style={[styles.title, { color: c.text }]}>{t('pdf.openFailTitle')}</Text>
        <Text style={[styles.desc, { color: c.textMuted }]}>{errorText}</Text>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: c.primary }]} onPress={retry} accessibilityRole="button" accessibilityLabel={t('common.retry')}>
            <Ionicons name="refresh" size={20} color={c.onPrimary} />
            <Text style={[styles.primaryBtnText, { color: c.onPrimary }]}>{t('common.retry')}</Text>
          </TouchableOpacity>
          {onFallback ? (
            <TouchableOpacity style={[styles.secondaryBtn, { borderColor: c.border }]} onPress={onFallback} accessibilityRole="button" accessibilityLabel={t('pdf.openFast')}>
              <Ionicons name="flash-outline" size={20} color={c.text} />
              <Text style={[styles.secondaryBtnText, { color: c.text }]}>{t('pdf.openFast')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }

  const busy = scanPct !== null ? t('pdf.scanning', { pct: scanPct }) : undefined;

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      {searchOpen ? (
        <WebSearchBar
          colors={c}
          value={searchText}
          onChange={setSearchText}
          count={searchCount}
          index={searchIndex}
          onNext={() => run('window.__pdf.next()')}
          onPrev={() => run('window.__pdf.prev()')}
          onClose={() => { setSearchOpen(false); setSearchText(''); }}
          scopeLabel={t('pdf.scopeTextPdf')}
          busyText={busy}
        />
      ) : null}

      <View style={styles.flex}>
        <WebView
          key={reloadKey}
          ref={webRef}
          source={{ html, baseUrl: PDFJS_BASE_URL }}
          originWhitelist={['https://tdesk-pdf.invalid*', 'about:blank']}
          style={[styles.web, { backgroundColor: c.background }]}
          javaScriptEnabled
          domStorageEnabled={false}
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          allowUniversalAccessFromFileURLs={false}
          allowFileAccessFromFileURLs={false}
          mixedContentMode="never"
          textZoom={100}
          scalesPageToFit
          overScrollMode="never"
          onShouldStartLoadWithRequest={(req) => req.url.startsWith(PDFJS_BASE_URL) || req.url === 'about:blank'}
          onMessage={onMessage}
          onError={() => { setErrorText(t('pdf.viewerLoadFail')); setStatus('error'); }}
          onRenderProcessGone={() => { setErrorText(t('pdf.viewerOom')); setStatus('error'); }}
        />
        {status === 'loading' && (
          <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: c.background }]} pointerEvents="none">
            <ActivityIndicator size="large" color={c.primary} />
            <Text style={[styles.title, { color: c.text, marginTop: 20 }]}>{t('pdf.preparing')}</Text>
            {transferPct > 0 && transferPct < 100 ? (
              <Text style={{ color: c.primary, marginTop: 10, fontSize: 18, fontWeight: '800' }}>%{transferPct}</Text>
            ) : null}
          </View>
        )}
      </View>

      <View style={[styles.bottomBar, { backgroundColor: c.card, borderTopColor: c.border }]}>
        {iconBtn(t('pdf.prevPage'), 'chevron-back', () => goToPage(currentPage - 1), status !== 'ready' || currentPage <= 1)}
        <View style={styles.pageBox}>
          <TextInput
            style={[styles.pageInput, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
            value={pageInput}
            onChangeText={(t) => setPageInput(t.replace(/[^0-9]/g, '').slice(0, 5))}
            onSubmitEditing={submitPageInput}
            onBlur={submitPageInput}
            keyboardType="number-pad"
            returnKeyType="go"
            selectTextOnFocus
            editable={status === 'ready'}
            accessibilityLabel={t('pdf.goToPageA11y', { page: currentPage })}
          />
          <Text style={[styles.pageTotal, { color: c.textSecondary }]}>/ {totalPages || '?'}</Text>
        </View>
        {iconBtn(t('pdf.nextPage'), 'chevron-forward', () => goToPage(currentPage + 1), status !== 'ready' || (totalPages > 0 && currentPage >= totalPages))}
        <View style={styles.flex} />
        {iconBtn(t('image.zoomOut'), 'remove-circle-outline', () => run('window.__pdf.zoomBy(0.8)'), status !== 'ready')}
        {iconBtn(t('image.zoomIn'), 'add-circle-outline', () => run('window.__pdf.zoomBy(1.25)'), status !== 'ready')}
        {iconBtn(t('viewers.searchInDoc'), 'search', () => setSearchOpen((o) => !o), status !== 'ready')}
      </View>

      <Modal visible={pwVisible} transparent animationType="fade" onRequestClose={() => { setPwVisible(false); setErrorText(t('pdf.passwordProtected')); setStatus('error'); }}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.title, { color: c.text, marginTop: 0 }]}>{t('pdf.passwordTitle')}</Text>
            <Text style={[styles.desc, { color: pwWrong ? c.danger : c.textMuted }]}>
              {pwWrong ? t('pdf.passwordWrong') : t('pdf.passwordNeeded')}
            </Text>
            <TextInput
              style={[styles.pwInput, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
              value={pwDraft}
              onChangeText={setPwDraft}
              secureTextEntry
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={submitPassword}
              accessibilityLabel={t('pdf.passwordA11y')}
            />
            <View style={styles.row}>
              <TouchableOpacity style={[styles.secondaryBtn, { borderColor: c.border }]} onPress={() => { setPwVisible(false); setErrorText(t('pdf.passwordProtected')); setStatus('error'); }} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
                <Text style={[styles.secondaryBtnText, { color: c.text }]}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: c.primary }]} onPress={submitPassword} accessibilityRole="button" accessibilityLabel={t('common.open')}>
                <Text style={[styles.primaryBtnText, { color: c.onPrimary }]}>{t('common.open')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  web: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 18, fontWeight: '800', marginTop: 16, textAlign: 'center' },
  desc: { fontSize: 14, marginTop: 8, textAlign: 'center', lineHeight: 20 },
  row: { flexDirection: 'row', gap: 10, marginTop: 20, flexWrap: 'wrap', justifyContent: 'center' },
  primaryBtn: { minHeight: 44, paddingHorizontal: 18, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  primaryBtnText: { fontWeight: '800', fontSize: 14 },
  secondaryBtn: { minHeight: 44, paddingHorizontal: 18, borderRadius: 10, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  secondaryBtnText: { fontWeight: '700', fontSize: 14 },
  bottomBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderTopWidth: 1, gap: 2 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pageBox: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pageInput: { minWidth: 52, height: 40, borderWidth: 1, borderRadius: 8, textAlign: 'center', fontSize: 15, paddingHorizontal: 6 },
  pageTotal: { fontSize: 14, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 380, borderRadius: 14, borderWidth: 1, padding: 20 },
  pwInput: { marginTop: 14, minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
});
