import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, ActivityIndicator, Alert, BackHandler } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import { FileInfo, AppThemeMode, SyntaxTheme } from '../types';
import { Colors } from '../theme/colors';
import { FormatBadge } from '../components/FormatBadge';
import { FileDetailsModal } from '../components/FileDetailsModal';
import { FileService } from '../services/fileService';
import { ViewerErrorBoundary } from '../components/ViewerErrorBoundary';
import { readTextFileSmart, TextReadError } from '../utils/textEncoding';

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
    Alert.alert('Kaydedilmemiş değişiklikler', 'Çıkarsanız yaptığınız değişiklikler silinecek.', [
      { text: 'Kal', style: 'cancel' },
      { text: 'Sil ve çık', style: 'destructive', onPress: () => { dirtyRef.current = false; onBack(); } },
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
          accessibilityLabel="Paylaş veya başka uygulamada aç"
        >
          <Ionicons name="share-social-outline" size={18} color={currentColors.onPrimary} />
          <Text style={[styles.noticeBtnText, { color: currentColors.onPrimary }]}>Paylaş / Başka uygulamada aç</Text>
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
          'Dosya çok büyük',
          `${g.size ? FileService.formatFileSize(g.size) : 'Bu dosya'} metin olarak açılamayacak kadar büyük (en fazla ${FileService.formatFileSize(TEXT_LIMIT_BYTES)}). Bellek çökmesini önlemek için açılmadı.`
        );
      case 'binary':
        return renderNotice(
          'file-question-outline',
          'Metin dosyası gibi görünmüyor',
          'Bu dosyanın türü tanınmadı ve içeriği ikili veri gibi görünüyor. İsterseniz yine de metin olarak açmayı deneyebilirsiniz; okunamaz karakterler görülebilir.',
          <TouchableOpacity
            style={[styles.noticeBtn, styles.noticeBtnOutline, { borderColor: currentColors.border }]}
            onPress={() => void loadText(initialFile, true)}
            accessibilityRole="button"
            accessibilityLabel="Yine de metin olarak aç"
          >
            <Ionicons name="document-text-outline" size={18} color={currentColors.text} />
            <Text style={[styles.noticeBtnText, { color: currentColors.text }]}>Metin olarak aç</Text>
          </TouchableOpacity>
        );
      case 'not_found':
        return renderNotice(
          'file-remove-outline',
          'Dosya bulunamadı',
          'Bu dosya cihazdan silinmiş veya taşınmış olabilir.'
        );
      default:
        return renderNotice(
          'file-alert-outline',
          'Dosya okunamadı',
          'Dosya okunurken bir sorun oluştu; okuma izni kaldırılmış veya dosya bozuk olabilir.',
          <TouchableOpacity
            style={[styles.noticeBtn, styles.noticeBtnOutline, { borderColor: currentColors.border }]}
            onPress={() => void loadText(initialFile, false)}
            accessibilityRole="button"
            accessibilityLabel="Yeniden dene"
          >
            <Ionicons name="refresh" size={18} color={currentColors.text} />
            <Text style={[styles.noticeBtnText, { color: currentColors.text }]}>Yeniden dene</Text>
          </TouchableOpacity>
        );
    }
  };

  const renderActiveViewer = () => {
    if (gate.kind === 'loading') {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={currentColors.primary} />
          <Text style={{ color: currentColors.textMuted, marginTop: 12 }}>Dosya okunuyor...</Text>
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
          'Bu dosya biçimi desteklenmiyor',
          file.unsupportedReason || 'Bu biçim uygulama içinde görüntülenemiyor. Dosyayı paylaşarak başka bir uygulamada açabilirsiniz.'
        );
      case 'text':
      default:
        return <TextViewer key={viewerKey} file={file} appTheme={appTheme} />;
    }
  };

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
          accessibilityLabel={fromArchive ? 'Arşive dön' : 'Geri'}
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
            style={styles.actionBtn}
            onPress={handleShare}
            disabled={sharing}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityState={{ disabled: sharing }}
            accessibilityLabel="Paylaş"
          >
            <Ionicons name="share-social-outline" size={20} color={currentColors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => setShowDetailsModal(true)}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Dosya bilgileri"
          >
            <Ionicons name="information-circle-outline" size={21} color={currentColors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* İlgili Formatın Görüntüleyici Motoru */}
      <View style={styles.viewerContainer}>
        <ViewerErrorBoundary appTheme={appTheme} onBack={onBack}>{renderActiveViewer()}</ViewerErrorBoundary>
      </View>

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
  viewerContainer: {
    flex: 1,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
