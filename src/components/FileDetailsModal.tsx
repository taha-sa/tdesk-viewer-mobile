import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Alert,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FileInfo, AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import { FileService } from '../services/fileService';
import { FormatBadge } from './FormatBadge';
import { CATEGORY_LABELS, formatDateTime } from '../utils/fileList';
import { t } from '../i18n';

interface FileDetailsModalProps {
  visible: boolean;
  file: FileInfo | null;
  theme?: AppThemeMode;
  onClose: () => void;
  onOpen: (file: FileInfo) => void;
  onShare?: (file: FileInfo) => void;
  /** Favori / etiket / ad / silme sonrası çağrılır; çağıran listeyi yenilemelidir. */
  onChanged?: () => void;
}

const AVAILABLE_TAGS = ['İş', 'Kişisel', 'Fatura', 'Önemli', 'Taslak'];
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

export const FileDetailsModal: React.FC<FileDetailsModalProps> = ({
  visible,
  file,
  theme = 'emerald',
  onClose,
  onOpen,
  onShare,
  onChanged,
}) => {
  const currentColors = Colors[theme] || Colors.emerald;
  const insets = useSafeAreaInsets();
  const { height: winHeight } = useWindowDimensions();

  // Kapanış animasyonu sürerken (file null olsa bile) son dosyayı göstermeye devam et.
  const lastFileRef = useRef<FileInfo | null>(file);
  if (file) lastFileRef.current = file;
  const shown = file ?? lastFileRef.current;

  const [tags, setTags] = useState<string[]>(shown?.tags ?? []);
  const [isFav, setIsFav] = useState<boolean>(shown?.isFavorite === true);
  const [renaming, setRenaming] = useState<boolean>(false);
  const [nameDraft, setNameDraft] = useState<string>(shown?.name ?? '');
  const [copied, setCopied] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (file) {
      setTags(file.tags ?? []);
      setIsFav(file.isFavorite === true);
      setNameDraft(file.name);
    }
  }, [file]);

  useEffect(() => {
    if (!visible) setRenaming(false);
  }, [visible]);

  const canManage = !!shown && !shown.virtual && !shown.isSample;

  const handleToggleTag = useCallback(
    async (tag: string) => {
      if (!shown || !canManage) return;
      const updated = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
      setTags(updated);
      await FileService.updateTags(shown.id, updated);
      if (mounted.current) onChanged?.();
    },
    [shown, canManage, tags, onChanged]
  );

  const handleToggleFavorite = useCallback(async () => {
    if (!shown || !canManage || busy) return;
    setBusy(true);
    try {
      const next = await FileService.toggleFavorite(shown.id);
      if (!mounted.current) return;
      if (!next && !isFav) {
        Alert.alert(t('details.favFailTitle'), t('details.favFailBody'));
      } else {
        setIsFav(next);
        onChanged?.();
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [shown, canManage, busy, isFav, onChanged]);

  const handleSaveRename = useCallback(async () => {
    if (!shown || busy) return;
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      Alert.alert(t('details.nameEmptyTitle'), t('details.nameEmptyBody'));
      return;
    }
    setBusy(true);
    try {
      const updated = await FileService.renameRecentFile(shown.id, trimmed);
      if (!mounted.current) return;
      if (updated) {
        setRenaming(false);
        onChanged?.();
      } else {
        Alert.alert(t('details.renameFailTitle'), t('details.renameFailBody'));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [shown, busy, nameDraft, onChanged]);

  const handleRemove = useCallback(() => {
    if (!shown) return;
    Alert.alert(
      t('common.removeFromList'),
      t(isFav ? 'details.removeConfirmFav' : 'details.removeConfirm', { name: shown.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.remove'),
          style: 'destructive',
          onPress: () => {
            void FileService.removeRecentFile(shown.id).then((ok) => {
              if (!mounted.current) return;
              if (ok) {
                onChanged?.();
                onClose();
              } else {
                Alert.alert(t('details.removeFailTitle'), t('details.removeFailBody'));
              }
            });
          },
        },
      ]
    );
  }, [shown, isFav, onChanged, onClose]);

  const handleCopyPath = useCallback(async () => {
    if (!shown) return;
    try {
      await Clipboard.setStringAsync(shown.uri);
      if (!mounted.current) return;
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => {
        if (mounted.current) setCopied(false);
      }, 1800);
    } catch {
      Alert.alert(t('details.copyFailTitle'), t('details.copyFailBody'));
    }
  }, [shown]);

  const tagOptions = Array.from(new Set([...AVAILABLE_TAGS, ...tags]));
  const displayName = shown?.name ?? '';

  return (
    <Modal visible={visible && !!shown} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Pencereyi kapat" accessibilityRole="button">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
          <Pressable
            style={[
              styles.modalContent,
              {
                backgroundColor: currentColors.card,
                borderColor: currentColors.cardBorder,
                paddingBottom: 20 + insets.bottom,
                maxHeight: Math.round(winHeight * 0.88),
              },
            ]}
            onPress={() => {}}
            accessible={false}
          >
            {shown ? (
              <>
                <View style={styles.header}>
                  <View style={styles.headerTitleRow}>
                    <FormatBadge type={shown.category} extension={shown.extension} size="medium" theme={theme} />
                    <Text style={[styles.fileName, { color: currentColors.text }]} numberOfLines={2} accessibilityRole="header">
                      {displayName}
                    </Text>
                  </View>
                  {canManage && (
                    <TouchableOpacity
                      onPress={handleToggleFavorite}
                      style={styles.iconBtn}
                      hitSlop={HIT_SLOP}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={isFav ? t('common.removeFav') : t('common.addFav')}
                      accessibilityState={{ selected: isFav, disabled: busy }}
                    >
                      <Ionicons name={isFav ? 'star' : 'star-outline'} size={24} color={isFav ? currentColors.warning : currentColors.textMuted} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={onClose}
                    style={styles.iconBtn}
                    hitSlop={HIT_SLOP}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.close')}
                  >
                    <Ionicons name="close" size={24} color={currentColors.textMuted} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  {shown.missing && (
                    <View style={[styles.warnBox, { backgroundColor: currentColors.surface, borderColor: currentColors.warning }]}>
                      <Ionicons name="alert-circle-outline" size={18} color={currentColors.warning} />
                      <Text style={[styles.warnText, { color: currentColors.text }]}>
                        {t('details.missingWarn')}
                      </Text>
                    </View>
                  )}

                  {canManage && (
                    <>
                      <View style={styles.sectionHeader}>
                        <Text style={[styles.sectionTitle, { color: currentColors.textSecondary }]}>{t('common.name')}</Text>
                      </View>
                      {renaming ? (
                        <View style={styles.renameBox}>
                          <TextInput
                            style={[styles.renameInput, { color: currentColors.text, backgroundColor: currentColors.surface, borderColor: currentColors.primary }]}
                            value={nameDraft}
                            onChangeText={setNameDraft}
                            autoFocus
                            selectTextOnFocus
                            maxLength={120}
                            returnKeyType="done"
                            onSubmitEditing={handleSaveRename}
                            accessibilityLabel={t('details.newNameA11y')}
                            placeholderTextColor={currentColors.textMuted}
                          />
                          <View style={styles.renameActions}>
                            <TouchableOpacity
                              style={[styles.smallBtn, { backgroundColor: currentColors.surface, borderColor: currentColors.border }]}
                              onPress={() => {
                                setRenaming(false);
                                setNameDraft(displayName);
                              }}
                              hitSlop={HIT_SLOP}
                              accessibilityRole="button"
                              accessibilityLabel={t('details.cancelRenameA11y')}
                            >
                              <Text style={[styles.smallBtnText, { color: currentColors.text }]}>{t('common.cancel')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.smallBtn, { backgroundColor: currentColors.primary, borderColor: currentColors.primary }]}
                              onPress={handleSaveRename}
                              disabled={busy}
                              hitSlop={HIT_SLOP}
                              accessibilityRole="button"
                              accessibilityLabel={t('details.saveNameA11y')}
                              accessibilityState={{ disabled: busy }}
                            >
                              <Text style={[styles.smallBtnText, { color: currentColors.onPrimary }]}>{t('common.save')}</Text>
                            </TouchableOpacity>
                          </View>
                          <Text style={[styles.hintText, { color: currentColors.textMuted }]}>
                            {t('details.renameHint')}
                          </Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={[styles.rowBtn, { backgroundColor: currentColors.surface }]}
                          onPress={() => setRenaming(true)}
                          accessibilityRole="button"
                          accessibilityLabel={t('details.renameA11y')}
                        >
                          <Ionicons name="create-outline" size={18} color={currentColors.text} />
                          <Text style={[styles.rowBtnText, { color: currentColors.text }]}>{t('details.rename')}</Text>
                        </TouchableOpacity>
                      )}

                      <View style={styles.sectionHeader}>
                        <Text style={[styles.sectionTitle, { color: currentColors.textSecondary }]}>{t('details.tags')}</Text>
                      </View>
                      <View style={styles.tagsContainer}>
                        {tagOptions.map((tag) => {
                          const isActive = tags.includes(tag);
                          return (
                            <TouchableOpacity
                              key={tag}
                              style={[
                                styles.tagPill,
                                {
                                  backgroundColor: isActive ? currentColors.primaryGlow : currentColors.surface,
                                  borderColor: isActive ? currentColors.primary : currentColors.border,
                                },
                              ]}
                              onPress={() => handleToggleTag(tag)}
                              hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
                              accessibilityRole="button"
                              accessibilityLabel={`Etiket: ${tag}`}
                              accessibilityState={{ selected: isActive }}
                            >
                              <Text style={[styles.tagText, { color: isActive ? currentColors.primary : currentColors.textSecondary }]}>{tag}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </>
                  )}

                  <View style={styles.sectionHeader}>
                    <Text style={[styles.sectionTitle, { color: currentColors.textSecondary }]}>{t('details.sectionTitle')}</Text>
                  </View>

                  <View style={styles.grid}>
                    <View style={[styles.gridItem, { backgroundColor: currentColors.surface }]}>
                      <Text style={[styles.gridLabel, { color: currentColors.textMuted }]}>{t('details.size')}</Text>
                      <Text style={[styles.gridValue, { color: currentColors.text }]}>{FileService.formatFileSize(shown.size)}</Text>
                    </View>

                    <View style={[styles.gridItem, { backgroundColor: currentColors.surface }]}>
                      <Text style={[styles.gridLabel, { color: currentColors.textMuted }]}>{t('details.extension')}</Text>
                      <Text style={[styles.gridValue, { color: currentColors.primary }]}>
                        {(shown.extension || shown.category).toUpperCase()}
                      </Text>
                    </View>

                    <View style={[styles.gridItem, { backgroundColor: currentColors.surface }]}>
                      <Text style={[styles.gridLabel, { color: currentColors.textMuted }]}>{t('details.category')}</Text>
                      <Text style={[styles.gridValue, { color: currentColors.text }]}>{CATEGORY_LABELS[shown.category] ?? '—'}</Text>
                    </View>

                    <View style={[styles.gridItem, { backgroundColor: currentColors.surface }]}>
                      <Text style={[styles.gridLabel, { color: currentColors.textMuted }]}>{t('details.lastOpened')}</Text>
                      <Text style={[styles.gridValue, { color: currentColors.text }]}>{formatDateTime(shown.lastOpened)}</Text>
                    </View>
                  </View>

                  {shown.originalName && shown.originalName !== shown.name ? (
                    <View style={[styles.pathBox, { backgroundColor: currentColors.surface, marginBottom: 10 }]}>
                      <Text style={[styles.gridLabel, { color: currentColors.textMuted }]}>{t('details.originalName')}</Text>
                      <Text style={[styles.pathText, { color: currentColors.textSecondary }]} numberOfLines={2} selectable>
                        {shown.originalName}
                      </Text>
                    </View>
                  ) : null}

                  <View style={[styles.pathBox, { backgroundColor: currentColors.surface }]}>
                    <View style={styles.pathHeader}>
                      <Text style={[styles.gridLabel, { color: currentColors.textMuted, marginBottom: 0 }]}>{t('details.location')}</Text>
                      <TouchableOpacity
                        onPress={handleCopyPath}
                        hitSlop={HIT_SLOP}
                        style={styles.copyBtn}
                        accessibilityRole="button"
                        accessibilityLabel={t('details.copyPathA11y')}
                      >
                        <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={currentColors.primary} />
                        <Text style={[styles.copyText, { color: currentColors.primary }]}>{copied ? t('details.copied') : t('details.copy')}</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={[styles.pathText, { color: currentColors.textSecondary }]} numberOfLines={3} selectable>
                      {shown.uri}
                    </Text>
                  </View>

                  {canManage && (
                    <TouchableOpacity
                      style={[styles.removeBtn, { borderColor: currentColors.danger }]}
                      onPress={handleRemove}
                      accessibilityRole="button"
                      accessibilityLabel={t('common.removeFromList')}
                    >
                      <Ionicons name="trash-outline" size={18} color={currentColors.danger} />
                      <Text style={[styles.removeBtnText, { color: currentColors.danger }]}>{t('common.removeFromList')}</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: currentColors.surface, borderColor: currentColors.border, opacity: shown.missing ? 0.5 : 1 }]}
                    onPress={() => onShare?.(shown)}
                    disabled={!!shown.missing || !onShare}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.share')}
                    accessibilityState={{ disabled: !!shown.missing || !onShare }}
                  >
                    <Ionicons name="share-social-outline" size={20} color={currentColors.text} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.primaryOpenBtn, { backgroundColor: currentColors.primary, opacity: shown.missing ? 0.5 : 1 }]}
                    onPress={() => {
                      onClose();
                      onOpen(shown);
                    }}
                    disabled={!!shown.missing}
                    accessibilityRole="button"
                    accessibilityLabel={t('details.openA11y')}
                    accessibilityState={{ disabled: !!shown.missing }}
                  >
                    <MaterialCommunityIcons name="eye-outline" size={20} color={currentColors.onPrimary} />
                    <Text style={[styles.primaryOpenBtnText, { color: currentColors.onPrimary }]}>{t('details.openButton')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  kav: {
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 4,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '800',
    flex: 1,
  },
  iconBtn: {
    minWidth: 40,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flexGrow: 0,
    marginBottom: 12,
  },
  warnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  warnText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
  },
  sectionHeader: {
    marginTop: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  rowBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  renameBox: {
    gap: 8,
  },
  renameInput: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    fontSize: 14.5,
  },
  renameActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  smallBtn: {
    minHeight: 40,
    minWidth: 84,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  hintText: {
    fontSize: 11.5,
    lineHeight: 16,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  tagPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
  },
  tagText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  gridItem: {
    flexBasis: '48%',
    flexGrow: 1,
    padding: 12,
    borderRadius: 12,
  },
  gridLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  gridValue: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  pathBox: {
    padding: 12,
    borderRadius: 12,
  },
  pathHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
  },
  copyText: {
    fontSize: 12,
    fontWeight: '700',
  },
  pathText: {
    fontSize: 11.5,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    marginTop: 4,
  },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 46,
    marginTop: 14,
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  removeBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 4,
  },
  actionButton: {
    width: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  primaryOpenBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 12,
  },
  primaryOpenBtnText: {
    fontSize: 15,
    fontWeight: '800',
  },
});
