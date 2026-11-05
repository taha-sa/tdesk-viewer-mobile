import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image, ActivityIndicator } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';
import { AppThemeMode, FileInfo } from '../types';
import { Colors } from '../theme/colors';
import { FileService } from '../services/fileService';
import { base64ToBytes, bytesToBase64 } from '../utils/textEncoding';
import { mergePdfBytes, PdfMergeError } from '../utils/pdfMerge';

interface ToolsScreenProps {
  appTheme: AppThemeMode;
  /** Üretilen PDF'i uygulama içinde açmak için (verilmezse "Aç" düğmesi gösterilmez). */
  onOpenFile?: (file: FileInfo) => void;
}

interface PickedImage {
  uri: string;
  mime: string;
  size: number;
}

interface PickedPdf {
  uri: string;
  name: string;
  size: number;
}

interface ToolResult {
  file: FileInfo;
  detail: string;
  /** Son dosyalar listesine kaydedilebildi mi. */
  listed: boolean;
}

const MAX_IMAGES = 40;
const IMAGE_WARN_COUNT = 15;
const IMAGE_WARN_BYTES = 20 * 1024 * 1024;
const IMAGE_MAX_BYTES = 80 * 1024 * 1024;
const PDF_WARN_BYTES = 40 * 1024 * 1024;
const PDF_MAX_BYTES = 120 * 1024 * 1024;
const MAX_PDFS = 30;
const SAFE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

