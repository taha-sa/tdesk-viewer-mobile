import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { FileInfo, AppThemeMode, FileType } from '../types';
import { Colors, getFormatColors } from '../theme/colors';
import { FormatBadge } from './FormatBadge';
import { FileService } from '../services/fileService';
import { CATEGORY_LABELS, formatShortDate } from '../utils/fileList';
import { t } from '../i18n';

interface FileCardProps {
  file: FileInfo;
  theme?: AppThemeMode;
  onPress: (file: FileInfo) => void;
  onOptionsPress?: (file: FileInfo) => void;
  /** Verilirse kartta favori yıldızı gösterilir. */
  onToggleFavorite?: (file: FileInfo) => void;
}

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const CATEGORY_ICONS: Record<FileType, IconName> = {
  pdf: 'file-pdf-box',
  code: 'code-tags',
  markdown: 'language-markdown',
  spreadsheet: 'file-excel-box',
  docx: 'file-word-box',
  pptx: 'file-powerpoint-box',
  epub: 'book-open-page-variant',
  image: 'file-image',
  archive: 'zip-box',
  text: 'file-document-outline',
  unsupported: 'file-alert-outline',
  unknown: 'file-document-outline',
};

const HIT_SLOP = { top: 8, bottom: 8, left: 4, right: 4 };
const MAX_CARD_TAGS = 3;

const FileCardBase: React.FC<FileCardProps> = ({ file, theme = 'emerald', onPress, onOptionsPress, onToggleFavorite }) => {
  const currentColors = Colors[theme] || Colors.emerald;
  const iconColor = getFormatColors(file.category, theme === 'light').text;
  const tags = file.tags ?? [];
  const shownTags = tags.slice(0, MAX_CARD_TAGS);
  const extraTags = tags.length - shownTags.length;
  const isFav = file.isFavorite === true;
  const sizeText = FileService.formatFileSize(file.size);
  const dateText = file.lastOpened ? formatShortDate(file.lastOpened) : '';

  const a11yLabel = [
    file.name,
    CATEGORY_LABELS[file.category] ?? '',
    sizeText,
    dateText,
    isFav ? t('fileCard.favorite') : '',
    file.missing ? t('fileCard.missingA11y') : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: currentColors.card,
          borderColor: currentColors.cardBorder,
          opacity: file.missing ? 0.75 : 1,
        },
      ]}
    >
      <TouchableOpacity
        style={styles.mainArea}
        onPress={() => onPress(file)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint={file.missing ? t('fileCard.missingHint') : t('fileCard.openHint')}
      >
        <View style={[styles.iconContainer, { backgroundColor: currentColors.surface }]}>
          <MaterialCommunityIcons name={CATEGORY_ICONS[file.category] ?? 'file-document-outline'} size={26} color={iconColor} />
        </View>

        <View style={styles.detailsContainer}>
          <View style={styles.titleRow}>
            <Text style={[styles.fileName, { color: currentColors.text }]} numberOfLines={1}>
              {file.name}
            </Text>
            {file.isSample && (
              <View style={[styles.samplePill, { backgroundColor: currentColors.primaryGlow }]}>
                <Text style={[styles.samplePillText, { color: currentColors.primary }]}>{t('fileCard.sample')}</Text>
              </View>
            )}
          </View>

          <View style={styles.metaRow}>
            <FormatBadge type={file.category} extension={file.extension} size="small" theme={theme} />
            <Text style={[styles.metaText, { color: currentColors.textSecondary }]}>{sizeText}</Text>
            {dateText ? <Text style={[styles.metaText, { color: currentColors.textMuted }]}>• {dateText}</Text> : null}
          </View>

          {file.missing ? (
            <View style={styles.missingRow}>
              <Ionicons name="alert-circle-outline" size={13} color={currentColors.warning} />
              <Text style={[styles.missingText, { color: currentColors.warning }]}>{t('fileCard.missing')}</Text>
            </View>
          ) : null}

          {shownTags.length > 0 ? (
            <View style={styles.tagRow}>
              {shownTags.map((t) => (
                <View key={t} style={[styles.tagPill, { backgroundColor: currentColors.primaryGlow, borderColor: currentColors.border }]}>
                  <Text style={[styles.tagText, { color: currentColors.primary }]} numberOfLines={1}>
                    {t}
                  </Text>
                </View>
              ))}
              {extraTags > 0 ? <Text style={[styles.metaText, { color: currentColors.textMuted }]}>+{extraTags}</Text> : null}
            </View>
          ) : null}
        </View>
      </TouchableOpacity>

      {onToggleFavorite && !file.virtual ? (
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => onToggleFavorite(file)}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={isFav ? t('fileCard.removeFavA11y', { name: file.name }) : t('fileCard.addFavA11y', { name: file.name })}
          accessibilityState={{ selected: isFav }}
        >
          <Ionicons name={isFav ? 'star' : 'star-outline'} size={20} color={isFav ? currentColors.warning : currentColors.textMuted} />
        </TouchableOpacity>
      ) : null}

      {onOptionsPress ? (
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => onOptionsPress(file)}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={t('fileCard.optionsA11y', { name: file.name })}
        >
          <Ionicons name="ellipsis-vertical" size={19} color={currentColors.textMuted} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

export const FileCard = React.memo(FileCardBase);

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 4,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  mainArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
  },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  detailsContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileName: {
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  samplePill: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
    marginLeft: 6,
  },
  samplePillText: {
    fontSize: 8.5,
    fontWeight: '800',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
    gap: 6,
  },
  metaText: {
    fontSize: 11,
    fontWeight: '500',
  },
  missingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
  },
  missingText: {
    fontSize: 11,
    fontWeight: '600',
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  tagPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 110,
  },
  tagText: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  actionBtn: {
    minWidth: 38,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
