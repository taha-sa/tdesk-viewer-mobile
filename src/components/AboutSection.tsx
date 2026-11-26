import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Switch, Linking, Alert, Platform, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import { APP_DISPLAY_NAME, getAppVersion } from '../utils/appInfo';
import { isBridgeInstalled } from '../services/bridgeService';
import { buildManualRecord, getAutoReportSync, loadAutoReport, setAutoReport } from '../services/crashService';
import { CrashReportSheet } from './CrashReportSheet';
import { LegalKind, LegalModal } from './LegalModal';
import { CrashRecord } from '../utils/crashReport';
import { t } from '../i18n';

const ICONS = {
  viewer: require('../../assets/family/t-desk-viewer.png'),
  bridge: require('../../assets/family/t-bridge.png'),
  downloader: require('../../assets/family/t-downloader.png'),
  ramcash: require('../../assets/family/t-ramcash.png'),
  desktree: require('../../assets/family/t-desktree.png'),
} as const;

const releasesUrl = (id: string) => `https://github.com/taha-sa/${id}-releases/releases/latest`;

const PC_APPS = [
  { id: 't-downloader', name: 'T-Downloader', icon: ICONS.downloader },
  { id: 't-ramcash', name: 'T-RamCash', icon: ICONS.ramcash },
  { id: 't-desktree', name: 'T-DeskTree', icon: ICONS.desktree },
] as const;

function otaId(): string | null {
  try {
    return Updates.updateId ?? null;
  } catch {
    return null;
  }
}

interface Props {
  appTheme: AppThemeMode;
}

interface AboutRowProps {
  colors: (typeof Colors)['dark'];
  icon: string;
  title: string;
  sub?: string;
  onPress: () => void;
  a11y?: string;
  first?: boolean;
}

const AboutRow: React.FC<AboutRowProps> = ({ colors: c, icon, title, sub, onPress, a11y, first }) => (
  <TouchableOpacity
    style={[styles.row, !first && { borderTopWidth: 1, borderTopColor: c.border }]}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={a11y || title}
  >
    <Ionicons name={icon as never} size={20} color={c.primary} />
    <View style={styles.flex}>
      <Text style={[styles.title, { color: c.text }]}>{title}</Text>
      {sub ? <Text style={[styles.sub, { color: c.textSecondary }]}>{sub}</Text> : null}
    </View>
    <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
  </TouchableOpacity>
);

