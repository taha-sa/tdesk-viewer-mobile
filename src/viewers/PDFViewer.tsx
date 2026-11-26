import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, FlatList, ActivityIndicator, TextInput,
  useWindowDimensions, Keyboard, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { FileInfo, AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import { FileService } from '../services/fileService';
import { t } from '../i18n';

// react-native-pdf yerel (native) modül gerektirir (Expo Go'da yoktur). Statik import uygulamayı düşürürdü;
// bu yüzden ilk kullanımda, try/catch ile yüklenir.
type PdfComponent = React.ComponentType<any>;
let cachedPdf: PdfComponent | null | undefined;
function getPdfComponent(): PdfComponent | null {
  if (cachedPdf !== undefined) return cachedPdf;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-pdf');
    cachedPdf = (mod && (mod.default || mod)) as PdfComponent;
  } catch (e) {
    console.warn('PDF motoru yüklenemedi:', e);
    cachedPdf = null;
  }
  return cachedPdf;
}

interface PDFViewerProps { file: FileInfo; appTheme?: AppThemeMode; }

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const SAVE_DEBOUNCE_MS = 1000;
const HIT = { top: 6, bottom: 6, left: 6, right: 6 };

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message?: unknown }).message ?? '');
  return String(err ?? '');
}

export const PDFViewer: React.FC<PDFViewerProps> = ({ file, appTheme = 'emerald' }) => {
  const c = Colors[appTheme] || Colors.emerald;
  const { width: winWidth } = useWindowDimensions();
  const PdfComp = useMemo(() => getPdfComponent(), []);
  const pdfRef = useRef<{ setPage: (p: number) => void } | null>(null);

  const initialPage = useRef<number>(Math.max(1, Math.floor(file.lastReadPage || 1))).current;
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [pageInput, setPageInput] = useState<string>(String(initialPage));
  const [isGridVisible, setIsGridVisible] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [progress, setProgress] = useState<number>(0);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState<boolean>(false);
  const [passwordTried, setPasswordTried] = useState<boolean>(false);
  const [passwordDraft, setPasswordDraft] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [reloadKey, setReloadKey] = useState<number>(0);

  const source = useMemo(() => ({ uri: file.uri, cache: true }), [file.uri]);
  // ÖNEMLİ (Android): react-native-pdf, native bir prop (scale, page, style...) değiştiğinde belgeyi BAŞTAN yükler
  // (PdfManager.onAfterUpdateTransaction → drawPdf). Bu yüzden yakınlaştırma yalnızca yerleşik hareketlerle
  // (çimdik / çift dokunma) yapılır; scale prop'u sabit tutulur ve onScaleChanged state'e geri yazılmaz.
  const pdfStyle = useMemo(() => [styles.pdf, { width: winWidth }], [winWidth]);

  // ---- Son okunan sayfa: debounce + unmount'ta son kayıt
  const latestPage = useRef<number>(initialPage);
  const savedPage = useRef<number>(file.lastReadPage || 0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef<boolean>(false);
  const fileIdRef = useRef<string>(file.id);
  fileIdRef.current = file.id;

  const flushSave = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (!loadedRef.current || file.virtual) return;
    const page = latestPage.current;
    if (page !== savedPage.current) {
      savedPage.current = page;
      FileService.updateLastReadPage(fileIdRef.current, page).catch(() => { /* kayıt kritik değil */ });
    }
  }, [file.virtual]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  useEffect(() => () => flushSave(), [flushSave]);

  const goToPage = useCallback((raw: number) => {
    if (!isFinite(raw)) return;
    const max = totalPages || Number.MAX_SAFE_INTEGER;
    const page = Math.max(1, Math.min(max, Math.floor(raw)));
    pdfRef.current?.setPage(page);
    latestPage.current = page;
    setCurrentPage(page);
    setPageInput(String(page));
    scheduleSave();
  }, [totalPages, scheduleSave]);

  const submitPageInput = useCallback(() => {
    Keyboard.dismiss();
    const n = parseInt(pageInput, 10);
    if (isNaN(n)) { setPageInput(String(currentPage)); return; }
    goToPage(n);
  }, [pageInput, currentPage, goToPage]);

  const handleError = useCallback((err: unknown) => {
    const msg = errorMessage(err);
    setIsLoading(false);
    if (/password/i.test(msg)) {
      setNeedsPassword(true);
      setErrorText(null);
      return;
    }
    console.warn('PDF Error:', msg);
    setErrorText(msg || t('pdf.openFailTitle'));
  }, []);

  const retry = useCallback(() => {
    setErrorText(null);
    setNeedsPassword(false);
    setIsLoading(true);
    setProgress(0);
    setReloadKey((k) => k + 1);
  }, []);

  const submitPassword = useCallback(() => {
    if (!passwordDraft) return;
    Keyboard.dismiss();
    setPasswordTried(true);
    setPassword(passwordDraft);
    setNeedsPassword(false);
    setErrorText(null);
    setIsLoading(true);
    setProgress(0);
    setReloadKey((k) => k + 1);
  }, [passwordDraft]);

  const shareFile = useCallback(async () => {
    await FileService.shareFile({ ...file, mimeType: file.mimeType || 'application/pdf' });
  }, [file]);

  // ---- Küçük resim ızgarası: gerçek PDF render'ı yok, yalnız sayfa numarası kutuları (sanallaştırılmış)
  const gridCols = winWidth >= 600 ? 6 : 4;
  const cellSize = Math.max(56, (winWidth - 32 - gridCols * 8) / gridCols);
  const pageList = useMemo(() => Array.from({ length: totalPages }, (_, i) => i + 1), [totalPages]);

  const openGridPage = useCallback((page: number) => {
    setIsGridVisible(false);
    goToPage(page);
  }, [goToPage]);

  const renderCell = useCallback(({ item }: { item: number }) => {
    const active = item === currentPage;
    return (
      <TouchableOpacity
        style={[styles.cell, { width: cellSize, height: cellSize * 1.2, borderColor: active ? c.primary : c.border, backgroundColor: active ? c.primary : c.surface }]}
        onPress={() => openGridPage(item)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={t('pdf.pageA11y', { page: item })}
        accessibilityState={{ selected: active }}
      >
        <Ionicons name="document-text-outline" size={18} color={active ? '#0B0F19' : c.textMuted} />
        <Text style={[styles.cellText, { color: active ? '#0B0F19' : c.text }]}>{item}</Text>
      </TouchableOpacity>
    );
  }, [cellSize, currentPage, c, openGridPage]);

  const iconBtn = (label: string, icon: React.ComponentProps<typeof Ionicons>['name'], onPress: () => void, disabled = false) => (
    <TouchableOpacity
      style={[styles.iconBtn, { opacity: disabled ? 0.35 : 1 }]}
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

  // ---- PDF motoru yok
  if (!PdfComp) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <Ionicons name="document-outline" size={56} color={c.textMuted} />
        <Text style={[styles.title, { color: c.text }]}>{t('pdf.noEngineTitle')}</Text>
        <Text style={[styles.desc, { color: c.textMuted }]}>
          {t('pdf.noEngineBody')}
        </Text>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: c.primary }]}
          onPress={shareFile}
          accessibilityRole="button"
          accessibilityLabel={t('viewer.shareOpenA11y')}
        >
          <Ionicons name="share-outline" size={20} color="#0B0F19" />
          <Text style={styles.primaryBtnText}>{t('viewer.shareOpen')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---- Parola istemi
  if (needsPassword) {
    return (
      <KeyboardAvoidingView style={[styles.center, { backgroundColor: c.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Ionicons name="lock-closed-outline" size={52} color={c.primary} />
        <Text style={[styles.title, { color: c.text }]}>{t('pdf.protectedTitle')}</Text>
        {passwordTried && <Text style={[styles.desc, { color: '#EF4444' }]}>{t('pdf.passwordWrong')}</Text>}
        <TextInput
          style={[styles.pwInput, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
          value={passwordDraft}
          onChangeText={setPasswordDraft}
          placeholder={t('pdf.passwordPlaceholder')}
          placeholderTextColor={c.textMuted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          onSubmitEditing={submitPassword}
          returnKeyType="done"
          accessibilityLabel={t('pdf.passwordA11y')}
        />
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: c.primary, opacity: passwordDraft ? 1 : 0.5 }]}
          onPress={submitPassword}
          disabled={!passwordDraft}
          accessibilityRole="button"
          accessibilityLabel={t('pdf.openA11y')}
        >
          <Text style={styles.primaryBtnText}>{t('common.open')}</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    );
  }

  // ---- Genel hata
  if (errorText !== null) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <Ionicons name="alert-circle-outline" size={56} color={c.textMuted} />
        <Text style={[styles.title, { color: c.text }]}>{t('pdf.openFailTitle')}</Text>
        <Text style={[styles.desc, { color: c.textMuted }]}>
          {t('pdf.openFailBody')}
        </Text>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: c.primary }]} onPress={retry} accessibilityRole="button" accessibilityLabel={t('common.retry')}>
            <Ionicons name="refresh" size={20} color="#0B0F19" />
            <Text style={styles.primaryBtnText}>{t('common.retry')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondaryBtn, { borderColor: c.border }]} onPress={shareFile} accessibilityRole="button" accessibilityLabel={t('pdf.openInOther')}>
            <Ionicons name="share-outline" size={20} color={c.text} />
            <Text style={[styles.secondaryBtnText, { color: c.text }]}>{t('pdf.openInOther')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={styles.flex}>
        <PdfComp
          key={`${file.uri}|${reloadKey}`}
          ref={pdfRef}
          source={source}
          page={initialPage}
          scale={1}
          minScale={MIN_SCALE}
          maxScale={MAX_SCALE}
          password={password}
          style={pdfStyle}
          fitPolicy={0}
          enablePaging={false}
          horizontal={false}
          spacing={10}
          trustAllCerts={false}
          renderActivityIndicator={() => <View />}
          onLoadProgress={(p: number) => setProgress(Math.max(0, Math.min(1, Number(p) || 0)))}
          onLoadComplete={(n: number) => {
            loadedRef.current = true;
            setTotalPages(n);
            setIsLoading(false);
            setPasswordTried(false);
            if (initialPage > n && n > 0) {
              latestPage.current = n;
              setCurrentPage(n);
              setPageInput(String(n));
              pdfRef.current?.setPage(n);
            }
          }}
          onPageChanged={(page: number) => {
            if (!isFinite(page) || page < 1) return;
            latestPage.current = page;
            setCurrentPage(page);
            setPageInput(String(page));
            scheduleSave();
          }}
          onError={handleError}
        />
        {isLoading && (
          <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: c.background }]}>
            <ActivityIndicator size="large" color={c.primary} />
            <Text style={[styles.title, { color: c.text, marginTop: 20 }]}>{t('pdf.processing')}</Text>
            <Text style={[styles.desc, { color: c.textMuted }]}>{t('pdf.processingHint')}</Text>
            {progress > 0 && progress < 1 && (
              <Text style={{ color: c.primary, marginTop: 12, fontSize: 18, fontWeight: '800' }}>%{Math.round(progress * 100)}</Text>
            )}
          </View>
        )}
      </View>

      <View style={[styles.bottomBar, { backgroundColor: c.card, borderTopColor: c.border }]}>
        {iconBtn(t('pdf.prevPage'), 'chevron-back', () => goToPage(currentPage - 1), currentPage <= 1 || isLoading)}
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
            editable={!isLoading}
            accessibilityLabel={t('pdf.goToPageA11y', { page: currentPage })}
          />
          <Text style={[styles.pageTotal, { color: c.textSecondary }]}>/ {totalPages || '?'}</Text>
        </View>
        {iconBtn(t('pdf.nextPage'), 'chevron-forward', () => goToPage(currentPage + 1), isLoading || (totalPages > 0 && currentPage >= totalPages))}
        <View style={styles.flex} />
        {iconBtn(t('pdf.allPagesA11y'), 'grid', () => setIsGridVisible(true), totalPages === 0)}
      </View>

      <Modal visible={isGridVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setIsGridVisible(false)}>
        <View style={[styles.modal, { backgroundColor: c.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: c.border }]}>
            <Text style={[styles.modalTitle, { color: c.text }]}>{t('pdf.allPagesTitle', { count: totalPages })}</Text>
            <TouchableOpacity style={styles.iconBtn} onPress={() => setIsGridVisible(false)} hitSlop={HIT} accessibilityRole="button" accessibilityLabel={t('common.close')}>
              <Ionicons name="close" size={24} color={c.text} />
            </TouchableOpacity>
          </View>
          <FlatList
            key={`grid-${gridCols}`}
            data={pageList}
            keyExtractor={(item) => String(item)}
            numColumns={gridCols}
            renderItem={renderCell}
            contentContainerStyle={styles.gridContent}
            columnWrapperStyle={styles.gridRow}
            initialNumToRender={gridCols * 6}
            maxToRenderPerBatch={gridCols * 6}
            windowSize={7}
            removeClippedSubviews
            extraData={currentPage}
          />
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  pdf: { flex: 1, backgroundColor: 'transparent' },
  overlay: { alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 17, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  desc: { fontSize: 13, lineHeight: 19, marginTop: 8, textAlign: 'center', paddingHorizontal: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 20 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 18, borderRadius: 10, marginTop: 20, justifyContent: 'center' },
  primaryBtnText: { color: '#0B0F19', fontSize: 14, fontWeight: '700' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, marginTop: 20, justifyContent: 'center' },
  secondaryBtnText: { fontSize: 14, fontWeight: '600' },
  pwInput: { width: '100%', maxWidth: 360, minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, fontSize: 16, marginTop: 20 },
  bottomBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderTopWidth: 1 },
  iconBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  pageBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pageInput: { minWidth: 52, height: 40, borderWidth: 1, borderRadius: 8, textAlign: 'center', fontSize: 14, fontWeight: '700', paddingHorizontal: 6 },
  pageTotal: { fontSize: 13, fontWeight: '700' },
  modal: { flex: 1, paddingHorizontal: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1 },
  modalTitle: { fontSize: 17, fontWeight: '800' },
  gridContent: { paddingVertical: 16 },
  gridRow: { gap: 8, marginBottom: 8 },
  cell: { borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', gap: 4 },
  cellText: { fontSize: 14, fontWeight: '800' },
});
