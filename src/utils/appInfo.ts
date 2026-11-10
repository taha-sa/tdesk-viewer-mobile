// Uygulama adı/sürümü (tek kaynak: app.json → expo-constants) ve açık kaynak atıf listesi.
import Constants from 'expo-constants';
import { t } from '../i18n';

export const APP_DISPLAY_NAME = 'T-Desk Viewer';

export function getAppVersion(): string {
  const v = Constants.expoConfig?.version;
  return typeof v === 'string' && v ? v : '—';
}

export interface OpenSourceItem {
  name: string;
  license: string;
  use: string;
}

// Lisans türleri ilgili paketlerin package.json "license" alanlarına göre; kesin metin için paketlerin kendi LICENSE dosyalarına bakın.
export const getOpenSource = (): readonly OpenSourceItem[] => [
  { name: 'React Native / React', license: 'MIT', use: t('about.use.framework') },
  { name: 'Expo SDK (expo-*)', license: 'MIT', use: t('about.use.expo') },
  { name: 'react-native-pdf', license: 'MIT', use: t('about.use.pdfView') },
  { name: 'react-native-blob-util', license: 'MIT', use: t('about.use.pdfDep') },
  { name: 'react-native-webview', license: 'MIT', use: t('about.use.webview') },
  { name: 'react-native-svg', license: 'MIT', use: t('about.use.svg') },
  { name: 'react-native-gesture-handler / reanimated', license: 'MIT', use: t('about.use.gestures') },
  { name: 'react-native-safe-area-context / screens', license: 'MIT', use: t('about.use.safeArea') },
  { name: 'JSZip', license: t('about.license.jszip'), use: t('about.use.jszip') },
  { name: 'SheetJS (xlsx)', license: 'Apache-2.0', use: t('about.use.sheetjs') },
  { name: 'marked', license: 'MIT', use: t('about.use.marked') },
  { name: 'highlight.js', license: 'BSD-3-Clause', use: t('about.use.highlight') },
  { name: 'xss', license: 'MIT', use: t('about.use.xss') },
  { name: 'pdf-lib', license: 'MIT', use: t('about.use.pdfLib') },
  { name: '@expo/vector-icons (Ionicons vb.)', license: t('about.license.icons'), use: t('about.use.icons') },
];