/** Ayarlar > Hakkında: sürüm/OTA, T-Suite ailesi, hata raporu, yasal metinler. */
export const AboutSection: React.FC<Props> = ({ appTheme }) => {
  const c = Colors[appTheme] || Colors.dark;
  const [auto, setAuto] = useState(getAutoReportSync());
  const [report, setReport] = useState<CrashRecord | null>(null);
  const [legal, setLegal] = useState<LegalKind | null>(null);
  const [bridgeInstalled, setBridgeInstalled] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadAutoReport().then(v => { if (alive) setAuto(v); });
    const refresh = () => { try { setBridgeInstalled(isBridgeInstalled()); } catch { setBridgeInstalled(false); } };
    refresh();
    const listener = AppState.addEventListener('change', state => { if (state === 'active' && alive) refresh(); });
    return () => { alive = false; listener.remove(); };
  }, []);

  const open = async (url: string, what: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('about.openFailTitle'), t('about.openFailBody', { what }));
    }
  };
  const toggleAuto = (v: boolean) => {
    setAuto(v);
    void setAutoReport(v);
  };

  const ota = otaId();
  const card = { backgroundColor: c.card, borderColor: c.cardBorder };
  const divider = { borderTopWidth: 1, borderTopColor: c.border };

  return (
    <View>
      <View style={styles.brand} accessible accessibilityLabel={t('settings.aboutA11y', { app: APP_DISPLAY_NAME, version: getAppVersion() })}>
        <Image source={ICONS.viewer} style={styles.brandIcon} accessibilityIgnoresInvertColors />
        <Text style={[styles.brandName, { color: c.text }]}>{APP_DISPLAY_NAME}</Text>
        <Text style={[styles.brandVersion, { color: c.primary }]}>{t('settings.version', { version: getAppVersion() })}</Text>
        <Text style={[styles.brandSub, { color: c.textSecondary }]} selectable>
          {ota ? t('aboutApp.otaUpdate', { id: ota }) : t('aboutApp.otaEmbedded')}
        </Text>
        <Text style={[styles.brandSub, { color: c.textSecondary }]}>{t('settings.copyright')}</Text>
      </View>

      <Text style={[styles.section, { color: c.primary }]}>{t('aboutApp.familyTitle')}</Text>
      <View style={[styles.group, card]}>
        <Text style={[styles.desc, { color: c.textSecondary }]}>{t('aboutApp.familyDesc')}</Text>
        <View style={[styles.row, divider]}>
          <Image source={ICONS.viewer} style={styles.famIcon} accessibilityIgnoresInvertColors />
          <View style={styles.flex}>
            <Text style={[styles.title, { color: c.text }]}>{APP_DISPLAY_NAME}</Text>
            <Text style={[styles.sub, { color: c.textSecondary }]}>{t('aboutApp.forPhone')}</Text>
          </View>
          <Text style={[styles.badge, { color: c.primary }]}>{t('aboutApp.thisApp')}</Text>
        </View>
        {Platform.OS === 'android' && (
          bridgeInstalled ? (
            <View style={[styles.row, divider]} accessible accessibilityLabel={`T-Bridge, ${t('aboutApp.forPhone')}, ${t('aboutApp.installed')}`}>
              <Image source={ICONS.bridge} style={styles.famIcon} accessibilityIgnoresInvertColors />
              <View style={styles.flex}>
                <Text style={[styles.title, { color: c.text }]}>T-Bridge</Text>
                <Text style={[styles.sub, { color: c.textSecondary }]}>{t('aboutApp.forPhone')}</Text>
              </View>
              <Text style={[styles.badge, { color: c.success }]}>{t('aboutApp.installed')}</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.row, divider]}
              onPress={() => open(releasesUrl('t-bridge'), 'T-Bridge')}
              accessibilityRole="link"
              accessibilityLabel={t('aboutApp.getAppA11y', { app: 'T-Bridge' })}
            >
              <Image source={ICONS.bridge} style={styles.famIcon} accessibilityIgnoresInvertColors />
              <View style={styles.flex}>
                <Text style={[styles.title, { color: c.text }]}>T-Bridge</Text>
                <Text style={[styles.sub, { color: c.primary }]}>{t('aboutApp.getApp', { app: 'T-Bridge' })}</Text>
              </View>
              <Ionicons name="open-outline" size={18} color={c.textMuted} />
            </TouchableOpacity>
          )
        )}
        {PC_APPS.map(app => (
          <TouchableOpacity
            key={app.id}
            style={[styles.row, divider]}
            onPress={() => open(releasesUrl(app.id), app.name)}
            accessibilityRole="link"
            accessibilityLabel={t('aboutApp.pcLinkA11y', { app: app.name })}
          >
            <Image source={app.icon} style={styles.famIcon} accessibilityIgnoresInvertColors />
            <View style={styles.flex}>
              <Text style={[styles.title, { color: c.text }]}>{app.name}</Text>
              <Text style={[styles.sub, { color: c.textSecondary }]}>{t('aboutApp.forPc')}</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={c.textMuted} />
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[styles.section, { color: c.primary }]}>{t('aboutApp.sectionTitle')}</Text>
      <View style={[styles.group, card]}>
        <View style={styles.row}>
          <Ionicons name="shield-checkmark-outline" size={20} color={c.primary} />
          <View style={styles.flex}>
            <Text style={[styles.title, { color: c.text }]}>{t('crash.autoTitle')}</Text>
            <Text style={[styles.sub, { color: c.textSecondary }]}>{t('crash.autoDesc')}</Text>
          </View>
          <Switch
            value={auto}
            onValueChange={toggleAuto}
            trackColor={{ false: c.border, true: c.primary }}
            thumbColor="#FFFFFF"
            accessibilityRole="switch"
            accessibilityLabel={t('crash.autoTitle')}
            accessibilityState={{ checked: auto }}
          />
        </View>
        <AboutRow
          colors={c}
          icon="bug-outline"
          title={t('aboutApp.reportBug')}
          sub={t('aboutApp.reportBugHint')}
          onPress={() => setReport(buildManualRecord())}
        />
      </View>

      <Text style={[styles.section, { color: c.primary }]}>{t('aboutApp.sectionLegal')}</Text>
      <View style={[styles.group, card]}>
        <AboutRow colors={c} first icon="document-text-outline" title={t('aboutApp.privacy')} onPress={() => setLegal('privacy')} />
        <AboutRow colors={c} icon="ribbon-outline" title={t('aboutApp.license')} onPress={() => setLegal('license')} />
        <AboutRow colors={c} icon="code-slash-outline" title={t('aboutApp.oss')} onPress={() => setLegal('oss')} />
        <AboutRow colors={c} icon="information-circle-outline" title={t('aboutApp.disclaimer')} onPress={() => setLegal('disclaimer')} />
      </View>

      <CrashReportSheet record={report} appTheme={appTheme} manual onClose={() => setReport(null)} />
      <LegalModal kind={legal} appTheme={appTheme} onClose={() => setLegal(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  brand: { alignItems: 'center', marginTop: 32, marginBottom: 8, gap: 2 },
  brandIcon: { width: 72, height: 72, borderRadius: 16, marginBottom: 8 },
  brandName: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  brandVersion: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  brandSub: { fontSize: 11, lineHeight: 15, textAlign: 'center' },
  section: { fontSize: 12, fontWeight: '800', letterSpacing: 1, marginTop: 20, marginBottom: 8, marginLeft: 4 },
  group: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  desc: { fontSize: 12, lineHeight: 17, padding: 16, paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 10 },
  famIcon: { width: 32, height: 32, borderRadius: 8 },
  title: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  sub: { fontSize: 12, lineHeight: 16, marginTop: 1 },
  badge: { fontSize: 12, fontWeight: '700' },
});
