import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { FileInfo, AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import {
  encodingLabel,
  formatBytes,
  isVirtualTextUri,
  loadViewerText,
  normalizeNewlines,
  TextReadError,
} from '../utils/textEncoding';
import { LinesView, LinesViewHandle, SearchRow, ToolButton, useLineSearch } from './LinesView';
import { t } from '../i18n';

interface TextViewerProps {
  file: FileInfo;
  appTheme?: AppThemeMode;
}

type Status =
  | { kind: 'loading' }
  | { kind: 'ready'; encoding: string }
  | { kind: 'empty' }
  | { kind: 'too_large'; size?: number }
  | { kind: 'binary' }
  | { kind: 'unreadable' };

const MAX_LINE_CHARS = 5000;
const FONT_MIN = 9;
const FONT_MAX = 26;
const LOG_TIMESTAMP = /^\[\d{4}-\d{2}-\d{2}/;

function prepareLines(text: string): string[] {
  const arr = normalizeNewlines(text).split('\n');
  for (let i = 0; i < arr.length; i++) {
    let l = arr[i];
    if (l.indexOf('\t') >= 0) l = l.replace(/\t/g, '    ');
    if (l.length > MAX_LINE_CHARS) l = `${l.slice(0, MAX_LINE_CHARS)} … (+${l.length - MAX_LINE_CHARS} karakter)`;
    arr[i] = l;
  }
  return arr;
}

export const TextViewer: React.FC<TextViewerProps> = ({ file, appTheme = 'dark' }) => {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [text, setText] = useState<string>('');
  const [fontSize, setFontSize] = useState<number>(13);
  const [wrap, setWrap] = useState<boolean>(true);
  const [toast, setToast] = useState<string>('');
  const listRef = useRef<LinesViewHandle>(null);
  const mountedRef = useRef(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const colors = Colors[appTheme] || Colors.dark;
  const isLog = (file.extension || '').toLowerCase().replace(/^\./, '') === 'log';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'loading' });
    (async () => {
      try {
        const decoded = await loadViewerText({ uri: file.uri, content: file.content });
        if (cancelled) return;
        if (decoded.text.length === 0) {
          setText('');
          setStatus({ kind: 'empty' });
        } else {
          setText(decoded.text);
          setStatus({ kind: 'ready', encoding: encodingLabel(decoded.encoding) });
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof TextReadError && e.code === 'too_large') setStatus({ kind: 'too_large', size: e.size });
        else if (e instanceof TextReadError && e.code === 'binary') setStatus({ kind: 'binary' });
        else setStatus({ kind: 'unreadable' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.uri]);

  const lines = useMemo(() => prepareLines(text), [text]);
  const search = useLineSearch(lines, (line) => listRef.current?.scrollToLine(line));

  const lineColor = useCallback(
    (line: string): string | undefined => {
      if (!isLog) return undefined;
      if (line.includes('[ERROR]')) return colors.danger;
      if (line.includes('[SUCCESS]')) return colors.success;
      if (LOG_TIMESTAMP.test(line)) return colors.primary;
      return undefined;
    },
    [isLog, colors.danger, colors.success, colors.primary]
  );

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      if (mountedRef.current) setToast('');
    }, 1800);
  };

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(text);
      showToast(t('details.copied'));
    } catch {
      Alert.alert(t('common.error'), t('viewers.clipboardFail'));
    }
  };

  const handleShare = async () => {
    try {
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri);
      else Alert.alert(t('common.shareFailTitle'), t('viewers.shareUnavailable'));
    } catch {
      Alert.alert(t('common.error'), t('textViewer.shareFail'));
    }
  };

  if (status.kind === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} accessibilityLiveRegion="polite">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.msg, { color: colors.textSecondary }]}>{t('viewer.reading')}</Text>
      </View>
    );
  }

  if (status.kind !== 'ready') {
    const canShare = !isVirtualTextUri(file.uri);
    const info =
      status.kind === 'empty'
        ? { icon: 'document-outline' as const, title: t('textViewer.emptyTitle'), body: t('textViewer.emptyBody') }
        : status.kind === 'too_large'
        ? {
            icon: 'warning-outline' as const,
            title: t('viewer.tooBigTitle'),
            body: t('textViewer.tooLargeBody', { sizeInfo: status.size ? t('textViewer.thisFile', { size: formatBytes(status.size) }) : '' }),
          }
        : status.kind === 'binary'
        ? {
            icon: 'warning-outline' as const,
            title: t('textViewer.binaryTitle'),
            body: t('textViewer.binaryBody'),
          }
        : {
            icon: 'alert-circle-outline' as const,
            title: t('viewer.readFailTitle'),
            body: t('textViewer.readFailBody'),
          };
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Ionicons name={info.icon} size={48} color={status.kind === 'empty' ? colors.textMuted : colors.warning} />
        <Text style={[styles.title, { color: colors.text }]}>{info.title}</Text>
        <Text style={[styles.msg, { color: colors.textSecondary }]}>{info.body}</Text>
        {status.kind !== 'empty' && canShare && (
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: colors.primary }]}
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel={t('textViewer.shareOpenA11y')}
          >
            <Ionicons name="share-outline" size={18} color={colors.primary} />
            <Text style={[styles.actionText, { color: colors.primary }]}>{t('viewer.shareOpen')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.toolbar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <Text
          style={[styles.linesBadge, { color: colors.primary }]}
          numberOfLines={1}
          accessibilityLiveRegion="polite"
        >
          {toast || `${t('viewers.lineCount', { count: lines.length }).toUpperCase()} · ${status.encoding}`}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbarRight}>
          <ToolButton label={t('common.search')} onPress={() => (search.open ? search.close() : search.setOpen(true))} selected={search.open}>
            <Ionicons name="search" size={20} color={search.open ? colors.primary : colors.text} />
          </ToolButton>
          <ToolButton label={t('viewers.copyAll')} onPress={handleCopy}>
            <Ionicons name="copy-outline" size={20} color={colors.text} />
          </ToolButton>
          <ToolButton
            label={wrap ? t('viewers.wrapOff') : t('viewers.wrapOn')}
            onPress={() => setWrap((w) => !w)}
            selected={wrap}
          >
            <MaterialCommunityIcons name="wrap" size={20} color={wrap ? colors.primary : colors.text} />
          </ToolButton>
          <ToolButton label={t('viewers.fontSmaller')} onPress={() => setFontSize((s) => Math.max(FONT_MIN, s - 1))} disabled={fontSize <= FONT_MIN}>
            <Text style={[styles.fontBtnText, { color: colors.text }]}>A-</Text>
          </ToolButton>
          <Text style={[styles.fontSizeLabel, { color: colors.primary }]} accessibilityLabel={t('viewers.fontSizeA11y', { size: fontSize })}>
            {fontSize}
          </Text>
          <ToolButton label={t('viewers.fontLarger')} onPress={() => setFontSize((s) => Math.min(FONT_MAX, s + 1))} disabled={fontSize >= FONT_MAX}>
            <Text style={[styles.fontBtnText, { color: colors.text }]}>A+</Text>
          </ToolButton>
        </ScrollView>
      </View>

      {search.open && (
        <SearchRow
          search={search}
          textColor={colors.text}
          mutedColor={colors.textMuted}
          primaryColor={colors.primary}
          bgColor={colors.surfaceLight}
          borderColor={colors.border}
        />
      )}

      <LinesView
        ref={listRef}
        lines={lines}
        fontSize={fontSize}
        wrap={wrap}
        showLineNumbers
        bgColor={colors.background}
        textColor={colors.text}
        gutterColor={colors.textMuted}
        borderColor={colors.border}
        lineColor={isLog ? lineColor : undefined}
        matchLines={search.matchLines}
        currentLine={search.currentLine}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title: { fontSize: 17, fontWeight: '700' },
  msg: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
  },
  actionText: { fontSize: 14, fontWeight: '700' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
    borderBottomWidth: 1,
  },
  linesBadge: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, flexShrink: 1, paddingRight: 8 },
  toolbarRight: { alignItems: 'center', flexGrow: 1, justifyContent: 'flex-end' },
  fontBtnText: { fontSize: 14, fontWeight: 'bold' },
  fontSizeLabel: { fontSize: 12, fontWeight: '700', minWidth: 24, textAlign: 'center' },
});
