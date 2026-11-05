// CodeViewer ve TextViewer'ın ortak, sanallaştırılmış satır listesi.
// - FlatList: yalnızca görünen satırlar çizilir (2MB dosya donmaz).
// - Kaydırma kapalıyken sabit satır yüksekliği + getItemLayout; açıkken satırlar sarılır.
// - Satır numarası genişliği hane sayısına göre.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions, ListRenderItemInfo } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TextInput } from 'react-native';
import type { Token } from '../utils/highlight';
import { findMatches, LineMatch } from '../utils/textEncoding';

export const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' }) as string;

export interface LinesViewHandle {
  scrollToLine: (index: number) => void;
}

interface LinesViewProps {
  lines: readonly string[];
  /** Satır başına token (yoksa düz metin) */
  tokens?: Token[][] | null;
  fontSize: number;
  wrap: boolean;
  showLineNumbers: boolean;
  bgColor: string;
  textColor: string;
  gutterColor: string;
  gutterBg?: string;
  borderColor: string;
  tokenColor?: (type: string) => string;
  /** Satıra özel metin rengi (ör. log satırları). Token yoksa kullanılır. */
  lineColor?: (line: string) => string | undefined;
  matchLines?: ReadonlySet<number>;
  currentLine?: number;
  matchBg?: string;
  currentMatchBg?: string;
  emptyText?: string;
}

const CHAR_W = 0.62; // monospace için yaklaşık genişlik/yazı boyutu oranı

export const LinesView = forwardRef<LinesViewHandle, LinesViewProps>(function LinesView(props, ref) {
  const {
    lines, tokens, fontSize, wrap, showLineNumbers, bgColor, textColor, gutterColor, gutterBg, borderColor,
    tokenColor, lineColor, matchLines, currentLine = -1, matchBg = 'rgba(255, 200, 0, 0.18)',
    currentMatchBg = 'rgba(255, 150, 0, 0.45)',
  } = props;
  const listRef = useRef<FlatList<string>>(null);
  const { width: winW } = useWindowDimensions();

  const lineHeight = Math.round(fontSize * 1.5);
  const charW = fontSize * CHAR_W;
  const gutterFont = Math.max(9, Math.round(fontSize * 0.85));
  const digits = String(Math.max(lines.length, 1)).length;
  const gutterW = showLineNumbers ? Math.ceil(digits * gutterFont * CHAR_W) + 18 : 8;

  const maxLen = useMemo(() => {
    if (wrap) return 0;
    let m = 0;
    for (let i = 0; i < lines.length; i++) if (lines[i].length > m) m = lines[i].length;
    return m;
  }, [lines, wrap]);

  const contentW = wrap ? winW : Math.max(winW, gutterW + Math.ceil(maxLen * charW) + 32);

  useImperativeHandle(
    ref,
    () => ({
      scrollToLine: (index: number) => {
        const l = listRef.current;
        if (!l || index < 0 || index >= lines.length) return;
        try {
          l.scrollToIndex({ index, animated: false, viewPosition: 0.3 });
        } catch {
          l.scrollToOffset({ offset: Math.max(0, index * lineHeight - 100), animated: false });
        }
      },
    }),
    [lines.length, lineHeight]
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<string>) => {
      const isCurrent = index === currentLine;
      const isMatch = !isCurrent && !!matchLines && matchLines.has(index);
      const lineTokens = tokens ? tokens[index] : undefined;
      const baseColor = (lineColor && lineColor(item)) || textColor;
      const textStyle = { fontFamily: MONO_FONT, fontSize, lineHeight, color: baseColor };
      return (
        <View
          style={[
            styles.row,
            !wrap && { height: lineHeight },
            isMatch && { backgroundColor: matchBg },
            isCurrent && { backgroundColor: currentMatchBg },
          ]}
        >
          {showLineNumbers && (
            <View style={[styles.gutter, { width: gutterW, borderRightColor: borderColor, backgroundColor: gutterBg }]}>
              <Text
                style={{ fontFamily: MONO_FONT, fontSize: gutterFont, lineHeight, color: gutterColor }}
                accessible={false}
              >
                {index + 1}
              </Text>
            </View>
          )}
          <Text
            style={[textStyle, styles.code, wrap ? styles.codeWrap : null]}
            numberOfLines={wrap ? undefined : 1}
            ellipsizeMode="clip"
            selectable
          >
            {lineTokens && lineTokens.length > 0
              ? lineTokens.map((t, i) => (
                  <Text
                    key={i}
                    style={{
                      color: t.type === 'text' || !tokenColor ? baseColor : tokenColor(t.type),
                      fontStyle: t.type === 'comment' || t.type === 'quote' ? 'italic' : 'normal',
                    }}
                  >
                    {t.content}
                  </Text>
                ))
              : item.length > 0
              ? item
              : ' '}
          </Text>
        </View>
      );
    },
    [tokens, fontSize, lineHeight, wrap, showLineNumbers, gutterW, gutterFont, gutterColor, gutterBg, borderColor,
      textColor, tokenColor, lineColor, matchLines, currentLine, matchBg, currentMatchBg]
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<string> | null | undefined, index: number) => ({ length: lineHeight, offset: lineHeight * index, index }),
    [lineHeight]
  );

  const onScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      const l = listRef.current;
      if (!l) return;
      l.scrollToOffset({ offset: Math.max(0, info.index * (info.averageItemLength || lineHeight) - 100), animated: false });
    },
    [lineHeight]
  );

  const list = (
    <FlatList
      ref={listRef}
      data={lines as string[]}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      extraData={renderItem}
      getItemLayout={wrap ? undefined : getItemLayout}
      onScrollToIndexFailed={onScrollToIndexFailed}
      initialNumToRender={40}
      maxToRenderPerBatch={40}
      windowSize={11}
      removeClippedSubviews={Platform.OS === 'android'}
      style={wrap ? styles.fill : { width: contentW }}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={
        <Text style={[styles.empty, { color: gutterColor }]}>{props.emptyText || 'İçerik yok'}</Text>
      }
    />
  );

  return (
    <View style={[styles.fill, { backgroundColor: bgColor }]}>
      {wrap ? (
        list
      ) : (
        <ScrollView horizontal bounces={false} style={styles.fill} contentContainerStyle={{ width: contentW }} nestedScrollEnabled>
          {list}
        </ScrollView>
      )}
    </View>
  );
});

