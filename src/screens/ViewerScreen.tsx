import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, ActivityIndicator, Alert, BackHandler, AppState } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import { FileInfo, AppThemeMode, SyntaxTheme } from '../types';
import { Colors } from '../theme/colors';
import { FormatBadge } from '../components/FormatBadge';
import { FileDetailsModal } from '../components/FileDetailsModal';
import { FileService } from '../services/fileService';
import { ViewerErrorBoundary } from '../components/ViewerErrorBoundary';
import { readTextFileSmart, TextReadError } from '../utils/textEncoding';
import { BridgeSheet, BridgeInvite } from '../components/BridgeSheet';
import { PresenterRemote } from '../components/PresenterRemote';
import { isBridgeInstalled, canPresent, canSendToPc, sendToPc, presentOnPc } from '../services/bridgeService';

// Viewers
// PDF görüntüleyici tembel yüklenir (yerel modül yoksa uygulamanın açılışını düşürmesin).
const PDFViewer = React.lazy(async () => ({ default: (require('../viewers/PDFViewer') as typeof import('../viewers/PDFViewer')).PDFViewer }));
const PDFJsViewer = React.lazy(async () => ({ default: (require('../viewers/PDFJsViewer') as typeof import('../viewers/PDFJsViewer')).PDFJsViewer }));
import { loadPdfEngine, canUseAdvancedEngine, PdfEngine } from '../utils/pdfEngine';
import { CodeViewer } from '../viewers/CodeViewer';
import { MarkdownViewer } from '../viewers/MarkdownViewer';
import { SpreadsheetViewer } from '../viewers/SpreadsheetViewer';
import { DocxViewer } from '../viewers/DocxViewer';
import { ImageViewer } from '../viewers/ImageViewer';
import { ArchiveViewer } from '../viewers/ArchiveViewer';
import { TextViewer } from '../viewers/TextViewer';
import { PptxViewer } from '../viewers/PptxViewer';
import { EpubViewer } from '../viewers/EpubViewer';
import { t, resolveRef } from '../i18n';

interface ViewerScreenProps {
  file: FileInfo;
  appTheme?: AppThemeMode;
  defaultCodeTheme?: SyntaxTheme;
  onBack: () => void;
  onOpenFile?: (file: FileInfo) => void;
}

/** Metin görüntüleyicilerin açabileceği en büyük dosya (bellek koruması). */
const TEXT_LIMIT_BYTES = 2 * 1024 * 1024;
const TEXTUAL = ['code', 'markdown', 'text', 'unknown'];
const HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 };

type BlockReason = 'too_large' | 'binary' | 'not_found' | 'read_failed';
type Gate =
  | { kind: 'loading' }
  | { kind: 'ready'; file: FileInfo }
  | { kind: 'blocked'; reason: BlockReason; size?: number };

function needsPreload(file: FileInfo): boolean {
  return TEXTUAL.includes(file.category) && typeof file.content !== 'string';
}

