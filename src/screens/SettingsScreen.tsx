import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Switch } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { SYNTAX_THEMES } from '../theme/syntaxThemes';
import { THEME_OPTIONS } from '../theme/themeOptions';
import { FileService } from '../services/fileService';
import { checkForUpdate, openUpdate, formatUpdateMessage, fetchCodeUpdate, restartApp } from '../services/updateService';
import { getLockAvailability, LockAvailability } from '../services/appLock';
import { APP_DISPLAY_NAME, getAppVersion } from '../utils/appInfo';
import { AppThemeMode, SyntaxTheme, ThemePreference } from '../types';

interface SettingsScreenProps {
  /** Çözülmüş (somut) tema */
  appTheme: AppThemeMode;
  themePreference: ThemePreference;
  onSelectThemePreference: (pref: ThemePreference) => void;
  codeTheme: SyntaxTheme;
  onSelectCodeTheme: (theme: SyntaxTheme) => void;
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
const THEME_CARDS: readonly ThemeCard[] = [
  { id: 'system', name: 'Sistem', desc: 'Cihazın açık/koyu ayarını izler', icon: 'phone-portrait' },
  ...THEME_OPTIONS,
];
const CODE_THEME_ENTRIES = (Object.keys(SYNTAX_THEMES) as SyntaxTheme[]).map(key => ({ key, def: SYNTAX_THEMES[key] }));

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  appTheme,
  themePreference,
  onSelectThemePreference,
  codeTheme,
  onSelectCodeTheme,
  appLockEnabled,
  onToggleAppLock,
}) => {
  const currentColors = Colors[appTheme] || Colors.emerald;
  const [lockInfo, setLockInfo] = useState<LockAvailability | null>(null);
  const [lockBusy, setLockBusy] = useState(false);
  const [storageBusy, setStorageBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);

  const handleCheckUpdate = async () => {
    if (updateBusy) return;
    setUpdateBusy(true);
    try {
      // 1) APK gerektirmeyen kod güncellemesi (varsa indirilir, yeniden başlatınca uygulanır)
      const code = await fetchCodeUpdate();
      if (code === 'ready') {
        Alert.alert('Güncelleme hazır', 'Yeni sürüm indirildi. Uygulamayı yeniden başlatarak uygulayabilirsiniz.', [
          { text: 'Sonra', style: 'cancel' },
          { text: 'Yeniden başlat', onPress: () => { void restartApp(); } },
        ]);
        return;
      }
      // 2) Yeni APK (yerel değişiklik) var mı?
      const result = await checkForUpdate();
      if (result.status === 'available') {
        Alert.alert('Güncelleme mevcut', formatUpdateMessage(result), [
          { text: 'Sonra', style: 'cancel' },
          { text: 'Güncelle', onPress: () => { void openUpdate(result); } },
        ]);
      } else if (result.status === 'latest') {
        Alert.alert('Güncel', `En son sürümü kullanıyorsunuz (${result.current}).`);
      } else {
        Alert.alert('Denetlenemedi', result.message);
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
      if (err) Alert.alert(next ? 'Kilit açılamadı' : 'Kilit kapatılamadı', err);
    } finally {
      setLockBusy(false);
    }
  };

  const handleClearCache = () => {
    Alert.alert(
      'Önbelleği temizle',
      'Uygulamanın içe aktardığı belge kopyaları ve arşivden çıkarılan geçici dosyalar silinir. Kopyası silinen dosyalar "Son dosyalar" listesinden de çıkar; favoriler korunur. Orijinal dosyalarınıza dokunulmaz.',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Temizle',
          style: 'destructive',
          onPress: async () => {
            setStorageBusy(true);
            try {
              await FileService.clearManagedCache({ keepFavorites: true });
              Alert.alert('Tamamlandı', 'Önbellek temizlendi. Favoriler korundu.');
            } catch {
              Alert.alert('Hata', 'Önbellek temizlenemedi. Lütfen tekrar deneyin.');
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
      Alert.alert('Tamamlandı', removed > 0 ? `${removed} kayıt silindi.` : 'Silinecek kayıt yoktu.');
    } catch {
      Alert.alert('Hata', 'Geçmiş silinemedi. Lütfen tekrar deneyin.');
    } finally {
      setStorageBusy(false);
    }
  };

  const handleClearHistory = () => {
    Alert.alert(
      'Geçmişi sil',
      '"Son dosyalar" listesi ve bu kayıtların uygulama içindeki kopyaları silinir. Orijinal dosyalarınıza dokunulmaz.',
      [
        { text: 'İptal', style: 'cancel' },
        { text: 'Favoriler hariç sil', style: 'destructive', onPress: () => void runClearHistory(true) },
        { text: 'Favoriler dahil sil', style: 'destructive', onPress: () => void runClearHistory(false) },
      ]
    );
  };

  const lockUnavailable = !!lockInfo && !lockInfo.available;
  const lockSwitchDisabled = lockBusy || !lockInfo || (lockUnavailable && !appLockEnabled);

  return (
    <View style={[styles.container, { backgroundColor: currentColors.background }]}>
      <View style={[styles.header, { backgroundColor: currentColors.surface, borderBottomColor: currentColors.border }]}>
        <Text style={[styles.headerTitle, { color: currentColors.text }]} accessibilityRole="header">Ayarlar</Text>
        <Text style={[styles.headerSub, { color: currentColors.textSecondary }]}>Görünüm, güvenlik ve depolama</Text>
      </View>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionTitle, { color: currentColors.primary }]}>UYGULAMA GÖRÜNÜMÜ</Text>
        <View style={styles.themeGrid}>
          {THEME_CARDS.map(t => {
            const isSelected = themePreference === t.id;
            return (
              <TouchableOpacity
                key={t.id}
                style={[
                  styles.themeCard,
                  {
                    backgroundColor: isSelected ? currentColors.primaryGlow : currentColors.card,
                    borderColor: isSelected ? currentColors.primary : currentColors.cardBorder,
                  },
                ]}
                onPress={() => onSelectThemePreference(t.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${t.name} teması. ${t.desc}`}
              >
                <View style={styles.themeCardTop}>
                  <Ionicons
                    name={t.icon as React.ComponentProps<typeof Ionicons>['name']}
                    size={20}
                    color={isSelected ? currentColors.primary : currentColors.textSecondary}
                  />
                  {isSelected && <Ionicons name="checkmark-circle" size={18} color={currentColors.primary} />}
                </View>
                <Text style={[styles.themeCardName, { color: isSelected ? currentColors.primary : currentColors.text }]}>
                  {t.name}
                </Text>
                <Text style={[styles.themeCardDesc, { color: currentColors.textSecondary }]}>{t.desc}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: currentColors.primary, marginTop: 20 }]}>VARSAYILAN KOD TEMASI</Text>
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
                accessibilityLabel={`Kod teması: ${def.name}`}
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

        <Text style={[styles.sectionTitle, { color: currentColors.primary, marginTop: 20 }]}>GÜVENLİK</Text>
        <View style={[styles.cardGroup, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}>
          <View style={styles.infoRow}>
            <View style={styles.infoLeft}>
              <Ionicons name="lock-closed-outline" size={20} color={currentColors.primary} />
              <View style={styles.infoTextWrap}>
                <Text style={[styles.infoTitle, { color: currentColors.text }]}>Uygulama kilidi</Text>
                <Text style={[styles.infoSub, { color: currentColors.textSecondary }]}>
                  {lockInfo
                    ? `${lockInfo.description} Uygulama açılırken ve 30 saniyeden uzun arka planda kalınca sorulur.`
                    : 'Cihaz desteği denetleniyor...'}
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
              accessibilityLabel="Uygulama kilidi"
              accessibilityState={{ checked: appLockEnabled, disabled: lockSwitchDisabled }}
            />
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: currentColors.primary, marginTop: 20 }]}>DOSYA ERİŞİMİ</Text>
        <View style={[styles.cardGroup, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}>
          <View style={styles.infoRow}>
            <View style={styles.infoLeft}>
              <MaterialCommunityIcons name="folder-open-outline" size={20} color={currentColors.primary} />
              <View style={styles.infoTextWrap}>
                <Text style={[styles.infoTitle, { color: currentColors.text }]}>Dosya seçici</Text>
                <Text style={[styles.infoSub, { color: currentColors.textSecondary }]}>
                  Dosyalar sistemin dosya seçicisiyle açılır; uygulama yalnızca seçtiğiniz dosyaya erişir ve bir kopyasını uygulama içinde tutar.
                </Text>
              </View>
            </View>
          </View>
          <View style={[styles.infoRow, { borderTopWidth: 1, borderTopColor: currentColors.border }]}>
            <View style={styles.infoLeft}>
              <MaterialCommunityIcons name="open-in-app" size={20} color={currentColors.primary} />
              <View style={styles.infoTextWrap}>
                <Text style={[styles.infoTitle, { color: currentColors.text }]}>"Birlikte aç"</Text>
                <Text style={[styles.infoSub, { color: currentColors.textSecondary }]}>
                  Dosya yöneticisi veya başka bir uygulamadaki "Birlikte aç / Paylaş" menüsünden T-Desk seçilebilir (desteklenen türler cihaza göre değişebilir).
                </Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: currentColors.primary, marginTop: 20 }]}>DEPOLAMA & BAKIM</Text>
        <View style={[styles.cardGroup, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleClearCache}
            disabled={storageBusy}
            accessibilityRole="button"
            accessibilityState={{ disabled: storageBusy }}
            accessibilityLabel="Önbelleği temizle. İçe aktarılan belge kopyalarını siler, favoriler korunur."
          >
            <View style={styles.infoLeft}>
              <Ionicons name="trash-bin-outline" size={20} color={currentColors.danger} />
              <View style={styles.infoTextWrap}>
                <Text style={[styles.infoTitle, { color: currentColors.text }]}>Önbelleği temizle</Text>
                <Text style={[styles.infoSub, { color: currentColors.textSecondary }]}>
                  Uygulama içindeki belge kopyalarını siler (favoriler korunur)
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
            accessibilityLabel="Geçmişi sil. Son dosyalar listesini temizler."
          >
            <View style={styles.infoLeft}>
              <Ionicons name="time-outline" size={20} color={currentColors.danger} />
              <View style={styles.infoTextWrap}>
                <Text style={[styles.infoTitle, { color: currentColors.text }]}>Geçmişi sil</Text>
                <Text style={[styles.infoSub, { color: currentColors.textSecondary }]}>
                  "Son dosyalar" listesini ve kayıtlı kopyalarını temizler
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={currentColors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionTitle, { color: currentColors.primary, marginTop: 20 }]}>GÜNCELLEME</Text>
        <View style={[styles.cardGroup, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleCheckUpdate}
            disabled={updateBusy}
            accessibilityRole="button"
            accessibilityState={{ disabled: updateBusy, busy: updateBusy }}
            accessibilityLabel="Güncellemeleri denetle"
          >
            <View style={styles.infoLeft}>
              <Ionicons name="cloud-download-outline" size={20} color={currentColors.primary} />
              <View style={styles.infoTextWrap}>
                <Text style={[styles.infoTitle, { color: currentColors.text }]}>
                  {updateBusy ? 'Denetleniyor…' : 'Güncellemeleri denetle'}
                </Text>
                <Text style={[styles.infoSub, { color: currentColors.textSecondary }]}>
                  Mevcut sürüm {getAppVersion()}. Yeni sürümler GitHub yayınlarından alınır; uygulama açılışında günde bir kez de denetlenir.
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={currentColors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.aboutBox} accessible accessibilityLabel={`${APP_DISPLAY_NAME}, sürüm ${getAppVersion()}`}>
          <View style={styles.aboutLogoSquircle}>
            <Text style={styles.aboutLogoText}>T/</Text>
          </View>
          <Text style={[styles.brandName, { color: currentColors.primary }]}>{APP_DISPLAY_NAME}</Text>
          <Text style={[styles.brandVersion, { color: currentColors.textSecondary }]}>Sürüm {getAppVersion()}</Text>
          <Text style={[styles.copyright, { color: currentColors.textSecondary }]}>© 2026 T-Desk. Tüm hakları saklıdır.</Text>
        </View>
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
