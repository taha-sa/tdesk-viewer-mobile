import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Switch } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { SYNTAX_THEMES } from '../theme/syntaxThemes';
import { THEME_OPTIONS } from '../theme/themeOptions';
import { FileService } from '../services/fileService';
import { checkForUpdate, openUpdate, formatUpdateMessage, fetchCodeUpdate, restartApp } from '../services/updateService';
import { loadPdfEngine, savePdfEngine, PdfEngine } from '../utils/pdfEngine';
import { getLockAvailability, LockAvailability } from '../services/appLock';
import { getAppVersion } from '../utils/appInfo';
import { AboutSection } from '../components/AboutSection';
import { AppThemeMode, SyntaxTheme, ThemePreference } from '../types';
import { t, LanguagePref } from '../i18n';

interface SettingsScreenProps {
  /** Çözülmüş (somut) tema */
  appTheme: AppThemeMode;
  themePreference: ThemePreference;
  onSelectThemePreference: (pref: ThemePreference) => void;
  codeTheme: SyntaxTheme;
  onSelectCodeTheme: (theme: SyntaxTheme) => void;
  languagePref: LanguagePref;
  onSelectLanguage: (pref: LanguagePref) => void;
  appLockEnabled: boolean;
  /** Başarılıysa null, değilse kullanıcıya gösterilecek hata metni döner. */
  onToggleAppLock: (enabled: boolean) => Promise<string | null>;
}

interface ThemeCard {
  id: ThemePreference;
  name: string;
  desc: string;
  icon: string;
}

