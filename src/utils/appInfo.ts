// Uygulama adı/sürümü (tek kaynak: app.json → expo-constants) ve açık kaynak atıf listesi.
import Constants from 'expo-constants';

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
export const OPEN_SOURCE: readonly OpenSourceItem[] = [
  { name: 'React Native / React', license: 'MIT', use: 'Uygulama çatısı' },
  { name: 'Expo SDK (expo-*)', license: 'MIT', use: 'Dosya, paylaşım, yazdırma, kimlik doğrulama' },
  { name: 'react-native-pdf', license: 'MIT', use: 'PDF görüntüleme' },
  { name: 'react-native-blob-util', license: 'MIT', use: 'PDF motoru bağımlılığı' },
  { name: 'react-native-webview', license: 'MIT', use: 'Markdown/EPUB/DOCX gösterimi' },
  { name: 'react-native-svg', license: 'MIT', use: 'SVG görseller' },
  { name: 'react-native-gesture-handler / reanimated', license: 'MIT', use: 'Dokunma hareketleri' },
  { name: 'react-native-safe-area-context / screens', license: 'MIT', use: 'Güvenli alan, ekran yönetimi' },
  { name: 'JSZip', license: 'MIT veya GPL-3.0 (ikili lisans; MIT seçilir)', use: 'ZIP/DOCX/PPTX/EPUB açma' },
  { name: 'SheetJS (xlsx)', license: 'Apache-2.0', use: 'Excel/CSV okuma-yazma' },
  { name: 'marked', license: 'MIT', use: 'Markdown ayrıştırma' },
  { name: 'highlight.js', license: 'BSD-3-Clause', use: 'Kod renklendirme' },
  { name: 'xss', license: 'MIT', use: 'HTML temizleme' },
  { name: 'pdf-lib', license: 'MIT', use: 'PDF oluşturma/birleştirme' },
  { name: '@expo/vector-icons (Ionicons vb.)', license: 'MIT (ikon setlerinin kendi lisansları: MIT/SIL OFL)', use: 'Simgeler' },
];
