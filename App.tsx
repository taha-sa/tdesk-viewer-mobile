import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  BackHandler,
  Alert,
  StatusBar,
  AppState,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { FileInfo, SyntaxTheme, FileType, ThemePreference } from './src/types';
import { Colors } from './src/theme/colors';
import { resolveTheme, nextTheme } from './src/theme/themeOptions';
import { DEFAULT_SYNTAX_THEME_ID, isSyntaxThemeId } from './src/theme/syntaxThemes';
import { FileService, STORAGE_KEYS } from './src/services/fileService';
import { autoCheckAndPrompt, promptUpdateNow } from './src/services/updateService';
import { authenticate, getLockAvailability, loadLockEnabled, saveLockEnabled } from './src/services/appLock';
import { parseStoredSettings, serializeSettings, shouldRelock, DEFAULT_SETTINGS } from './src/utils/appSettings';

// Screens
import { HomeScreen } from './src/screens/HomeScreen';
import { FileBrowserScreen } from './src/screens/FileBrowserScreen';
import { LanguagePref, resolveLanguage, setActiveLanguage } from './src/i18n';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ViewerScreen } from './src/screens/ViewerScreen';
import { ToolsScreen } from './src/screens/ToolsScreen';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { LockScreen } from './src/components/LockScreen';
import { t } from './src/i18n';
import { CrashReportSheet } from './src/components/CrashReportSheet';
import { installCrashHandlers, loadAutoReport, loadPendingCrash, clearPendingCrash } from './src/services/crashService';
import type { CrashRecord } from './src/utils/crashReport';

installCrashHandlers();

type TabRoute = 'home' | 'browser' | 'tools' | 'settings';

const TAB_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 };

export default function App() {
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  );
}

