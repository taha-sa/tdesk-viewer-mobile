import React from 'react';
import { View, TextInput, StyleSheet, TouchableOpacity, Text, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppThemeMode, FileType } from '../types';
import { Colors } from '../theme/colors';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  theme?: AppThemeMode;
  selectedCategory?: FileType | 'all';
  onSelectCategory?: (category: FileType | 'all') => void;
  /** Her kategori için sonuç sayısı (verilirse chip etiketinde gösterilir). */
  categoryCounts?: Partial<Record<FileType | 'all', number>>;
}

const CATEGORIES: { id: FileType | 'all'; label: string }[] = [
  { id: 'all', label: 'Tümü' },
  { id: 'pdf', label: 'PDF' },
  { id: 'pptx', label: 'Sunum (PPTX)' },
  { id: 'epub', label: 'E-Kitap (EPUB)' },
  { id: 'code', label: 'Kod & Diller' },
  { id: 'spreadsheet', label: 'Tablo / Excel' },
  { id: 'docx', label: 'Word (DOCX)' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'image', label: 'Görsel / SVG' },
  { id: 'archive', label: 'Arşiv (ZIP)' },
  { id: 'text', label: 'Metin / Log' },
];

const CLEAR_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChangeText,
  placeholder = 'Belge veya kod ara...',
  theme = 'dark',
  selectedCategory = 'all',
  onSelectCategory,
  categoryCounts,
}) => {
  const currentColors = Colors[theme] || Colors.dark;

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: currentColors.surface,
            borderColor: currentColors.border,
          },
        ]}
      >
        <Ionicons name="search" size={18} color={currentColors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={[styles.input, { color: currentColors.text }]}
          placeholder={placeholder}
          placeholderTextColor={currentColors.textMuted}
          value={value}
          onChangeText={onChangeText}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="never"
          accessibilityLabel="Dosya ara"
          accessibilityHint="Dosya adı veya etikete göre arar"
        />
        {value.length > 0 && (
          <TouchableOpacity
            onPress={() => onChangeText('')}
            style={styles.clearBtn}
            hitSlop={CLEAR_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Aramayı temizle"
          >
            <Ionicons name="close-circle" size={20} color={currentColors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {onSelectCategory && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.chipScroll}
          contentContainerStyle={styles.chipRow}
        >
          {CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            const count = categoryCounts?.[cat.id];
            const label = count !== undefined ? `${cat.label} (${count})` : cat.label;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.chip,
                  {
                    backgroundColor: isSelected ? currentColors.primaryGlow : currentColors.surface,
                    borderColor: isSelected ? currentColors.primary : currentColors.border,
                  },
                ]}
                onPress={() => onSelectCategory(cat.id)}
                hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
                accessibilityRole="button"
                accessibilityLabel={`Kategori: ${label}`}
                accessibilityState={{ selected: isSelected }}
              >
                <Text
                  style={[
                    styles.chipText,
                    {
                      color: isSelected ? currentColors.primary : currentColors.textSecondary,
                      fontWeight: isSelected ? '700' : '500',
                    },
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 6,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    marginHorizontal: 16,
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  clearBtn: {
    padding: 4,
  },
  chipScroll: {
    marginTop: 10,
    flexGrow: 0,
  },
  chipRow: {
    paddingHorizontal: 16,
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
  },
});
