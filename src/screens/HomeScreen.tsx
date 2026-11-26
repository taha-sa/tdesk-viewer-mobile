import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { FileInfo, AppThemeMode, FileType } from '../types';
import { Colors } from '../theme/colors';
import { Header } from '../components/Header';
import { FileCard } from '../components/FileCard';
import { FileDetailsModal } from '../components/FileDetailsModal';
import { AboutModal } from '../components/AboutModal';
import { FileService } from '../services/fileService';
import { useRecentFiles } from '../hooks/useRecentFiles';
import { sortFiles, splitMissing, CATEGORY_LABELS } from '../utils/fileList';
import { t } from '../i18n';

interface HomeScreenProps {
  appTheme: AppThemeMode;
  onOpenFile: (file: FileInfo) => void;
  onNavigateToBrowser: (category?: FileType) => void;
  onThemeToggle: () => void;
}

type TabType = FileType | 'all' | 'favorites';
type IconName = React.ComponentProps<typeof Ionicons>['name'];

const homeKeyExtractor = (f: FileInfo) => f.id;

const getCategoryTabs = (): { id: TabType; label: string; icon: IconName }[] => [
  { id: 'all', label: t('common.all'), icon: 'apps-outline' },
  { id: 'favorites', label: t('common.favorites'), icon: 'star-outline' },
  { id: 'pdf', label: CATEGORY_LABELS.pdf, icon: 'document-text-outline' },
  { id: 'pptx', label: CATEGORY_LABELS.pptx, icon: 'easel-outline' },
  { id: 'epub', label: CATEGORY_LABELS.epub, icon: 'book-outline' },
  { id: 'code', label: CATEGORY_LABELS.code, icon: 'code-slash-outline' },
  { id: 'spreadsheet', label: CATEGORY_LABELS.spreadsheet, icon: 'grid-outline' },
  { id: 'markdown', label: CATEGORY_LABELS.markdown, icon: 'reader-outline' },
  { id: 'docx', label: CATEGORY_LABELS.docx, icon: 'document-outline' },
  { id: 'image', label: CATEGORY_LABELS.image, icon: 'image-outline' },
  { id: 'archive', label: CATEGORY_LABELS.archive, icon: 'archive-outline' },
  { id: 'text', label: CATEGORY_LABELS.text, icon: 'reorder-three-outline' },
];

const RECENT_LIMIT = 8;