const pad2 = (n: number) => (n < 10 ? '0' + n : String(n));
const stampNow = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
};
const displayStamp = () => {
  const d = new Date();
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}.${pad2(d.getMinutes())}`;
};

const confirm = (title: string, message: string, okText: string): Promise<boolean> =>
  new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Vazgeç', style: 'cancel', onPress: () => resolve(false) },
        { text: okText, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });

export const ToolsScreen: React.FC<ToolsScreenProps> = ({ appTheme, onOpenFile }) => {
  const currentColors = Colors[appTheme] || Colors.emerald;
  const [selectedImages, setSelectedImages] = useState<PickedImage[]>([]);
  const [selectedPdfs, setSelectedPdfs] = useState<PickedPdf[]>([]);
  const [busy, setBusy] = useState<null | 'images' | 'merge'>(null);
  const [mergeProgress, setMergeProgress] = useState<string>('');
  const [result, setResult] = useState<ToolResult | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Üretilen PDF'i yönetilen önbellek adına taşır, son dosyalara kaydeder ve sonuç kartını gösterir. */
  const finalizeOutput = useCallback(async (uri: string, displayName: string, detail: string) => {
    let size = 0;
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists && typeof info.size === 'number') size = info.size;
    } catch {
      /* boyut bilinmiyor */
    }
    const base: FileInfo = {
      id: `tools_${Date.now().toString(36)}`,
      name: displayName,
      uri,
      size,
      mimeType: 'application/pdf',
      extension: 'pdf',
      category: 'pdf',
      lastOpened: Date.now(),
    };
    const saved = await FileService.saveRecentFile(base);
    if (mounted.current) setResult({ file: saved ?? base, detail, listed: !!saved });
  }, []);

  // ---------- Fotoğraftan PDF ----------

  const handlePickImages = async () => {
    if (busy) return;
    try {
      const remaining = MAX_IMAGES - selectedImages.length;
      if (remaining <= 0) {
        Alert.alert('Sınıra ulaşıldı', `En fazla ${MAX_IMAGES} görsel eklenebilir.`);
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.7,
      });
      if (res.canceled || !res.assets) return;
      const incoming: PickedImage[] = res.assets.slice(0, remaining).map((a) => ({
        uri: a.uri,
        mime: a.mimeType && SAFE_MIMES.includes(a.mimeType) ? a.mimeType : 'image/jpeg',
        size: typeof a.fileSize === 'number' ? a.fileSize : 0,
      }));
      if (mounted.current) setSelectedImages((prev) => [...prev, ...incoming]);
    } catch {
      Alert.alert('Hata', 'Görsel seçilirken bir sorun oluştu. Galeri izni verildiğinden emin olun.');
    }
  };

  const handleCreatePdf = async () => {
    if (busy) return;
    if (selectedImages.length === 0) {
      Alert.alert('Uyarı', "Lütfen PDF'e dönüştürülecek görselleri seçin.");
      return;
    }
    const totalBytes = selectedImages.reduce((s, i) => s + i.size, 0);
    if (totalBytes > IMAGE_MAX_BYTES) {
      Alert.alert('Görseller çok büyük', 'Toplam boyut 80 MB sınırını aşıyor. Daha az görsel seçip PDF\'i parçalar hâlinde üretin.');
      return;
    }
    if (selectedImages.length > IMAGE_WARN_COUNT || totalBytes > IMAGE_WARN_BYTES) {
      const ok = await confirm(
        'Büyük işlem',
        `${selectedImages.length} görsel${totalBytes > 0 ? ` (yaklaşık ${FileService.formatFileSize(totalBytes)})` : ''} işlenecek. Bu işlem bellek kullanır ve birkaç dakika sürebilir. Devam edilsin mi?`,
        'Devam Et'
      );
      if (!ok || !mounted.current) return;
    }

    setBusy('images');
    setResult(null);
    try {
      let html =
        '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<style>@page{margin:0}body{margin:0;padding:0;background:#fff}' +
        '.page{display:flex;justify-content:center;align-items:center;width:100%;height:100vh;page-break-after:always}' +
        'img{max-width:100%;max-height:100vh;object-fit:contain}</style></head><body>';
      for (const img of selectedImages) {
        const b64 = await FileSystem.readAsStringAsync(img.uri, { encoding: FileSystem.EncodingType.Base64 });
        html += `<div class="page"><img src="data:${img.mime};base64,${b64}" /></div>`;
      }
      html += '</body></html>';

      const printed = await Print.printToFileAsync({ html });
      let finalUri = printed.uri;
      const cacheDir = FileSystem.cacheDirectory;
      if (cacheDir) {
        const target = `${cacheDir}tdesk_foto_${stampNow()}.pdf`;
        try {
          await FileSystem.moveAsync({ from: printed.uri, to: target });
          finalUri = target;
        } catch {
          /* taşınamazsa üretilen özgün dosya kullanılır */
        }
      }
      await finalizeOutput(finalUri, `Fotoğraflar ${displayStamp()}.pdf`, `${selectedImages.length} görselden oluşturuldu`);
    } catch {
      Alert.alert('Hata', 'PDF oluşturulurken sorun yaşandı. Daha az veya daha küçük görselle tekrar deneyin.');
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  // ---------- PDF birleştirme ----------

  const handlePickPdfs = async () => {
    if (busy) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets) return;
      if (!mounted.current) return;
      setSelectedPdfs((prev) => {
        const known = new Set(prev.map((p) => p.uri));
        const added = res.assets
          .filter((a) => !known.has(a.uri))
          .map((a) => ({ uri: a.uri, name: a.name || 'belge.pdf', size: typeof a.size === 'number' ? a.size : 0 }));
        return [...prev, ...added].slice(0, MAX_PDFS);
      });
    } catch {
      Alert.alert('Hata', 'PDF dosyaları seçilirken bir sorun oluştu.');
    }
  };

  const movePdf = (index: number, delta: -1 | 1) => {
    setSelectedPdfs((prev) => {
      const j = index + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const handleMergePdfs = async () => {
    if (busy) return;
    if (selectedPdfs.length < 2) {
      Alert.alert('Uyarı', 'Birleştirmek için en az iki PDF seçin.');
      return;
    }
    const totalBytes = selectedPdfs.reduce((s, p) => s + p.size, 0);
    if (totalBytes > PDF_MAX_BYTES) {
      Alert.alert('Dosyalar çok büyük', 'Toplam boyut 120 MB sınırını aşıyor; telefonun belleği bu işlemi kaldıramaz. Daha az dosya seçin.');
      return;
    }
    if (totalBytes > PDF_WARN_BYTES) {
      const ok = await confirm(
        'Büyük işlem',
        `Toplam yaklaşık ${FileService.formatFileSize(totalBytes)} işlenecek. Bu işlem uzun sürebilir ve bellek kullanır. Devam edilsin mi?`,
        'Devam Et'
      );
      if (!ok || !mounted.current) return;
    }

    setBusy('merge');
    setResult(null);
    setMergeProgress('Dosyalar okunuyor...');
    try {
      const inputs: Uint8Array[] = [];
      for (const pdf of selectedPdfs) {
        const b64 = await FileSystem.readAsStringAsync(pdf.uri, { encoding: FileSystem.EncodingType.Base64 });
        inputs.push(base64ToBytes(b64));
      }
      const merged = await mergePdfBytes(inputs, (done, total) => {
        if (mounted.current) setMergeProgress(`Birleştiriliyor (${done}/${total})...`);
      });
      const cacheDir = FileSystem.cacheDirectory;
      if (!cacheDir) throw new Error('cache');
      const target = `${cacheDir}tdesk_birlesik_${stampNow()}.pdf`;
      if (mounted.current) setMergeProgress('Kaydediliyor...');
      await FileSystem.writeAsStringAsync(target, bytesToBase64(merged.bytes), { encoding: FileSystem.EncodingType.Base64 });
      await finalizeOutput(
        target,
        `Birleşik PDF ${displayStamp()}.pdf`,
        `${selectedPdfs.length} dosyadan ${merged.pageCount} sayfa birleştirildi`
      );
    } catch (e) {
      if (e instanceof PdfMergeError) {
        const name = selectedPdfs[e.index]?.name ?? 'Dosya';
        if (e.reason === 'encrypted') {
          Alert.alert('Şifreli PDF', `"${name}" şifreli olduğu için birleştirilemedi. Önce şifresini kaldırın veya listeden çıkarın.`);
        } else if (e.reason === 'invalid') {
          Alert.alert('PDF okunamadı', `"${name}" bozuk veya geçerli bir PDF değil. Listeden çıkarıp tekrar deneyin.`);
        } else {
          Alert.alert('Birleştirilemedi', e.message);
        }
      } else {
        Alert.alert('Hata', 'PDF\'ler birleştirilirken sorun yaşandı. Dosya sayısını veya boyutunu azaltıp tekrar deneyin.');
      }
    } finally {
      if (mounted.current) {
        setBusy(null);
        setMergeProgress('');
      }
    }
  };

  const hasImages = selectedImages.length > 0;
  const canMerge = selectedPdfs.length >= 2;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: currentColors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: currentColors.text }]} accessibilityRole="header">
        Araçlar
      </Text>
      <Text style={[styles.subtitle, { color: currentColors.textSecondary }]}>
        Fotoğraflardan PDF üretin, birden çok PDF dosyasını tek belgede birleştirin.
      </Text>

      {result ? (
        <View style={[styles.resultCard, { backgroundColor: currentColors.card, borderColor: currentColors.success }]}>
          <View style={styles.resultHeader}>
            <Ionicons name="checkmark-circle" size={22} color={currentColors.success} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.resultTitle, { color: currentColors.text }]} numberOfLines={2}>
                PDF hazır: {result.file.name}
              </Text>
              <Text style={[styles.resultDetail, { color: currentColors.textSecondary }]}>
                {result.detail}
                {result.file.size > 0 ? ` • ${FileService.formatFileSize(result.file.size)}` : ''}
              </Text>
              <Text style={[styles.resultDetail, { color: currentColors.textMuted }]}>
                {result.listed ? 'Son dosyalar listesine de eklendi.' : 'Listeye eklenemedi; yine de paylaşabilir veya açabilirsiniz.'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setResult(null)}
              hitSlop={HIT_SLOP}
              style={styles.iconHit}
              accessibilityRole="button"
              accessibilityLabel="Sonuç kartını kapat"
            >
              <Ionicons name="close" size={20} color={currentColors.textMuted} />
            </TouchableOpacity>
          </View>
          <View style={styles.toolActions}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: currentColors.surface }]}
              onPress={() => {
                void FileService.shareFile(result.file);
              }}
              accessibilityRole="button"
              accessibilityLabel="PDF'i paylaş veya kaydet"
            >
              <Ionicons name="share-social-outline" size={18} color={currentColors.text} />
              <Text style={[styles.actionBtnText, { color: currentColors.text }]}>Paylaş / Kaydet</Text>
            </TouchableOpacity>
            {onOpenFile ? (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: currentColors.primary }]}
                onPress={() => onOpenFile(result.file)}
                accessibilityRole="button"
                accessibilityLabel="PDF'i uygulamada aç"
              >
                <Ionicons name="eye-outline" size={18} color={currentColors.onPrimary} />
                <Text style={[styles.actionBtnText, { color: currentColors.onPrimary }]}>Uygulamada Aç</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Fotoğraftan PDF'e */}
      <View style={[styles.toolCard, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}>
        <View style={styles.toolHeader}>
          <View style={[styles.iconBox, { backgroundColor: currentColors.primaryGlow }]}>
            <MaterialCommunityIcons name="image-multiple-outline" size={24} color={currentColors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.toolTitle, { color: currentColors.text }]}>Fotoğrafları PDF Yap</Text>
            <Text style={[styles.toolDesc, { color: currentColors.textSecondary }]}>
              Galeriden fotoğraf seçip her biri bir sayfa olacak şekilde tek PDF'te toplayın (en fazla {MAX_IMAGES}). Görseller sıkıştırılarak alınır.
            </Text>
          </View>
        </View>

        {hasImages && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScroll} contentContainerStyle={{ paddingTop: 8, paddingRight: 8 }}>
              {selectedImages.map((img, idx) => (
                <View key={`${img.uri}-${idx}`} style={styles.imageThumbWrapper}>
                  <Image source={{ uri: img.uri }} style={styles.imageThumb} accessibilityLabel={`Seçili görsel ${idx + 1}`} />
                  <TouchableOpacity
                    style={[styles.removeImgBtn, { backgroundColor: currentColors.card }]}
                    onPress={() => setSelectedImages((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={!!busy}
                    hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Görsel ${idx + 1} seçimden çıkar`}
                  >
                    <Ionicons name="close-circle" size={22} color={currentColors.danger} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            <View style={styles.selectionRow}>
              <Text style={[styles.selectionText, { color: currentColors.textSecondary }]}>{selectedImages.length} görsel seçili</Text>
              <TouchableOpacity
                onPress={() => setSelectedImages([])}
                disabled={!!busy}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel="Seçili görselleri temizle"
              >
                <Text style={[styles.linkText, { color: currentColors.primary }]}>Temizle</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        <View style={styles.toolActions}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: currentColors.surface, opacity: busy ? 0.5 : 1 }]}
            onPress={handlePickImages}
            disabled={!!busy}
            accessibilityRole="button"
            accessibilityLabel="Galeriden fotoğraf seç"
            accessibilityState={{ disabled: !!busy }}
          >
            <Ionicons name="images-outline" size={18} color={currentColors.text} />
            <Text style={[styles.actionBtnText, { color: currentColors.text }]}>Fotoğraf Seç</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: hasImages ? currentColors.primary : currentColors.surface }]}
            onPress={handleCreatePdf}
            disabled={!hasImages || !!busy}
            accessibilityRole="button"
            accessibilityLabel="Seçili fotoğraflardan PDF üret"
            accessibilityState={{ disabled: !hasImages || !!busy, busy: busy === 'images' }}
          >
            {busy === 'images' ? (
              <ActivityIndicator size="small" color={currentColors.onPrimary} />
            ) : (
              <Ionicons name="document-text-outline" size={18} color={hasImages ? currentColors.onPrimary : currentColors.textMuted} />
            )}
            <Text style={[styles.actionBtnText, { color: hasImages ? currentColors.onPrimary : currentColors.textMuted }]}>
              {busy === 'images' ? 'Oluşturuluyor...' : 'PDF Üret'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* PDF birleştirme */}
      <View style={[styles.toolCard, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}>
        <View style={styles.toolHeader}>
          <View style={[styles.iconBox, { backgroundColor: currentColors.primaryGlow }]}>
            <MaterialCommunityIcons name="file-pdf-box" size={26} color={currentColors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.toolTitle, { color: currentColors.text }]}>PDF'leri Birleştir</Text>
            <Text style={[styles.toolDesc, { color: currentColors.textSecondary }]}>
              İki veya daha fazla PDF seçin, sırayı ayarlayın ve tek belgede birleştirin. Şifreli PDF'ler birleştirilemez.
            </Text>
          </View>
        </View>

        {selectedPdfs.length > 0 && (
          <>
            <View style={styles.pdfList}>
              {selectedPdfs.map((pdf, idx) => (
                <View key={pdf.uri} style={[styles.pdfRow, { backgroundColor: currentColors.surface }]}>
                  <Text style={[styles.pdfIndex, { color: currentColors.primary }]}>{idx + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.pdfName, { color: currentColors.text }]} numberOfLines={1}>
                      {pdf.name}
                    </Text>
                    {pdf.size > 0 ? (
                      <Text style={[styles.pdfMeta, { color: currentColors.textMuted }]}>{FileService.formatFileSize(pdf.size)}</Text>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    style={styles.iconHit}
                    onPress={() => movePdf(idx, -1)}
                    disabled={!!busy || idx === 0}
                    accessibilityRole="button"
                    accessibilityLabel={`${pdf.name} dosyasını yukarı taşı`}
                    accessibilityState={{ disabled: !!busy || idx === 0 }}
                  >
                    <Ionicons name="chevron-up" size={20} color={idx === 0 ? currentColors.textMuted : currentColors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconHit}
                    onPress={() => movePdf(idx, 1)}
                    disabled={!!busy || idx === selectedPdfs.length - 1}
                    accessibilityRole="button"
                    accessibilityLabel={`${pdf.name} dosyasını aşağı taşı`}
                    accessibilityState={{ disabled: !!busy || idx === selectedPdfs.length - 1 }}
                  >
                    <Ionicons name="chevron-down" size={20} color={idx === selectedPdfs.length - 1 ? currentColors.textMuted : currentColors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconHit}
                    onPress={() => setSelectedPdfs((prev) => prev.filter((p) => p.uri !== pdf.uri))}
                    disabled={!!busy}
                    accessibilityRole="button"
                    accessibilityLabel={`${pdf.name} dosyasını listeden çıkar`}
                  >
                    <Ionicons name="close-circle" size={20} color={currentColors.danger} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            <View style={styles.selectionRow}>
              <Text style={[styles.selectionText, { color: currentColors.textSecondary }]}>
                {selectedPdfs.length} PDF seçili{selectedPdfs.length < 2 ? ' (en az 2 gerekli)' : ''}
              </Text>
              <TouchableOpacity
                onPress={() => setSelectedPdfs([])}
                disabled={!!busy}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel="Seçili PDF'leri temizle"
              >
                <Text style={[styles.linkText, { color: currentColors.primary }]}>Temizle</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        <View style={styles.toolActions}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: currentColors.surface, opacity: busy ? 0.5 : 1 }]}
            onPress={handlePickPdfs}
            disabled={!!busy}
            accessibilityRole="button"
            accessibilityLabel="Birleştirmek için PDF seç"
            accessibilityState={{ disabled: !!busy }}
          >
            <Ionicons name="add-circle-outline" size={18} color={currentColors.text} />
            <Text style={[styles.actionBtnText, { color: currentColors.text }]}>PDF Seç</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: canMerge ? currentColors.primary : currentColors.surface }]}
            onPress={handleMergePdfs}
            disabled={!canMerge || !!busy}
            accessibilityRole="button"
            accessibilityLabel="Seçili PDF'leri birleştir"
            accessibilityState={{ disabled: !canMerge || !!busy, busy: busy === 'merge' }}
          >
            {busy === 'merge' ? (
              <ActivityIndicator size="small" color={currentColors.onPrimary} />
            ) : (
              <Ionicons name="git-merge-outline" size={18} color={canMerge ? currentColors.onPrimary : currentColors.textMuted} />
            )}
            <Text style={[styles.actionBtnText, { color: canMerge ? currentColors.onPrimary : currentColors.textMuted }]}>
              {busy === 'merge' ? mergeProgress || 'Birleştiriliyor...' : 'Birleştir'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 24, fontWeight: '800', marginBottom: 4 },
  subtitle: { fontSize: 14, marginBottom: 20, lineHeight: 20 },
  toolCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 },
  toolHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  iconBox: { width: 48, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  toolTitle: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  toolDesc: { fontSize: 13, lineHeight: 18 },
  toolActions: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, paddingHorizontal: 8, borderRadius: 10 },
  actionBtnText: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  imageScroll: { flexDirection: 'row' },
  imageThumbWrapper: { position: 'relative', marginRight: 12 },
  imageThumb: { width: 70, height: 70, borderRadius: 8, resizeMode: 'cover' },
  removeImgBtn: { position: 'absolute', top: -8, right: -8, borderRadius: 11 },
  selectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 12 },
  selectionText: { fontSize: 12.5, fontWeight: '600' },
  linkText: { fontSize: 13, fontWeight: '700' },
  pdfList: { gap: 6 },
  pdfRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingLeft: 12, paddingRight: 2, minHeight: 50, gap: 6 },
  pdfIndex: { width: 18, fontSize: 13, fontWeight: '800' },
  pdfName: { fontSize: 13.5, fontWeight: '600' },
  pdfMeta: { fontSize: 11, marginTop: 1 },
  iconHit: { minWidth: 40, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  resultCard: { borderWidth: 1.5, borderRadius: 16, padding: 14, marginBottom: 16, gap: 12 },
  resultHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  resultTitle: { fontSize: 14, fontWeight: '700' },
  resultDetail: { fontSize: 12, marginTop: 2, lineHeight: 17 },
});