export const ViewerScreen: React.FC<ViewerScreenProps> = ({
  file: initialFile,
  appTheme = 'dark',
  defaultCodeTheme = 'vscode-dark',
  onBack,
  onOpenFile,
}) => {
  const [gate, setGate] = useState<Gate>(() => (needsPreload(initialFile) ? { kind: 'loading' } : { kind: 'ready', file: initialFile }));
  const [showDetailsModal, setShowDetailsModal] = useState<boolean>(false);
  const [sharing, setSharing] = useState<boolean>(false);
  const [bridgeInstalled, setBridgeInstalled] = useState<boolean>(() => isBridgeInstalled());
  const [bridgeInvite, setBridgeInvite] = useState<'send' | 'present' | null>(null);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setBridgeInstalled(isBridgeInstalled());
    });
    return () => subscription.remove();
  }, []);
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);
  const [presenting, setPresenting] = useState<boolean>(false);
  const [presentStarting, setPresentStarting] = useState<boolean>(false);
  const [presentError, setPresentError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // PDF motoru: ayarlardan okunur (gelişmiş = pdf.js ile arama); uygun olmayan dosyada veya hata sonrası hızlı (yerel) motor.
  const [pdfEngine, setPdfEngine] = useState<PdfEngine | null>(initialFile.category === 'pdf' ? null : 'fast');
  const [pdfForceFast, setPdfForceFast] = useState<boolean>(false);
  useEffect(() => {
    if (initialFile.category !== 'pdf') return;
    let alive = true;
    loadPdfEngine().then((e) => { if (alive) setPdfEngine(e); });
    return () => { alive = false; };
  }, [initialFile.category]);
  const sharingRef = useRef(false);
  // Kaydedilmemiş düzenleme (Kod/Tablo görüntüleyicileri bildirir): çıkarken onay istenir.
  const dirtyRef = useRef(false);
  const handleDirtyChange = useCallback((d: boolean) => { dirtyRef.current = d; }, []);
  const confirmedBack = useCallback(() => {
    if (!dirtyRef.current) { onBack(); return; }
    Alert.alert(t('viewer.unsavedTitle'), t('viewer.unsavedBody'), [
      { text: t('viewer.stay'), style: 'cancel' },
      { text: t('viewer.discardLeave'), style: 'destructive', onPress: () => { dirtyRef.current = false; onBack(); } },
    ]);
  }, [onBack]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!dirtyRef.current) return false; // normal akış (App kapatır)
      confirmedBack();
      return true;
    });
    return () => sub.remove();
  }, [confirmedBack]);

  const currentColors = Colors[appTheme] || Colors.dark;
  const currentFile = gate.kind === 'ready' ? gate.file : initialFile;
  const fromArchive = !!initialFile.virtual;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Metin türleri için ön kontrol: boyut, ikili içerik, okunabilirlik. Başarısızlıkta boş görüntüleyici AÇILMAZ.
  const loadText = useCallback(async (file: FileInfo, forceText: boolean) => {
    const apply = (g: Gate) => { if (mountedRef.current) setGate(g); };
    if (!forceText && !needsPreload(file)) {
      apply({ kind: 'ready', file });
      return;
    }
    apply({ kind: 'loading' });
    try {
      let known = typeof file.size === 'number' ? file.size : 0;
      try {
        const info = await FileSystem.getInfoAsync(file.uri);
        if (!info.exists) {
          apply({ kind: 'blocked', reason: 'not_found' });
          return;
        }
        if (typeof info.size === 'number' && info.size > 0) known = info.size;
      } catch {
        // content:// gibi kaynaklarda getInfo başarısız olabilir; okumayı yine de dene.
      }
      if (known > TEXT_LIMIT_BYTES) {
        apply({ kind: 'blocked', reason: 'too_large', size: known });
        return;
      }
      // code/text: görüntüleyici kendi kodlama tespitiyle okur (kaydederken özgün kodlamayı korur) → yalnız ön kontrol.
      // markdown/unknown/zorla: burada akıllı okunur ve içerik görüntüleyiciye verilir.
      const needContent = file.category === 'markdown' || file.category === 'unknown' || forceText;
      if (!needContent) {
        apply({ kind: 'ready', file });
        return;
      }
      const decoded = await readTextFileSmart(file.uri, { maxBytes: TEXT_LIMIT_BYTES, allowBinary: forceText });
      apply({
        kind: 'ready',
        file: { ...file, content: decoded.text, category: file.category === 'unknown' ? 'text' : file.category },
      });
    } catch (e) {
      if (e instanceof TextReadError) {
        if (e.code === 'too_large') apply({ kind: 'blocked', reason: 'too_large', size: e.size });
        else if (e.code === 'binary') apply({ kind: 'blocked', reason: 'binary' });
        else if (e.code === 'not_found') apply({ kind: 'blocked', reason: 'not_found' });
        else apply({ kind: 'blocked', reason: 'read_failed' });
      } else {
        apply({ kind: 'blocked', reason: 'read_failed' });
      }
    }
  }, []);

  useEffect(() => {
    void loadText(initialFile, false);
  }, [initialFile, loadText]);

  const handleShare = useCallback(async () => {
    if (sharingRef.current) return;
    sharingRef.current = true;
    setSharing(true);
    try {
      await FileService.shareFile(currentFile);
    } catch {
      // shareFile kendi uyarısını gösterir; beklenmeyen istisna sessizce yutulur (çökme olmasın).
    } finally {
      sharingRef.current = false;
      if (mountedRef.current) setSharing(false);
    }
  }, [currentFile]);

  const renderNotice = (
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'],
    title: string,
    body: string,
    extra?: React.ReactNode
  ) => (
    <View style={styles.notice} accessibilityRole="alert">
      <MaterialCommunityIcons name={icon} size={44} color={currentColors.warning} />
      <Text style={[styles.noticeTitle, { color: currentColors.text }]}>{title}</Text>
      <Text style={[styles.noticeBody, { color: currentColors.textSecondary }]}>{body}</Text>
      <View style={styles.noticeActions}>
        <TouchableOpacity
          style={[styles.noticeBtn, { backgroundColor: currentColors.primary }, sharing && { opacity: 0.6 }]}
          onPress={handleShare}
          disabled={sharing}
          accessibilityRole="button"
          accessibilityState={{ disabled: sharing }}
          accessibilityLabel={t('viewer.shareOpenA11y')}
        >
          <Ionicons name="share-social-outline" size={18} color={currentColors.onPrimary} />
          <Text style={[styles.noticeBtnText, { color: currentColors.onPrimary }]}>{t('viewer.shareOpen')}</Text>
        </TouchableOpacity>
        {extra}
      </View>
    </View>
  );

  const renderBlocked = (g: Extract<Gate, { kind: 'blocked' }>) => {
    switch (g.reason) {
      case 'too_large':
        return renderNotice(
          'file-alert-outline',
          t('viewer.tooBigTitle'),
          t('viewer.tooBigBody', { size: g.size ? FileService.formatFileSize(g.size) : t('viewer.thisFile'), max: FileService.formatFileSize(TEXT_LIMIT_BYTES) })
        );
      case 'binary':
        return renderNotice(
          'file-question-outline',
          t('viewer.notTextTitle'),
          t('viewer.notTextBody'),
          <TouchableOpacity
            style={[styles.noticeBtn, styles.noticeBtnOutline, { borderColor: currentColors.border }]}
            onPress={() => void loadText(initialFile, true)}
            accessibilityRole="button"
            accessibilityLabel={t('viewer.openAsTextA11y')}
          >
            <Ionicons name="document-text-outline" size={18} color={currentColors.text} />
            <Text style={[styles.noticeBtnText, { color: currentColors.text }]}>{t('viewer.openAsText')}</Text>
          </TouchableOpacity>
        );
      case 'not_found':
        return renderNotice(
          'file-remove-outline',
          t('common.fileNotFound'),
          t('viewer.missingBody')
        );
      default:
        return renderNotice(
          'file-alert-outline',
          t('viewer.readFailTitle'),
          t('viewer.readFailBody'),
          <TouchableOpacity
            style={[styles.noticeBtn, styles.noticeBtnOutline, { borderColor: currentColors.border }]}
            onPress={() => void loadText(initialFile, false)}
            accessibilityRole="button"
            accessibilityLabel={t('common.retry')}
          >
            <Ionicons name="refresh" size={18} color={currentColors.text} />
            <Text style={[styles.noticeBtnText, { color: currentColors.text }]}>{t('common.retry')}</Text>
          </TouchableOpacity>
        );
    }
  };

  const renderActiveViewer = () => {
    if (gate.kind === 'loading') {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={currentColors.primary} />
          <Text style={{ color: currentColors.textMuted, marginTop: 12 }}>{t('viewer.reading')}</Text>
        </View>
      );
    }
    if (gate.kind === 'blocked') return renderBlocked(gate);

    const file = gate.file;
    const viewerKey = file.id || file.uri;

    switch (file.category) {
      case 'pdf': {
        const spinner = <View style={[styles.center, { backgroundColor: currentColors.background }]}><ActivityIndicator size="large" color={currentColors.primary} /></View>;
        if (pdfEngine === null) return spinner;
        const useAdvanced = pdfEngine === 'advanced' && !pdfForceFast && canUseAdvancedEngine(file).ok;
        return (
          <Suspense fallback={spinner}>
            {useAdvanced
              ? <PDFJsViewer key={viewerKey + '-js'} file={file} appTheme={appTheme} onFallback={() => setPdfForceFast(true)} />
              : <PDFViewer key={viewerKey} file={file} appTheme={appTheme} />}
          </Suspense>
        );
      }
      case 'code':
        return <CodeViewer key={viewerKey} file={file} appTheme={appTheme} codeTheme={defaultCodeTheme} onDirtyChange={handleDirtyChange} />;
      case 'markdown':
        return <MarkdownViewer key={viewerKey} file={file} appTheme={appTheme} />;
      case 'spreadsheet':
        return <SpreadsheetViewer key={viewerKey} file={file} appTheme={appTheme} onDirtyChange={handleDirtyChange} />;
      case 'docx':
        return <DocxViewer key={viewerKey} file={file} appTheme={appTheme} />;
      case 'pptx':
        return <PptxViewer key={viewerKey} file={file} appTheme={appTheme} />;
      case 'epub':
        return <EpubViewer key={viewerKey} file={file} appTheme={appTheme} />;
      case 'image':
        return <ImageViewer key={viewerKey} file={file} appTheme={appTheme} />;
      case 'archive':
        return (
          <ArchiveViewer
            key={viewerKey}
            file={file}
            appTheme={appTheme}
            onOpenNestedFile={nested => { if (onOpenFile) onOpenFile(nested); }}
          />
        );
      case 'unsupported':
        return renderNotice(
          'file-alert-outline',
          t('viewer.unsupportedTitle'),
          resolveRef(file.unsupportedReason) || t('viewer.unsupportedBody')
        );
      case 'text':
      default:
        return <TextViewer key={viewerKey} file={file} appTheme={appTheme} />;
    }
  };

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3200);
  }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  const handleSendToPc = useCallback(async (f: FileInfo) => {
    setSheetOpen(false);
    const installed = isBridgeInstalled();
    setBridgeInstalled(installed);
    if (!installed) { setBridgeInvite('send'); return; }
    const err = await sendToPc(f);
    showNotice(err ?? t('viewer.sentToBridge'));
  }, [showNotice]);

  const startPresent = useCallback(async (f: FileInfo) => {
    setSheetOpen(false);
    const installed = isBridgeInstalled();
    setBridgeInstalled(installed);
    if (!installed) { setBridgeInvite('present'); return; }
    setPresenting(true);
    setPresentStarting(true);
    setPresentError(null);
    const err = await presentOnPc(f);
    if (!mountedRef.current) return;
    setPresentStarting(false);
    if (err) setPresentError(err);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: currentColors.background }]}>
      <StatusBar
        barStyle={appTheme === 'light' ? 'dark-content' : 'light-content'}
        backgroundColor={currentColors.surface}
      />

      {/* Üst Başlık ve Eylem Barı */}
      <View style={[styles.header, { backgroundColor: currentColors.surface, borderBottomColor: currentColors.border }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={confirmedBack}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={fromArchive ? t('viewer.backToArchive') : t('common.backShort')}
        >
          <Ionicons name="arrow-back" size={24} color={currentColors.text} />
        </TouchableOpacity>

        <View style={styles.titleInfo}>
          <Text style={[styles.fileName, { color: currentColors.text }]} numberOfLines={1}>
            {currentFile.name}
          </Text>
          <View style={styles.subtitleRow}>
            <FormatBadge type={currentFile.category} extension={currentFile.extension} size="small" theme={appTheme} />
            <Text style={[styles.fileSize, { color: currentColors.textSecondary }]}>
              {FileService.formatFileSize(currentFile.size)}
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: currentColors.primaryGlow, borderRadius: 12 }]}
            onPress={() => { void handleSendToPc(currentFile); }}
            disabled={!canSendToPc(currentFile) || gate.kind !== 'ready'}
            accessibilityRole="button"
            accessibilityLabel={t('bridge.sendTitle')}
            accessibilityHint={!bridgeInstalled ? t('viewer.getBridgeHint') : undefined}
            accessibilityState={{ disabled: !canSendToPc(currentFile) || gate.kind !== 'ready' }}
          >
            <Ionicons name="paper-plane-outline" size={21} color={currentColors.primary} />
            {!bridgeInstalled && <View style={[styles.lockBadge, { backgroundColor: currentColors.surface }]}><Ionicons name="lock-closed" size={11} color={currentColors.text} /></View>}
          </TouchableOpacity>
          {canSendToPc(currentFile) && gate.kind === 'ready' && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => setSheetOpen(true)}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={t('viewer.pcActionsA11y')}
            >
              <Ionicons name="desktop-outline" size={20} color={currentColors.text} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={handleShare}
            disabled={sharing}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityState={{ disabled: sharing }}
            accessibilityLabel={t('common.share')}
          >
            <Ionicons name="share-social-outline" size={20} color={currentColors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => setShowDetailsModal(true)}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={t('viewer.detailsA11y')}
          >
            <Ionicons name="information-circle-outline" size={21} color={currentColors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* İlgili Formatın Görüntüleyici Motoru */}
      <View style={styles.viewerContainer}>
        {presenting ? (
          <PresenterRemote
            appTheme={appTheme}
            fileName={currentFile.name}
            starting={presentStarting}
            startError={presentError}
            onRetry={() => { void startPresent(currentFile); }}
            onClose={() => { setPresenting(false); setPresentError(null); }}
          />
        ) : (
          <ViewerErrorBoundary appTheme={appTheme} onBack={onBack}>{renderActiveViewer()}</ViewerErrorBoundary>
        )}
      </View>

      {notice && (
        <View style={[styles.notice2, { backgroundColor: currentColors.surfaceLight, borderColor: currentColors.border }]} accessibilityLiveRegion="polite">
          <Text style={{ color: currentColors.text, fontSize: 13, fontWeight: '600', textAlign: 'center' }}>{notice}</Text>
        </View>
      )}

      <BridgeSheet
        visible={sheetOpen}
        appTheme={appTheme}
        fileName={currentFile.name}
        canPresent={canPresent(currentFile)}
        locked={!bridgeInstalled}
        onSend={() => { void handleSendToPc(currentFile); }}
        onPresent={() => { void startPresent(currentFile); }}
        onClose={() => setSheetOpen(false)}
      />

      {/* Dosya Bilgi Detay Modalı */}
      <FileDetailsModal
        visible={showDetailsModal}
        file={currentFile}
        theme={appTheme}
        onClose={() => setShowDetailsModal(false)}
        onOpen={() => setShowDetailsModal(false)}
        onShare={handleShare}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  titleInfo: {
    flex: 1,
    marginRight: 6,
  },
  fileName: {
    fontSize: 15,
    fontWeight: '800',
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  fileSize: {
    fontSize: 11,
    fontWeight: '500',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBadge: { position: 'absolute', right: 4, bottom: 4, borderRadius: 8, padding: 2 },
  viewerContainer: {
    flex: 1,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  notice2: { position: 'absolute', left: 16, right: 16, bottom: 24, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1 },
  notice: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  noticeTitle: { fontSize: 17, fontWeight: '700', marginTop: 14, textAlign: 'center' },
  noticeBody: { marginTop: 8, textAlign: 'center', lineHeight: 20, maxWidth: 340 },
  noticeActions: { marginTop: 22, alignItems: 'center', gap: 10 },
  noticeBtn: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  noticeBtnOutline: { borderWidth: 1 },
  noticeBtnText: { fontSize: 14, fontWeight: '800' },
});
