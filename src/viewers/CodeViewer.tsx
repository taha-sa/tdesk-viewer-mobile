import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Alert,
  BackHandler,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { FileInfo, SyntaxTheme, AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import { getSyntaxTheme, resolveTokenColor } from '../theme/syntaxThemes';
import { canHighlight, highlightLines, Token } from '../utils/highlight';
import {
  applyEol,
  bytesToBase64,
  DecodedText,
  encodeTextBytes,
  encodingLabel,
  formatBytes,
  isVirtualTextUri,
  loadViewerText,
  normalizeNewlines,
  TextEncodingName,
  TextReadError,
} from '../utils/textEncoding';
import { LinesView, LinesViewHandle, MONO_FONT, onColor, SearchRow, ToolButton, useLineSearch } from './LinesView';

interface CodeViewerProps {
  file: FileInfo;
  appTheme: AppThemeMode;
  codeTheme?: SyntaxTheme;
  showLineNumbers?: boolean;
}

type Status = 'loading' | 'ready' | 'error';

const MAX_LINE_CHARS = 2000; // görüntülemede tek satır sınırı (minify dosyalar için)
const MAX_EDIT_CHARS = 1_000_000; // bunun üstünde düzenleme kapalı (TextInput dayanmaz)
const MAX_PDF_LINES = 20000;
const FONT_MIN = 9;
const FONT_MAX = 26;

function prepareDisplayLines(text: string): string[] {
  const arr = normalizeNewlines(text).split('\n');
  for (let i = 0; i < arr.length; i++) {
    let l = arr[i];
    if (l.indexOf('\t') >= 0) l = l.replace(/\t/g, '    ');
    if (l.length > MAX_LINE_CHARS) l = `${l.slice(0, MAX_LINE_CHARS)} … (+${l.length - MAX_LINE_CHARS} karakter)`;
    arr[i] = l;
  }
  return arr;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function confirmAsync(title: string, message: string, confirmText: string, destructive = false): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Vazgeç', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

function describeReadError(e: unknown): string {
  if (e instanceof TextReadError) {
    switch (e.code) {
      case 'too_large':
        return `Dosya çok büyük${e.size ? ` (${formatBytes(e.size)})` : ''}. Kod görüntüleyici en fazla 5 MB'a kadar açar.`;
      case 'binary':
        return 'Bu dosya metin değil, ikili (binary) veri içeriyor; kod olarak gösterilemez.';
      case 'not_found':
        return 'Dosya bulunamadı. Taşınmış veya silinmiş olabilir.';
      default:
        return 'Dosya okunamadı. Erişim izni olmayabilir veya dosya bozuk olabilir.';
    }
  }
  return 'Dosya okunamadı.';
}

export const CodeViewer: React.FC<CodeViewerProps> = ({
  file,
  appTheme,
  codeTheme = 'vscode-dark',
  showLineNumbers = true,
}) => {
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [text, setText] = useState<string>(''); // kaydedilmiş içerik (satır sonları \n)
  const [meta, setMeta] = useState<DecodedText | null>(null);
  const [tokenState, setTokenState] = useState<{ forLines: string[]; data: Token[][] } | null>(null);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [wrap, setWrap] = useState<boolean>(false);
  const [fontSize, setFontSize] = useState<number>(14);
  const [toast, setToast] = useState<string>('');

  const listRef = useRef<LinesViewHandle>(null);
  const mountedRef = useRef(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const colors = Colors[appTheme] || Colors.emerald;
  const theme = getSyntaxTheme(codeTheme);
  const ext = (file.extension || '').toLowerCase().replace(/^\./, '');
  const virtual = isVirtualTextUri(file.uri);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      if (mountedRef.current) setToast('');
    }, 1800);
  }, []);

  // --- Yükleme (hata durumu içerikten ayrı) ---
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErrorMsg('');
    setIsEditing(false);
    setTokenState(null);
    (async () => {
      try {
        const decoded = await loadViewerText({ uri: file.uri, content: file.content });
        if (cancelled) return;
        const normalized = normalizeNewlines(decoded.text);
        setText(normalized);
        setMeta(decoded);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(describeReadError(e));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // file.content bilinçli olarak bağımlılık dışı: yalnızca dosya değişince yeniden yükle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.uri]);

  const lines = useMemo(() => prepareDisplayLines(text), [text]);
  const highlightState = useMemo(() => canHighlight(text, ext, file.name), [text, ext, file.name]);

  // --- Vurgulama: önce düz metin çizilir, sonra ertelenmiş olarak renklendirilir ---
  useEffect(() => {
    setTokenState(null);
    if (status !== 'ready' || highlightState !== 'yes') return;
    let cancelled = false;
    const t = setTimeout(() => {
      const result = highlightLines(lines.join('\n'), ext, { fileName: file.name });
      if (!cancelled && mountedRef.current) setTokenState({ forLines: lines, data: result });
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [lines, status, highlightState, ext, file.name]);

  const tokens = tokenState && tokenState.forLines === lines ? tokenState.data : null;
  const search = useLineSearch(lines, (line) => listRef.current?.scrollToLine(line));
  const tokenColor = useCallback((type: string) => resolveTokenColor(theme, type), [theme]);

  const dirty = isEditing && draft !== text;
  const canEdit = status === 'ready' && !virtual && text.length <= MAX_EDIT_CHARS;
  const editDisabledReason = virtual
    ? 'Arşiv içindeki veya geçici dosyalar düzenlenemez.'
    : text.length > MAX_EDIT_CHARS
    ? 'Dosya düzenleme için çok büyük (1 MB üstü).'
    : '';

  // Android geri tuşu: kaydedilmemiş değişiklikte uyar
  useEffect(() => {
    if (!dirty) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmAsync('Kaydedilmemiş değişiklikler', 'Değişiklikler silinsin mi?', 'Sil', true).then((ok) => {
        if (ok && mountedRef.current) {
          setIsEditing(false);
        }
      });
      return true;
    });
    return () => sub.remove();
  }, [dirty]);

  const startEdit = () => {
    if (!canEdit) {
      if (editDisabledReason) Alert.alert('Düzenlenemez', editDisabledReason);
      return;
    }
    search.close();
    setDraft(text);
    setIsEditing(true);
  };

  const cancelEdit = async () => {
    if (dirty && !(await confirmAsync('Kaydedilmemiş değişiklikler', 'Değişiklikler silinsin mi?', 'Sil', true))) return;
    if (mountedRef.current) setIsEditing(false);
  };

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(isEditing ? draft : text);
      showToast('Kopyalandı');
    } catch {
      Alert.alert('Hata', 'Panoya kopyalanamadı.');
    }
  };

  const handleExportPDF = async () => {
    if (lines.length > MAX_PDF_LINES) {
      Alert.alert('Dosya çok büyük', `PDF dışa aktarımı en fazla ${MAX_PDF_LINES} satıra kadar desteklenir.`);
      return;
    }
    try {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body { font-family: monospace; white-space: pre-wrap; word-wrap: break-word; padding: 20px; font-size: 12px; color: #222; }
      </style></head><body>${escapeHtml(text)}</body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      if (!mountedRef.current) return;
      Alert.alert('PDF Üretildi', 'Dosya PDF olarak dışa aktarıldı.', [
        {
          text: 'Paylaş',
          onPress: async () => {
            try {
              if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
              else Alert.alert('Paylaşılamadı', 'Bu cihazda paylaşım desteklenmiyor.');
            } catch {
              Alert.alert('Hata', 'PDF paylaşılamadı.');
            }
          },
        },
        { text: 'Kapat', style: 'cancel' },
      ]);
    } catch {
      Alert.alert('Hata', 'PDF üretilirken sorun yaşandı.');
    }
  };

  const handleSave = async () => {
    if (saving || !meta || virtual) return;
    let encoding: TextEncodingName = meta.encoding;
    let withBom = meta.hadBom;
    if (meta.hadReplacementChars) {
      const ok = await confirmAsync(
        'Okunamayan karakterler',
        'Dosyada okunamayan (�) karakterler var. Kaydederseniz bu karakterler kalıcı olarak dosyaya yazılır. Devam edilsin mi?',
        'Yine de kaydet'
      );
      if (!ok) return;
    }
    let enc = encodeTextBytes(applyEol(draft, meta.eol), encoding, withBom);
    if (!enc.lossless) {
      const ok = await confirmAsync(
        'Kodlama uyarısı',
        `Bazı karakterler ${encodingLabel(encoding)} kodlamasında yazılamıyor. Dosya UTF-8 olarak kaydedilsin mi?`,
        'UTF-8 kaydet'
      );
      if (!ok) return;
      encoding = 'utf-8';
      withBom = false;
      enc = encodeTextBytes(applyEol(draft, meta.eol), 'utf-8', false);
    }
    setSaving(true);
    try {
      await FileSystem.writeAsStringAsync(file.uri, bytesToBase64(enc.bytes), {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (!mountedRef.current) return;
      setText(draft);
      setMeta({ ...meta, encoding, hadBom: withBom, hadReplacementChars: false, byteLength: enc.bytes.length });
      setIsEditing(false);
      const isAppCopy = !!FileSystem.cacheDirectory && file.uri.startsWith(FileSystem.cacheDirectory);
      Alert.alert(
        'Kaydedildi',
        isAppCopy
          ? 'Değişiklikler uygulama kopyasına kaydedildi. Orijinal dosyayı güncellemek için Paylaş düğmesinden dışa aktarın.'
          : 'Değişiklikler dosyaya kaydedildi.'
      );
    } catch {
      if (mountedRef.current) Alert.alert('Hata', 'Dosya kaydedilemedi. Düzenlemeleriniz ekranda korunuyor.');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const toolBg = colors.card;
  const iconColor = colors.text;

  const infoLine = useMemo(() => {
    if (!meta) return '';
    const parts = [`${lines.length} satır`, encodingLabel(meta.encoding)];
    if (highlightState === 'too-large') parts.push('büyük dosya: vurgulama kapalı');
    return parts.join(' · ');
  }, [meta, lines.length, highlightState]);

  if (status === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]} accessibilityLiveRegion="polite">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.centerText, { color: theme.textColor }]}>Dosya okunuyor...</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.danger} />
        <Text style={[styles.errorTitle, { color: colors.text }]}>Dosya açılamadı</Text>
        <Text style={[styles.centerText, { color: colors.textSecondary }]}>{errorMsg}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.toolbar, { backgroundColor: toolBg, borderBottomColor: colors.border }]}>
        <View style={styles.titleCol}>
          <Text style={[styles.toolTitle, { color: colors.text }]} numberOfLines={1}>
            {isEditing ? (dirty ? 'Düzenleme (kaydedilmedi)' : 'Düzenleme Modu') : 'Görüntüleme Modu'}
          </Text>
          {!!(toast || infoLine) && (
            <Text
              style={[styles.toolInfo, { color: toast ? colors.primary : colors.textMuted }]}
              numberOfLines={1}
              accessibilityLiveRegion="polite"
            >
              {toast || infoLine}
            </Text>
          )}
        </View>
        <View style={styles.toolActions}>
          {isEditing ? (
            <>
              <ToolButton label="Düzenlemeyi iptal et" onPress={cancelEdit} disabled={saving}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </ToolButton>
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: colors.primary }, (saving || !dirty) && { opacity: 0.5 }]}
                onPress={handleSave}
                disabled={saving || !dirty}
                accessibilityRole="button"
                accessibilityLabel="Değişiklikleri kaydet"
                accessibilityState={{ disabled: saving || !dirty, busy: saving }}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={onColor(colors.primary)} />
                ) : (
                  <Ionicons name="save-outline" size={16} color={onColor(colors.primary)} />
                )}
                <Text style={[styles.btnText, { color: onColor(colors.primary) }]}>Kaydet</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.editBtn, { borderColor: colors.primary }, !canEdit && { opacity: 0.45 }]}
              onPress={startEdit}
              accessibilityRole="button"
              accessibilityLabel="Düzenle"
              accessibilityHint={canEdit ? undefined : editDisabledReason}
              accessibilityState={{ disabled: !canEdit }}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Ionicons name="pencil-outline" size={16} color={colors.primary} />
              <Text style={[styles.btnText, { color: colors.primary }]}>Düzenle</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={[styles.toolRow, { backgroundColor: toolBg, borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolRowInner}>
          {!isEditing && (
            <ToolButton label="Ara" onPress={() => (search.open ? search.close() : search.setOpen(true))} selected={search.open}>
              <Ionicons name="search" size={20} color={search.open ? colors.primary : iconColor} />
            </ToolButton>
          )}
          <ToolButton label={isEditing ? 'Tümünü kopyala (düzenlenen metin)' : 'Tümünü kopyala'} onPress={handleCopy}>
            <Ionicons name="copy-outline" size={20} color={iconColor} />
          </ToolButton>
          {!isEditing && (
            <ToolButton
              label={wrap ? 'Kelime kaydırmayı kapat' : 'Kelime kaydırmayı aç'}
              onPress={() => setWrap((w) => !w)}
              selected={wrap}
            >
              <MaterialCommunityIcons name="wrap" size={20} color={wrap ? colors.primary : iconColor} />
            </ToolButton>
          )}
          <ToolButton label="Yazı boyutunu küçült" onPress={() => setFontSize((s) => Math.max(FONT_MIN, s - 1))} disabled={fontSize <= FONT_MIN}>
            <Text style={[styles.fontBtn, { color: iconColor }]}>A-</Text>
          </ToolButton>
          <Text style={[styles.fontLabel, { color: colors.primary }]} accessibilityLabel={`Yazı boyutu ${fontSize}`}>
            {fontSize}
          </Text>
          <ToolButton label="Yazı boyutunu büyüt" onPress={() => setFontSize((s) => Math.min(FONT_MAX, s + 1))} disabled={fontSize >= FONT_MAX}>
            <Text style={[styles.fontBtn, { color: iconColor }]}>A+</Text>
          </ToolButton>
          {!isEditing && (
            <ToolButton label="PDF olarak dışa aktar" onPress={handleExportPDF}>
              <Ionicons name="document-text-outline" size={20} color={colors.primary} />
            </ToolButton>
          )}
        </ScrollView>
      </View>

      {search.open && !isEditing && (
        <SearchRow
          search={search}
          textColor={colors.text}
          mutedColor={colors.textMuted}
          primaryColor={colors.primary}
          bgColor={colors.surfaceLight}
          borderColor={colors.border}
        />
      )}

      {isEditing ? (
        <TextInput
          style={[styles.textInput, { backgroundColor: theme.bg, color: theme.textColor, fontSize }]}
          multiline
          value={draft}
          onChangeText={setDraft}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          textAlignVertical="top"
          scrollEnabled
          accessibilityLabel="Dosya içeriği düzenleyici"
        />
      ) : (
        <LinesView
          ref={listRef}
          lines={lines}
          tokens={tokens}
          fontSize={fontSize}
          wrap={wrap}
          showLineNumbers={showLineNumbers}
          bgColor={theme.bg}
          textColor={theme.textColor}
          gutterColor={theme.gutterColor}
          gutterBg={theme.gutterBg}
          borderColor={colors.border}
          tokenColor={tokenColor}
          matchLines={search.matchLines}
          currentLine={search.currentLine}
          emptyText="Dosya boş."
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  centerText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  errorTitle: { fontSize: 17, fontWeight: '700' },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleCol: { flex: 1, paddingRight: 8 },
  toolTitle: { fontSize: 13, fontWeight: '600' },
  toolInfo: { fontSize: 11, marginTop: 1 },
  toolActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  toolRow: { borderBottomWidth: 1 },
  toolRowInner: { alignItems: 'center', paddingHorizontal: 8 },
  fontBtn: { fontSize: 14, fontWeight: 'bold' },
  fontLabel: { fontSize: 12, fontWeight: '700', minWidth: 24, textAlign: 'center' },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    minHeight: 44,
    borderRadius: 8,
  },
  btnText: { fontSize: 13, fontWeight: '700' },
  textInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontFamily: MONO_FONT,
  },
});