/** >=44dp dokunma alanlı araç çubuğu düğmesi (a11y etiketli). */
export const ToolButton: React.FC<{
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  children: React.ReactNode;
}> = ({ label, onPress, disabled, selected, children }) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled: !!disabled, selected: !!selected }}
    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    style={[styles.toolBtn, disabled && { opacity: 0.4 }]}
  >
    {children}
  </TouchableOpacity>
);

/** Zemin renginin üzerinde okunur metin rengi (siyah/beyaz). */
export function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#0B0F19' : '#FFFFFF';
}

/** Arama durumu: eşleşmeler, ileri/geri gezinme ve eşleşmeye kaydırma. */
export function useLineSearch(lines: readonly string[], onJump: (line: number) => void) {
  const [query, setQueryState] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const jumpRef = useRef(onJump);
  jumpRef.current = onJump;

  const result = useMemo(
    () => (open && query ? findMatches(lines, query) : { matches: [] as LineMatch[], truncated: false }),
    [lines, query, open]
  );
  const matches = result.matches;

  useEffect(() => {
    if (matches.length > 0) {
      const i = Math.min(idx, matches.length - 1);
      jumpRef.current(matches[i].line);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, matches]);

  const matchLines = useMemo(() => new Set(matches.map((m) => m.line)), [matches]);
  const cur = matches.length ? Math.min(idx, matches.length - 1) : -1;

  return {
    query,
    setQuery: (q: string) => {
      setQueryState(q);
      setIdx(0);
    },
    open,
    setOpen,
    close: () => {
      setOpen(false);
      setQueryState('');
      setIdx(0);
    },
    matches,
    truncated: result.truncated,
    index: cur,
    next: () => matches.length && setIdx((cur + 1) % matches.length),
    prev: () => matches.length && setIdx((cur - 1 + matches.length) % matches.length),
    matchLines,
    currentLine: cur >= 0 ? matches[cur].line : -1,
  };
}

export const SearchRow: React.FC<{
  search: ReturnType<typeof useLineSearch>;
  textColor: string;
  mutedColor: string;
  primaryColor: string;
  bgColor: string;
  borderColor: string;
}> = ({ search, textColor, mutedColor, primaryColor, bgColor, borderColor }) => (
  <View style={[styles.searchRow, { backgroundColor: bgColor, borderBottomColor: borderColor }]}>
    <Ionicons name="search" size={16} color={mutedColor} />
    <TextInput
      style={[styles.searchInput, { color: textColor }]}
      placeholder="Ara..."
      placeholderTextColor={mutedColor}
      value={search.query}
      onChangeText={search.setQuery}
      autoFocus
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="search"
      onSubmitEditing={search.next}
      accessibilityLabel="Metin içinde ara"
    />
    {search.query.length > 0 && (
      <Text style={[styles.searchCount, { color: primaryColor }]} accessibilityLiveRegion="polite">
        {search.matches.length === 0
          ? 'Yok'
          : `${search.index + 1}/${search.matches.length}${search.truncated ? '+' : ''}`}
      </Text>
    )}
    <ToolButton label="Önceki eşleşme" onPress={search.prev} disabled={search.matches.length === 0}>
      <Ionicons name="chevron-up" size={20} color={textColor} />
    </ToolButton>
    <ToolButton label="Sonraki eşleşme" onPress={search.next} disabled={search.matches.length === 0}>
      <Ionicons name="chevron-down" size={20} color={textColor} />
    </ToolButton>
    <ToolButton label="Aramayı kapat" onPress={search.close}>
      <Ionicons name="close" size={20} color={mutedColor} />
    </ToolButton>
  </View>
);

function keyExtractor(_: string, index: number) {
  return String(index);
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  listContent: { paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  gutter: { alignItems: 'flex-end', paddingRight: 8, borderRightWidth: StyleSheet.hairlineWidth },
  code: { paddingLeft: 10, paddingRight: 14 },
  codeWrap: { flex: 1 },
  toolBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  searchRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 12, borderBottomWidth: 1, gap: 4 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 8, minHeight: 44 },
  searchCount: { fontSize: 12, fontWeight: '700', minWidth: 36, textAlign: 'right' },
  empty: { padding: 24, textAlign: 'center', fontSize: 14 },
});
