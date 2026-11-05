import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FileInfo, AppThemeMode, FileType } from '../types';
import { Colors } from '../theme/colors';
import { SearchBar } from '../components/SearchBar';
import { FileCard } from '../components/FileCard';
import { FileDetailsModal } from '../components/FileDetailsModal';
import { FileService } from '../services/fileService';
import { useRecentFiles } from '../hooks/useRecentFiles';
import {
  SortKey,
  SortDir,
  categoryCounts,
  defaultSortDir,
  filterFiles,
  sortFiles,
  splitMissing,
} from '../utils/fileList';

interface FileBrowserScreenProps {
  appTheme: AppThemeMode;
  initialCategory?: FileType | 'all';
  onOpenFile: (file: FileInfo) => void;
}

type Row = { kind: 'file'; file: FileInfo } | { kind: 'header'; id: string; title: string };

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'date', label: 'Tarih' },
  { key: 'name', label: 'Ad' },
  { key: 'size', label: 'Boyut' },
];

const HIT_SLOP = { top: 8, bottom: 8, left: 6, right: 6 };

export const FileBrowserScreen: React.FC<FileBrowserScreenProps> = ({ appTheme, initialCategory = 'all', onOpenFile }) => {
  const [selectedCategory, setSelectedCategory] = useState<FileType | 'all'>(initialCategory);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [favoritesOnly, setFavoritesOnly] = useState<boolean>(false);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [picking, setPicking] = useState<boolean>(false);
  const mounted = useRef(true);

  const currentColors = Colors[appTheme] || Colors.dark;

  const { files, loading, refreshing, refresh, openFile, toggleFavorite, detailFile, setDetailFile, handleChanged } =
    useRecentFiles(onOpenFile);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (initialCategory) setSelectedCategory(initialCategory);
  }, [initialCategory]);

  const counts = useMemo(() => categoryCounts(files, { query: searchQuery, favoritesOnly }), [files, searchQuery, favoritesOnly]);

  const rows = useMemo<Row[]>(() => {
    const filtered = filterFiles(files, { category: selectedCategory, query: searchQuery, favoritesOnly });
    const { present, missing } = splitMissing(filtered);
    const out: Row[] = sortFiles(present, sortKey, sortDir).map((file) => ({ kind: 'file', file }));
    if (missing.length > 0) {
      out.push({ kind: 'header', id: 'missing-header', title: `Cihazda bulunamayan favoriler (${missing.length})` });
      for (const file of sortFiles(missing, sortKey, sortDir)) out.push({ kind: 'file', file });
    }
    return out;
  }, [files, selectedCategory, searchQuery, favoritesOnly, sortKey, sortDir]);

  const fileCount = useMemo(() => rows.filter((r) => r.kind === 'file').length, [rows]);
  const hasFilters = searchQuery.trim().length > 0 || selectedCategory !== 'all' || favoritesOnly;

  const handlePickDocument = useCallback(async () => {
    if (picking) return;
    setPicking(true);
    try {
      const picked = await FileService.pickDocument();
      if (picked && mounted.current) onOpenFile(picked);
    } finally {
      if (mounted.current) setPicking(false);
    }
  }, [picking, onOpenFile]);

  const handleSortPress = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(defaultSortDir(key));
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedCategory('all');
    setFavoritesOnly(false);
  };

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'header') {
        return (
          <Text style={[styles.sectionHeader, { color: currentColors.warning }]} accessibilityRole="header">
            {item.title}
          </Text>
        );
      }
      return (
        <FileCard
          file={item.file}
          theme={appTheme}
          onPress={openFile}
          onOptionsPress={setDetailFile}
          onToggleFavorite={toggleFavorite}
        />
      );
    },
    [appTheme, currentColors.warning, openFile, setDetailFile, toggleFavorite]
  );

  const keyExtractor = useCallback((item: Row) => (item.kind === 'header' ? item.id : item.file.id), []);

  const emptyComponent = loading ? (
    <View style={styles.emptyState}>
      <ActivityIndicator color={currentColors.primary} />
    </View>
  ) : files.length === 0 ? (
    <View style={styles.emptyState}>
      <Ionicons name="folder-open-outline" size={48} color={currentColors.textMuted} />
      <Text style={[styles.emptyTitle, { color: currentColors.text }]}>Henüz dosya yok</Text>
      <Text style={[styles.emptyDesc, { color: currentColors.textSecondary }]}>
        Açtığınız belgeler burada listelenir. Başlamak için cihazınızdan bir dosya seçin.
      </Text>
      <TouchableOpacity
        style={[styles.emptyBtn, { backgroundColor: currentColors.primary }]}
        onPress={handlePickDocument}
        disabled={picking}
        accessibilityRole="button"
        accessibilityLabel="Cihazdan dosya aç"
      >
        <Text style={[styles.emptyBtnText, { color: currentColors.onPrimary }]}>Cihazdan Dosya Aç</Text>
      </TouchableOpacity>
    </View>
  ) : (
    <View style={styles.emptyState}>
      <Ionicons name="search-outline" size={48} color={currentColors.textMuted} />
      <Text style={[styles.emptyTitle, { color: currentColors.text }]}>Sonuç bulunamadı</Text>
      <Text style={[styles.emptyDesc, { color: currentColors.textSecondary }]}>
        {favoritesOnly ? 'Bu filtrelere uyan favori dosya yok.' : 'Aramanıza veya seçili kategoriye uyan dosya yok.'}
      </Text>
      {hasFilters ? (
        <TouchableOpacity
          style={[styles.emptyBtn, { backgroundColor: currentColors.primary }]}
          onPress={clearFilters}
          accessibilityRole="button"
          accessibilityLabel="Filtreleri temizle"
        >
          <Text style={[styles.emptyBtnText, { color: currentColors.onPrimary }]}>Filtreleri Temizle</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: currentColors.background }]}>
      <View style={styles.topArea}>
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          theme={appTheme}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          categoryCounts={counts}
          placeholder="Ad veya etiket ara..."
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.controlsScroll}
          contentContainerStyle={styles.controlsRow}
        >
          <TouchableOpacity
            style={[
              styles.pill,
              {
                backgroundColor: favoritesOnly ? currentColors.primaryGlow : currentColors.surface,
                borderColor: favoritesOnly ? currentColors.primary : currentColors.border,
              },
            ]}
            onPress={() => setFavoritesOnly((v) => !v)}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Yalnızca favoriler"
            accessibilityState={{ selected: favoritesOnly }}
          >
            <Ionicons
              name={favoritesOnly ? 'star' : 'star-outline'}
              size={14}
              color={favoritesOnly ? currentColors.warning : currentColors.textSecondary}
            />
            <Text style={[styles.pillText, { color: favoritesOnly ? currentColors.primary : currentColors.textSecondary }]}>Favoriler</Text>
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: currentColors.border }]} />

          {SORT_OPTIONS.map((opt) => {
            const active = sortKey === opt.key;
            const dirWord = sortDir === 'asc' ? 'artan' : 'azalan';
            return (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.pill,
                  {
                    backgroundColor: active ? currentColors.primaryGlow : currentColors.surface,
                    borderColor: active ? currentColors.primary : currentColors.border,
                  },
                ]}
                onPress={() => handleSortPress(opt.key)}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={active ? `Sırala: ${opt.label}, ${dirWord}. Yönü değiştirmek için dokunun` : `Sırala: ${opt.label}`}
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.pillText, { color: active ? currentColors.primary : currentColors.textSecondary }]}>{opt.label}</Text>
                {active ? (
                  <Ionicons name={sortDir === 'asc' ? 'arrow-up' : 'arrow-down'} size={13} color={currentColors.primary} />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.listHeader}>
        <Text style={[styles.resultCount, { color: currentColors.textSecondary }]} accessibilityLiveRegion="polite">
          {fileCount} dosya
        </Text>
        <TouchableOpacity
          style={styles.importQuickBtn}
          onPress={handlePickDocument}
          disabled={picking}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Cihazdan dosya aç"
          accessibilityState={{ disabled: picking }}
        >
          <Ionicons name="folder-open-outline" size={16} color={currentColors.primary} />
          <Text style={[styles.importQuickText, { color: currentColors.primary }]}>{picking ? 'Açılıyor...' : 'Dosya Aç'}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={emptyComponent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={currentColors.primary} colors={[currentColors.primary]} />}
        initialNumToRender={12}
        windowSize={9}
        removeClippedSubviews
      />

      <FileDetailsModal
        visible={!!detailFile}
        file={detailFile}
        theme={appTheme}
        onClose={() => setDetailFile(null)}
        onOpen={openFile}
        onShare={(file) => {
          void FileService.shareFile(file);
        }}
        onChanged={() => {
          void handleChanged();
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topArea: {
    paddingTop: 12,
  },
  controlsScroll: {
    flexGrow: 0,
    marginTop: 4,
  },
  controlsRow: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    gap: 8,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  divider: {
    width: 1,
    height: 20,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    flexGrow: 1,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    minHeight: 32,
  },
  resultCount: {
    fontSize: 12,
    fontWeight: '700',
  },
  importQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  importQuickText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 8,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 12,
  },
  emptyDesc: {
    fontSize: 12.5,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  emptyBtn: {
    paddingHorizontal: 18,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 10,
    marginTop: 16,
  },
  emptyBtnText: {
    fontSize: 13,
    fontWeight: '800',
  },
});