// Modül düzeyinde: her render'da yeniden oluşturulmaz.
const buildThemeCards = (): readonly ThemeCard[] => [
  { id: 'system', get name() { return t('settings.themeSystem'); }, get desc() { return t('settings.themeSystemDesc'); }, icon: 'phone-portrait' },
  ...THEME_OPTIONS,
];
/** Dil adları kendi dillerinde yazılır; yalnız "sistem" seçeneği çevrilir. */
const LANGUAGE_CHOICES = (): { id: LanguagePref; label: string }[] => [
  { id: 'system', label: t('settings.langSystem') },
  { id: 'tr', label: 'Türkçe' },
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' },
];
const CODE_THEME_ENTRIES = (Object.keys(SYNTAX_THEMES) as SyntaxTheme[]).map(key => ({ key, def: SYNTAX_THEMES[key] }));

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  appTheme,
  themePreference,
  onSelectThemePreference,
  codeTheme,
  onSelectCodeTheme,
  languagePref,
  onSelectLanguage,
  appLockEnabled,
  onToggleAppLock,
}) => {
  const currentColors = Colors[appTheme] || Colors.emerald;
  const [lockInfo, setLockInfo] = useState<LockAvailability | null>(null);
  const [lockBusy, setLockBusy] = useState(false);
  const [storageBusy, setStorageBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [pdfEngine, setPdfEngine] = useState<PdfEngine>('advanced');
  useEffect(() => {
    let alive = true;
    loadPdfEngine().then((e) => { if (alive) setPdfEngine(e); });
    return () => { alive = false; };
  }, []);
  const choosePdfEngine = async (e: PdfEngine) => {
    setPdfEngine(e);
    if (!(await savePdfEngine(e))) Alert.alert(t('settings.saveFailTitle'), t('settings.pdfEngineSaveFail'));
  };

  const handleCheckUpdate = async () => {
    if (updateBusy) return;
    setUpdateBusy(true);
    try {
      // 1) APK gerektirmeyen kod güncellemesi (varsa indirilir, yeniden başlatınca uygulanır)
      const code = await fetchCodeUpdate();
      if (code === 'ready') {
        Alert.alert(t('settings.updateReadyTitle'), t('settings.updateReadyBody'), [
          { text: t('common.later'), style: 'cancel' },
          { text: t('common.restart'), onPress: () => { void restartApp(); } },
        ]);
        return;
      }
      // 2) Yeni APK (yerel değişiklik) var mı?
      const result = await checkForUpdate();
      if (result.status === 'available') {
        Alert.alert(t('settings.updateAvailableTitle'), formatUpdateMessage(result), [
          { text: t('common.later'), style: 'cancel' },
          { text: t('common.update'), onPress: () => { void openUpdate(result); } },
        ]);
      } else if (result.status === 'latest') {
        Alert.alert(t('settings.upToDateTitle'), t('settings.upToDateBody', { version: result.current }));
      } else {
        Alert.alert(t('settings.checkFailTitle'), result.message);
      }
    } finally {
      setUpdateBusy(false);
    }
  };

  useEffect(() => {
    let alive = true;
    getLockAvailability().then(info => { if (alive) setLockInfo(info); });
    return () => { alive = false; };
  }, []);

  const handleToggleLock = async (next: boolean) => {
    if (lockBusy) return;
    setLockBusy(true);
    try {
      const err = await onToggleAppLock(next);
      if (err) Alert.alert(next ? t('settings.lockOnFail') : t('settings.lockOffFail'), err);
    } finally {
      setLockBusy(false);
    }
  };

  const handleClearCache = () => {
    Alert.alert(
      t('settings.clearCache'),
      t('settings.clearCacheConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.clear'),
          style: 'destructive',
          onPress: async () => {
            setStorageBusy(true);
            try {
              await FileService.clearManagedCache({ keepFavorites: true });
              Alert.alert(t('common.done'), t('settings.cacheCleared'));
            } catch {
              Alert.alert(t('common.error'), t('settings.cacheClearFail'));
            } finally {
              setStorageBusy(false);
            }
          },
        },
      ]
    );
  };

  const runClearHistory = async (keepFavorites: boolean) => {
    setStorageBusy(true);
    try {
      const removed = await FileService.clearRecentFiles({ keepFavorites });
      Alert.alert(t('common.done'), removed > 0 ? t('settings.historyRemoved', { count: removed }) : t('settings.historyNothing'));
    } catch {
      Alert.alert(t('common.error'), t('settings.historyClearFail'));
    } finally {
      setStorageBusy(false);
    }
  };

  const handleClearHistory = () => {
    Alert.alert(
      t('settings.clearHistory'),
      t('settings.clearHistoryConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.deleteExceptFavs'), style: 'destructive', onPress: () => void runClearHistory(true) },
        { text: t('settings.deleteInclFavs'), style: 'destructive', onPress: () => void runClearHistory(false) },
      ]
    );
  };

  const lockUnavailable = !!lockInfo && !lockInfo.available;
  const lockSwitchDisabled = lockBusy || !lockInfo || (lockUnavailable && !appLockEnabled);

  return (
    <View style={[styles.container, { backgroundColor: currentColors.background }]}>
      <View style={[styles.header, { backgroundColor: currentColors.surface, borderBottomColor: currentColors.border }]}>
        <Text style={[styles.headerTitle, { color: currentColors.text }]} accessibilityRole="header">{t('common.settings')}</Text>
        <Text style={[styles.headerSub, { color: currentColors.textSecondary }]}>{t('settings.headerSub')}</Text>
      </View>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionTitle, { color: currentColors.primary }]}>{t('settings.sectionAppearance')}</Text>
        <View style={styles.themeGrid}>
          {buildThemeCards().map(tc => {
            const isSelected = themePreference === tc.id;
            return (
              <TouchableOpacity
                key={tc.id}
                style={[
                  styles.themeCard,
                  {
                    backgroundColor: isSelected ? currentColors.primaryGlow : currentColors.card,
                    borderColor: isSelected ? currentColors.primary : currentColors.cardBorder,
                  },
                ]}
                onPress={() => onSelectThemePreference(tc.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={t('settings.themeA11y', { name: tc.name, desc: tc.desc })}
              >
                <View style={styles.themeCardTop}>
                  <Ionicons
                    name={tc.icon as React.ComponentProps<typeof Ionicons>['name']}
                    size={20}
                    color={isSelected ? currentColors.primary : currentColors.textSecondary}
                  />
                  {isSelected && <Ionicons name="checkmark-circle" size={18} color={currentColors.primary} />}
                </View>
                <Text style={[styles.themeCardName, { color: isSelected ? currentColors.primary : currentColors.text }]}>
                  {tc.name}
                </Text>
                <Text style={[styles.themeCardDesc, { color: currentColors.textSecondary }]}>{tc.desc}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: currentColors.primary, marginTop: 20 }]}>{t('settings.sectionLanguage')}</Text>
        <View style={[styles.cardGroup, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}>
          {LANGUAGE_CHOICES().map((opt, idx) => {
            const isSelected = languagePref === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.codeThemeRow, idx > 0 && { borderTopWidth: 1, borderTopColor: currentColors.border }]}
                onPress={() => onSelectLanguage(opt.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={opt.label}
              >
                <View style={styles.codeThemeLeft}>
                  <Ionicons name={isSelected ? 'radio-button-on' : 'radio-button-off'} size={20} color={isSelected ? currentColors.primary : currentColors.textMuted} />
                  <Text style={[styles.codeThemeName, { color: isSelected ? currentColors.primary : currentColors.text }]}>{opt.label}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: currentColors.primary, marginTop: 20 }]}>{t('settings.sectionCodeTheme')}</Text>
        <View style={[styles.cardGroup, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}>
          {CODE_THEME_ENTRIES.map(({ key, def }, idx) => {
            const isSelected = codeTheme === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.codeThemeRow, idx > 0 && { borderTopWidth: 1, borderTopColor: currentColors.border }]}
                onPress={() => onSelectCodeTheme(key)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={t('settings.codeThemeA11y', { name: def.name })}
              >
                <View style={styles.codeThemeLeft}>
                  <View style={[styles.colorDot, { backgroundColor: def.colors.keyword || currentColors.primary }]} />
                  <Text style={[styles.codeThemeName, { color: isSelected ? currentColors.primary : currentColors.text }]}>
                    {def.name}
                  </Text>
                </View>
                {isSelected && <Ionicons name="checkmark" size={20} color={currentColors.primary} />}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: currentColors.primary, marginTop: 20 }]}>{t('settings.sectionSecurity')}</Text>
        <View style={[styles.cardGroup, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}>
          <View style={styles.infoRow}>
            <View style={styles.infoLeft}>
              <Ionicons name="lock-closed-outline" size={20} color={currentColors.primary} />
              <View style={styles.infoTextWrap}>
                <Text style={[styles.infoTitle, { color: currentColors.text }]}>{t('settings.appLock')}</Text>
                <Text style={[styles.infoSub, { color: currentColors.textSecondary }]}>
                  {lockInfo
                    ? t('settings.appLockDesc', { description: lockInfo.description })
                    : t('settings.lockChecking')}
                </Text>
              </View>
            </View>
            <Switch
              value={appLockEnabled}
              onValueChange={handleToggleLock}
              disabled={lockSwitchDisabled}
              trackColor={{ false: currentColors.border, true: currentColors.primary }}
              thumbColor="#FFFFFF"
              accessibilityRole="switch"
              accessibilityLabel={t('settings.appLock')}
              accessibilityState={{ checked: appLockEnabled, disabled: lockSwitchDisabled }}
            />
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: currentColors.primary, marginTop: 20 }]}>{t('settings.sectionPdf')}</Text>
        <View style={[styles.cardGroup, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}>
          {([
            { id: 'advanced' as PdfEngine, title: t('settings.pdfAdvancedTitle'), sub: t('settings.pdfAdvancedSub') },
            { id: 'fast' as PdfEngine, title: t('settings.pdfFastTitle'), sub: t('settings.pdfFastSub') },
          ]).map((opt, i) => {
            const selected = pdfEngine === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.actionRow, i > 0 && { borderTopWidth: 1, borderTopColor: currentColors.border }]}
                onPress={() => { void choosePdfEngine(opt.id); }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={opt.title}
              >
                <View style={styles.infoLeft}>
                  <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? currentColors.primary : currentColors.textMuted} />
                  <View style={styles.infoTextWrap}>
                    <Text style={[styles.infoTitle, { color: currentColors.text }]}>{opt.title}</Text>
                    <Text style={[styles.infoSub, { color: currentColors.textSecondary }]}>{opt.sub}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: currentColors.primary, marginTop: 20 }]}>{t('settings.sectionFiles')}</Text>
        <View style={[styles.cardGroup, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}>
          <View style={styles.infoRow}>
            <View style={styles.infoLeft}>
              <MaterialCommunityIcons name="folder-open-outline" size={20} color={currentColors.primary} />
              <View style={styles.infoTextWrap}>
                <Text style={[styles.infoTitle, { color: currentColors.text }]}>{t('settings.filePicker')}</Text>
                <Text style={[styles.infoSub, { color: currentColors.textSecondary }]}>
                  {t('settings.filePickerDesc')}
                </Text>
              </View>
            </View>
          </View>
          <View style={[styles.infoRow, { borderTopWidth: 1, borderTopColor: currentColors.border }]}>
            <View style={styles.infoLeft}>
              <MaterialCommunityIcons name="open-in-app" size={20} color={currentColors.primary} />
              <View style={styles.infoTextWrap}>
                <Text style={[styles.infoTitle, { color: currentColors.text }]}>{t('settings.openWith')}</Text>
                <Text style={[styles.infoSub, { color: currentColors.textSecondary }]}>
                  {t('settings.openWithDesc')}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: currentColors.primary, marginTop: 20 }]}>{t('settings.sectionStorage')}</Text>
        <View style={[styles.cardGroup, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleClearCache}
            disabled={storageBusy}
            accessibilityRole="button"
            accessibilityState={{ disabled: storageBusy }}
            accessibilityLabel={t('settings.clearCacheA11y')}
          >
            <View style={styles.infoLeft}>
              <Ionicons name="trash-bin-outline" size={20} color={currentColors.danger} />
              <View style={styles.infoTextWrap}>
                <Text style={[styles.infoTitle, { color: currentColors.text }]}>{t('settings.clearCache')}</Text>
                <Text style={[styles.infoSub, { color: currentColors.textSecondary }]}>
                  {t('settings.clearCacheHint')}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={currentColors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionRow, { borderTopWidth: 1, borderTopColor: currentColors.border }]}
            onPress={handleClearHistory}
            disabled={storageBusy}
            accessibilityRole="button"
            accessibilityState={{ disabled: storageBusy }}
            accessibilityLabel={t('settings.clearHistoryA11y')}
          >
            <View style={styles.infoLeft}>
              <Ionicons name="time-outline" size={20} color={currentColors.danger} />
              <View style={styles.infoTextWrap}>
                <Text style={[styles.infoTitle, { color: currentColors.text }]}>{t('settings.clearHistory')}</Text>
                <Text style={[styles.infoSub, { color: currentColors.textSecondary }]}>
                  {t('settings.clearHistoryHint')}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={currentColors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionTitle, { color: currentColors.primary, marginTop: 20 }]}>{t('settings.sectionUpdate')}</Text>
        <View style={[styles.cardGroup, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleCheckUpdate}
            disabled={updateBusy}
            accessibilityRole="button"
            accessibilityState={{ disabled: updateBusy, busy: updateBusy }}
            accessibilityLabel={t('settings.checkUpdates')}
          >
            <View style={styles.infoLeft}>
              <Ionicons name="cloud-download-outline" size={20} color={currentColors.primary} />
              <View style={styles.infoTextWrap}>
                <Text style={[styles.infoTitle, { color: currentColors.text }]}>
                  {updateBusy ? t('settings.checking') : t('settings.checkUpdates')}
                </Text>
                <Text style={[styles.infoSub, { color: currentColors.textSecondary }]}>
                  {t('settings.updateInfo', { version: getAppVersion() })}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={currentColors.textMuted} />
          </TouchableOpacity>
        </View>

        <AboutSection appTheme={appTheme} />
        <View style={{ height: 50 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14, borderBottomWidth: 1 },
  headerTitle: { fontSize: 20, fontWeight: '800', letterSpacing: 0.3 },
  headerSub: { fontSize: 13, marginTop: 2 },
  body: { flex: 1 },
  sectionTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 1.2, paddingHorizontal: 18, marginTop: 16, marginBottom: 12 },
  themeGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 14, gap: 10 },
  themeCard: { width: '47%', minHeight: 44, padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 4 },
  themeCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  themeCardName: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  themeCardDesc: { fontSize: 11, lineHeight: 16 },
  cardGroup: { marginHorizontal: 16, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  codeThemeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, padding: 14 },
  codeThemeLeft: { flexDirection: 'row', alignItems: 'center' },
  colorDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  codeThemeName: { fontSize: 14, fontWeight: '600' },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, padding: 14 },
  infoLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  infoTextWrap: { flex: 1, marginLeft: 12, marginRight: 8 },
  infoTitle: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  infoSub: { fontSize: 11, lineHeight: 16 },
  aboutBox: { alignItems: 'center', marginTop: 40, marginBottom: 20 },
  aboutLogoSquircle: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#1E4D40', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  aboutLogoText: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', fontStyle: 'italic' },
  brandName: { fontSize: 16, fontWeight: '800', letterSpacing: 1 },
  brandVersion: { fontSize: 12, marginTop: 4 },
  copyright: { fontSize: 10, marginTop: 6 },
});