export const HomeScreen: React.FC<HomeScreenProps> = ({ appTheme, onOpenFile, onNavigateToBrowser, onThemeToggle }) => {
  const [selectedTab, setSelectedTab] = useState<TabType>('all');
  const [isAboutVisible, setIsAboutVisible] = useState<boolean>(false);
  const [picking, setPicking] = useState<boolean>(false);
  const mounted = useRef(true);

  const currentColors = Colors[appTheme] || Colors.emerald;

  const { files, loading, refreshing, refresh, openFile, toggleFavorite, detailFile, setDetailFile, handleChanged } =
    useRecentFiles(onOpenFile);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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

  const tabCounts = useMemo(() => {
    const counts: Partial<Record<TabType, number>> = { all: 0, favorites: 0 };
    for (const f of files) {
      if (f.missing) continue;
      counts.all = (counts.all ?? 0) + 1;
      if (f.isFavorite) counts.favorites = (counts.favorites ?? 0) + 1;
      counts[f.category] = (counts[f.category] ?? 0) + 1;
    }
    return counts;
  }, [files]);

  const filtered = useMemo(() => {
    const { present } = splitMissing(files);
    const matching =
      selectedTab === 'all'
        ? present
        : selectedTab === 'favorites'
        ? present.filter((f) => f.isFavorite)
        : present.filter((f) => f.category === selectedTab);
    return sortFiles(matching, 'date', 'desc');
  }, [files, selectedTab]);

  const shown = useMemo(() => filtered.slice(0, RECENT_LIMIT), [filtered]);
  const hasAny = files.length > 0;
  const categoryTabs = getCategoryTabs();
  const selectedLabel = categoryTabs.find((tab) => tab.id === selectedTab)?.label ?? '';
  const sectionTitle = selectedTab === 'all' ? t('home.recentFiles') : selectedTab === 'favorites' ? t('common.favorites') : selectedLabel;

  const goToBrowser = useCallback(() => {
    onNavigateToBrowser(selectedTab !== 'all' && selectedTab !== 'favorites' ? selectedTab : undefined);
  }, [onNavigateToBrowser, selectedTab]);

  const renderItem = useCallback(
    ({ item }: { item: FileInfo }) => (
      <FileCard file={item} theme={appTheme} onPress={openFile} onOptionsPress={setDetailFile} onToggleFavorite={toggleFavorite} />
    ),
    [appTheme, openFile, setDetailFile, toggleFavorite]
  );

  const listHeader = (
    <View>
      <View style={styles.heroWrapper}>
        <TouchableOpacity
          style={[styles.heroBox, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}
          onPress={handlePickDocument}
          disabled={picking}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('home.pickA11y')}
          accessibilityState={{ disabled: picking, busy: picking }}
        >
          <View style={[styles.heroIconCircle, { backgroundColor: currentColors.primaryGlow }]}>
            {picking ? (
              <ActivityIndicator color={currentColors.primary} />
            ) : (
              <MaterialCommunityIcons name="folder-open-outline" size={28} color={currentColors.primary} />
            )}
          </View>
          <View style={styles.heroTextContent}>
            <Text style={[styles.heroTitle, { color: currentColors.text }]}>{t('common.openFile')}</Text>
            <Text style={[styles.heroSub, { color: currentColors.textSecondary }]}>
              {t('home.heroFormats')}
            </Text>
          </View>
          <View style={[styles.pickBadge, { backgroundColor: currentColors.primary }]}>
            <Text style={[styles.pickBadgeText, { color: currentColors.onPrimary }]}>{picking ? t('common.opening') : t('common.browse')}</Text>
          </View>
        </TouchableOpacity>
      </View>

      {hasAny ? (
        <View style={styles.tabSection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
            {categoryTabs.map((tab) => {
              const isSelected = selectedTab === tab.id;
              const count = tabCounts[tab.id] ?? 0;
              const label = count > 0 ? `${tab.label} (${count})` : tab.label;
              return (
                <TouchableOpacity
                  key={tab.id}
                  style={[
                    styles.tabPill,
                    {
                      backgroundColor: isSelected ? currentColors.surfaceLight : currentColors.card,
                      borderColor: isSelected ? currentColors.primary : currentColors.cardBorder,
                    },
                  ]}
                  onPress={() => setSelectedTab(tab.id)}
                  hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t('home.filterA11y', { label })}
                  accessibilityState={{ selected: isSelected }}
                >
                  <Ionicons name={tab.icon} size={14} color={isSelected ? currentColors.primary : currentColors.textSecondary} />
                  <Text
                    style={[
                      styles.tabPillText,
                      { color: isSelected ? currentColors.primary : currentColors.textSecondary, fontWeight: isSelected ? '700' : '500' },
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {hasAny ? (
        <View style={styles.listHeader}>
          <Text style={[styles.listTitle, { color: currentColors.text }]} accessibilityRole="header">
            {sectionTitle}
          </Text>
          <Text style={[styles.fileCountText, { color: currentColors.textSecondary }]}>{t('archive.fileCount', { count: filtered.length })}</Text>
        </View>
      ) : null}
    </View>
  );

  const listFooter =
    hasAny && filtered.length > 0 ? (
      <TouchableOpacity
        style={[styles.moreBtn, { borderColor: currentColors.border, backgroundColor: currentColors.card }]}
        onPress={goToBrowser}
        accessibilityRole="button"
        accessibilityLabel={t('home.goAllA11y', { count: filtered.length })}
      >
        <Text style={[styles.moreBtnText, { color: currentColors.primary }]}>
          {filtered.length > RECENT_LIMIT ? t('home.seeAll', { count: filtered.length }) : t('home.searchAndSort')}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={currentColors.primary} />
      </TouchableOpacity>
    ) : null;

  const listEmpty = loading ? (
    <View style={styles.emptyState}>
      <ActivityIndicator color={currentColors.primary} />
    </View>
  ) : !hasAny ? (
    <View style={styles.emptyState}>
      <Ionicons name="documents-outline" size={52} color={currentColors.textMuted} />
      <Text style={[styles.emptyTitle, { color: currentColors.text }]}>{t('home.emptyTitle')}</Text>
      <Text style={[styles.emptyDesc, { color: currentColors.textSecondary }]}>
        {t('home.emptyBody')}
      </Text>
    </View>
  ) : (
    <View style={styles.emptyState}>
      <Ionicons name="file-tray-outline" size={44} color={currentColors.textMuted} />
      <Text style={[styles.emptyTitle, { color: currentColors.text }]}>
        {selectedTab === 'favorites' ? t('home.noFavs') : selectedTab === 'all' ? t('home.noFiles') : t('home.noFilesOfType')}
      </Text>
      <Text style={[styles.emptyDesc, { color: currentColors.textSecondary }]}>
        {selectedTab === 'favorites'
          ? t('home.noFavsHint')
          : selectedTab === 'all'
          ? t('home.allMissingHint')
          : t('home.otherFilterHint')}
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: currentColors.background }]}>
      <Header
        theme={appTheme}
        onThemePress={onThemeToggle}
        onSearchPress={() => onNavigateToBrowser()}
        onInfoPress={() => setIsAboutVisible(true)}
      />
      <FlatList
        data={shown}
        keyExtractor={homeKeyExtractor}
        renderItem={renderItem}
        style={styles.scroll}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={listFooter}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={currentColors.primary} colors={[currentColors.primary]} />}
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
      <AboutModal visible={isAboutVisible} theme={appTheme} onClose={() => setIsAboutVisible(false)} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 32, flexGrow: 1 },
  heroWrapper: { paddingTop: 16, paddingBottom: 8 },
  heroBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
    minHeight: 76,
  },
  heroIconCircle: { width: 46, height: 46, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  heroTextContent: { flex: 1 },
  heroTitle: { fontSize: 15.5, fontWeight: '800', letterSpacing: 0.2 },
  heroSub: { fontSize: 11.5, marginTop: 3, lineHeight: 16 },
  pickBadge: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, marginLeft: 8 },
  pickBadgeText: { fontSize: 12, fontWeight: '800' },
  tabSection: { paddingVertical: 6, marginHorizontal: -16 },
  tabsScroll: { paddingHorizontal: 16, gap: 8 },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  tabPillText: { fontSize: 12 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 10 },
  listTitle: { fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
  fileCountText: { fontSize: 12, fontWeight: '600' },
  moreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  moreBtnText: { fontSize: 13, fontWeight: '700' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 36, paddingHorizontal: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginTop: 12, textAlign: 'center' },
  emptyDesc: { fontSize: 12.5, textAlign: 'center', marginTop: 8, lineHeight: 19 },
});