function AppShell() {
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();

  const [currentTab, setCurrentTab] = useState<TabRoute>('home');
  const [activeFile, setActiveFile] = useState<FileInfo | null>(null);
  // Arşivden açılan sanal dosyalarda "geri" arşive dönsün: üst dosyalar yığını.
  const [fileStack, setFileStack] = useState<FileInfo[]>([]);
  const [browserInitialCategory, setBrowserInitialCategory] = useState<FileType | 'all'>('all');
  const [themePreference, setThemePreference] = useState<ThemePreference>(DEFAULT_SETTINGS.themePreference);
  const [codeTheme, setCodeTheme] = useState<SyntaxTheme>(DEFAULT_SYNTAX_THEME_ID);
  const [languagePref, setLanguagePref] = useState<LanguagePref>(DEFAULT_SETTINGS.language);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // Etkin dili render sırasında, çocuklardan önce ayarla; t() bu değeri okur.
  const activeLang = resolveLanguage(languagePref);
  setActiveLanguage(activeLang);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pendingCrash, setPendingCrash] = useState<CrashRecord | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');

  const appTheme = resolveTheme(themePreference, systemScheme);
  const currentColors = Colors[appTheme] || Colors.emerald;

  const lockEnabledRef = useRef(false);
  const backgroundedAtRef = useRef<number | null>(null);
  useEffect(() => { lockEnabledRef.current = lockEnabled; }, [lockEnabled]);

  // Ayarlar + kilit durumu birlikte yüklenir; yüklenene kadar arayüz çizilmez (tema yanıp sönmesi ve kilitsiz kare yok).
  useEffect(() => {
    let isMounted = true;
    (async () => {
      let raw: string | null = null;
      try {
        raw = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
      } catch (error) {
        if (__DEV__) console.warn('Ayarlar yüklenemedi:', error);
      }
      const lock = await loadLockEnabled();
      if (!isMounted) return;
      const s = parseStoredSettings(raw);
      setThemePreference(s.themePreference);
      setCodeTheme(s.codeTheme);
      setLanguagePref(s.language);
      setLockEnabled(lock);
      setLocked(lock);
      setSettingsLoaded(true);
    })();
    return () => { isMounted = false; };
  }, []);

  // Açılışta sessiz güncelleme denetimi (günde en fazla bir kez; kilit açıkken sorulmaz).
  const updateCheckedRef = useRef(false);
  useEffect(() => {
    if (!settingsLoaded || locked || updateCheckedRef.current) return;
    updateCheckedRef.current = true;
    const t = setTimeout(() => { void autoCheckAndPrompt(); }, 3000);
    return () => clearTimeout(t);
  }, [settingsLoaded, locked]);

  // Önceki oturumdan kalan (maskelenmiş) hata kaydı varsa, kilit açıldıktan sonra önizleme sayfası gösterilir.
  const crashCheckedRef = useRef(false);
  useEffect(() => {
    if (!settingsLoaded || locked || crashCheckedRef.current) return;
    crashCheckedRef.current = true;
    void (async () => {
      if (!(await loadAutoReport())) return;
      const rec = await loadPendingCrash();
      if (rec) setPendingCrash(rec);
    })();
  }, [settingsLoaded, locked]);

  useEffect(() => {
    if (!settingsLoaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, serializeSettings({ themePreference, codeTheme, language: languagePref }))
      .catch(error => { if (__DEV__) console.warn('Ayarlar kaydedilemedi:', error); });
  }, [themePreference, codeTheme, languagePref, settingsLoaded]);

  // Arka plana geçiş/dönüş: kilit etkinse ~30 sn'den uzun kalınmışsa yeniden kilitle.
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      setAppActive(next === 'active');
      if (next === 'background') {
        if (backgroundedAtRef.current === null) backgroundedAtRef.current = Date.now();
      } else if (next === 'active') {
        if (lockEnabledRef.current && shouldRelock(backgroundedAtRef.current, Date.now())) setLocked(true);
        backgroundedAtRef.current = null;
      }
    });
    return () => sub.remove();
  }, []);

  // Android "Birlikte Aç" (Intent / Deep Linking) dinleyicisi.
  // Yalnız file:// ve content:// işlenir (exp:// vb. dev/deep-link URL'leri yok sayılır). Unmount sonrası state yazılmaz.
  useEffect(() => {
    let isMounted = true;

    const openIncoming = async (url: string | null | undefined) => {
      // T-Bridge derin bağlantısı: güncelleme ekranı (Ayarlar + denetim penceresi).
      if (url && /^tdeskviewer:\/\/update\/?(\?.*)?$/i.test(url)) {
        if (isMounted) {
          setFileStack([]);
          setActiveFile(null);
          setCurrentTab('settings');
          void promptUpdateNow();
        }
        return;
      }
      if (!url || !FileService.isSupportedFileUri(url)) return;
      try {
        const file = await FileService.handleIncomingUri(url);
        // ViewerScreen key={file.id} olduğundan yeni dosya eski görüntüleyiciyi zaten yeniden kurar.
        if (file && isMounted) {
          setFileStack([]);
          setActiveFile(file);
        }
      } catch (err) {
        if (__DEV__) console.warn('Gelen URL işlenemedi:', err);
        if (isMounted) Alert.alert(t('app.incomingFailTitle'), t('app.incomingFailBody'));
      }
    };

    Linking.getInitialURL()
      .then(openIncoming)
      .catch(err => { if (__DEV__) console.warn('İlk URL okunamadı:', err); });

    const subscription = Linking.addEventListener('url', event => { void openIncoming(event.url); });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  const handleCloseViewer = useCallback(() => {
    if (fileStack.length > 0) {
      setActiveFile(fileStack[fileStack.length - 1]);
      setFileStack(fileStack.slice(0, -1));
    } else {
      setActiveFile(null);
    }
  }, [fileStack]);

  useEffect(() => {
    const onBackPress = () => {
      if (locked) return false;
      if (activeFile) {
        handleCloseViewer();
        return true;
      }
      if (currentTab !== 'home') {
        setCurrentTab('home');
        return true;
      }
      return false;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [activeFile, currentTab, locked, handleCloseViewer]);

  const handleOpenFile = (file: FileInfo) => {
    if (file.missing) {
      Alert.alert(t('common.fileNotFound'), t('app.fileMissingBody'));
      return;
    }
    // Son dosyalardan açılınca "son açılan" sırası güncellensin (kayıtta yoksa/sanal dosyaysa etkisiz).
    if (!file.virtual) void FileService.touchRecentFile(file.id);
    // Arşivden açılan öğe: üst dosyayı yığına koy (geri → arşiv). Diğer açılışlar yığını sıfırlar.
    if (file.virtual && activeFile) setFileStack(prev => [...prev, activeFile]);
    else setFileStack([]);
    setActiveFile(file);
  };

  const goHome = useCallback(() => {
    setActiveFile(null);
    setFileStack([]);
    setCurrentTab('home');
  }, []);

  const handleNavigateToBrowserWithCategory = (cat?: FileType) => {
    setBrowserInitialCategory(cat || 'all');
    setCurrentTab('browser');
  };

  const handleThemeToggle = () => setThemePreference(nextTheme(appTheme));

  const handleSelectCodeTheme = (t: SyntaxTheme) => {
    if (isSyntaxThemeId(t)) setCodeTheme(t);
  };

  // ----- Uygulama kilidi -----
  const handleUnlock = useCallback(() => setLocked(false), []);

  const handleDisableLockFromLockScreen = useCallback(async () => {
    if (await saveLockEnabled(false)) {
      setLockEnabled(false);
      setLocked(false);
    } else {
      Alert.alert(t('common.error'), t('app.lockSaveFail'));
    }
  }, []);

  /** Başarıda null, aksi halde kullanıcıya gösterilecek hata metni. Açarken/kapatırken kimlik doğrulama istenir. */
  const handleToggleAppLock = useCallback(async (enabled: boolean): Promise<string | null> => {
    const availability = await getLockAvailability();
    if (enabled) {
      if (!availability.available) return availability.description;
      const r = await authenticate(t('app.lockEnablePrompt'));
      if (!r.ok) return r.message || t('lock.authFailed');
    } else if (availability.available) {
      const r = await authenticate(t('app.lockDisablePrompt'));
      if (!r.ok) return r.message || t('lock.authFailed');
    }
    if (!(await saveLockEnabled(enabled))) return t('app.settingSaveFail');
    setLockEnabled(enabled);
    return null;
  }, []);

  const statusBar = (
    <StatusBar
      barStyle={appTheme === 'light' ? 'dark-content' : 'light-content'}
      backgroundColor={currentColors.background}
    />
  );

  if (!settingsLoaded) {
    // Ayar yüklenirken sistem açık/koyu ayarına göre nötr bir zemin (kayıtlı tema bilinmiyor).
    const neutral = systemScheme === 'light' ? Colors.light.background : Colors.emerald.background;
    return <View style={[styles.root, { backgroundColor: neutral }]} />;
  }

  if (locked) {
    return (
      <View style={[styles.root, { backgroundColor: currentColors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {statusBar}
        <LockScreen
          appTheme={appTheme}
          active={appActive}
          onUnlock={handleUnlock}
          onDisableLock={handleDisableLockFromLockScreen}
        />
      </View>
    );
  }

  const showCover = lockEnabled && !appActive;

  const tabs: { id: TabRoute; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; iconOff: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { id: 'home', label: t('tabs.home'), icon: 'home', iconOff: 'home-outline' },
    { id: 'browser', label: t('tabs.files'), icon: 'folder', iconOff: 'folder-outline' },
  ];

  return (
    <View
      key={activeLang}
      style={[
        styles.root,
        {
          backgroundColor: currentColors.background,
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          paddingBottom: activeFile ? insets.bottom : 0,
        },
      ]}
    >
      {statusBar}

      <View style={styles.mainContent}>
        <ErrorBoundary
          resetKey={activeFile ? (activeFile.id || activeFile.uri) : currentTab}
          appTheme={appTheme}
          onBack={goHome}
          backLabel={t('app.backHome')}
          title={t('app.errorTitle')}
          description={t('app.errorBody')}
          logTag="T-DESK-APP-ERROR"
        >
          {activeFile ? (
            <ViewerScreen
              key={activeFile.id || activeFile.uri}
              file={activeFile}
              appTheme={appTheme}
              defaultCodeTheme={codeTheme}
              onBack={handleCloseViewer}
              onOpenFile={handleOpenFile}
            />
          ) : (
            <>
              {currentTab === 'home' && (
                <HomeScreen
                  appTheme={appTheme}
                  onOpenFile={handleOpenFile}
                  onNavigateToBrowser={handleNavigateToBrowserWithCategory}
                  onThemeToggle={handleThemeToggle}
                />
              )}
              {currentTab === 'browser' && (
                <FileBrowserScreen
                  appTheme={appTheme}
                  initialCategory={browserInitialCategory}
                  onOpenFile={handleOpenFile}
                />
              )}
              {currentTab === 'tools' && <ToolsScreen appTheme={appTheme} onOpenFile={handleOpenFile} />}
              {currentTab === 'settings' && (
                <SettingsScreen
                  appTheme={appTheme}
                  themePreference={themePreference}
                  onSelectThemePreference={setThemePreference}
                  codeTheme={codeTheme}
                  onSelectCodeTheme={handleSelectCodeTheme}
                  languagePref={languagePref}
                  onSelectLanguage={setLanguagePref}
                  appLockEnabled={lockEnabled}
                  onToggleAppLock={handleToggleAppLock}
                />
              )}
            </>
          )}
        </ErrorBoundary>
      </View>

      {!activeFile && (
        <View
          accessibilityRole="tablist"
          style={[
            styles.bottomBar,
            {
              backgroundColor: currentColors.tabBar,
              borderTopColor: currentColors.tabBarBorder,
              paddingBottom: insets.bottom,
              height: BAR_HEIGHT + insets.bottom,
            },
          ]}
        >
          {tabs.map(t => {
            const selected = currentTab === t.id;
            return (
              <TouchableOpacity
                key={t.id}
                style={styles.tabButton}
                hitSlop={TAB_HIT_SLOP}
                onPress={() => {
                  if (t.id === 'browser') setBrowserInitialCategory('all');
                  setCurrentTab(t.id);
                }}
                accessibilityRole="tab"
                accessibilityLabel={t.label}
                accessibilityState={{ selected }}
              >
                <Ionicons name={selected ? t.icon : t.iconOff} size={22} color={selected ? currentColors.primary : currentColors.tabInactive} />
              </TouchableOpacity>
            );
          })}

          {/* Araçlar: ortada vurgulu düğme; taşma yok, tüm sütun dokunulabilir */}
          <TouchableOpacity
            style={styles.tabButton}
            onPress={() => setCurrentTab('tools')}
            accessibilityRole="tab"
            accessibilityLabel={t('tabs.tools')}
            accessibilityState={{ selected: currentTab === 'tools' }}
          >
            <View style={[styles.centerTabCircle, { backgroundColor: currentColors.primary, shadowColor: currentColors.primary }]}>
              <Ionicons name="build" size={24} color={currentColors.onPrimary} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.tabButton}
            hitSlop={TAB_HIT_SLOP}
            onPress={() => setCurrentTab('settings')}
            accessibilityRole="tab"
            accessibilityLabel={t('common.settings')}
            accessibilityState={{ selected: currentTab === 'settings' }}
          >
            <Ionicons
              name={currentTab === 'settings' ? 'settings' : 'settings-outline'}
              size={22}
              color={currentTab === 'settings' ? currentColors.primary : currentColors.tabInactive}
            />
          </TouchableOpacity>
        </View>
      )}

      <CrashReportSheet
        record={pendingCrash}
        appTheme={appTheme}
        onClose={() => { setPendingCrash(null); void clearPendingCrash(); }}
      />

      {/* Kilit etkinken uygulama arka plandayken içerik görünmesin (iOS uygulama değiştirici vb.) */}
      {showCover && <View style={[StyleSheet.absoluteFill, { backgroundColor: currentColors.background }]} pointerEvents="auto" />}
    </View>
  );
}

const BAR_HEIGHT = 64;

const styles = StyleSheet.create({
  root: { flex: 1 },
  mainContent: { flex: 1 },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    paddingHorizontal: 8,
  },
  tabButton: {
    flex: 1,
    height: BAR_HEIGHT,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerTabCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
});
