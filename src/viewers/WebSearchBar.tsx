import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Palette {
  background: string;
  card: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
}

interface WebSearchBarProps {
  colors: Palette;
  value: string;
  onChange: (text: string) => void;
  /** Eşleşme sayısı ve geçerli sıra (0 tabanlı, yoksa -1) */
  count: number;
  index: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  /** Aramanın kapsamı hakkında kısa not (örn. "Bu bölümde") */
  scopeLabel?: string;
  /** Süren tarama durumu (örn. "taranıyor %40") */
  busyText?: string;
}

const HIT = { top: 4, bottom: 4, left: 4, right: 4 };

export const WebSearchBar: React.FC<WebSearchBarProps> = ({ colors, value, onChange, count, index, onNext, onPrev, onClose, scopeLabel, busyText }) => {
  const hasQuery = value.trim().length > 0;
  const base = count === 0 ? (busyText ? '' : 'Sonuç yok') : `${index + 1} / ${count}`;
  const status = !hasQuery ? '' : [base, busyText].filter(Boolean).join(' · ');
  return (
    <View style={[styles.wrap, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      <View style={[styles.inputBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={[styles.input, { color: colors.text }]}
          value={value}
          onChangeText={onChange}
          placeholder={scopeLabel ? `Ara (${scopeLabel})` : 'Ara'}
          placeholderTextColor={colors.textMuted}
          autoFocus
          returnKeyType="search"
          onSubmitEditing={onNext}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Belgede ara"
        />
        {hasQuery ? <Text style={[styles.status, { color: colors.textMuted }]} accessibilityLiveRegion="polite">{status}</Text> : null}
      </View>
      <TouchableOpacity style={styles.btn} onPress={onPrev} disabled={count === 0} hitSlop={HIT} accessibilityRole="button" accessibilityLabel="Önceki sonuç" accessibilityState={{ disabled: count === 0 }}>
        <Ionicons name="chevron-up" size={22} color={count === 0 ? colors.textMuted : colors.text} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.btn} onPress={onNext} disabled={count === 0} hitSlop={HIT} accessibilityRole="button" accessibilityLabel="Sonraki sonuç" accessibilityState={{ disabled: count === 0 }}>
        <Ionicons name="chevron-down" size={22} color={count === 0 ? colors.textMuted : colors.text} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.btn} onPress={onClose} hitSlop={HIT} accessibilityRole="button" accessibilityLabel="Aramayı kapat">
        <Ionicons name="close" size={22} color={colors.text} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, gap: 4, borderBottomWidth: 1 },
  inputBox: { flex: 1, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, minHeight: 44, gap: 6 },
  input: { flex: 1, fontSize: 15, paddingVertical: 6 },
  status: { fontSize: 12, fontWeight: '700' },
  btn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
