// 'audio' kategorisi kaldırıldı: ses/video dosyaları için görüntüleyici yok; 'unsupported' + unsupportedReason üretilir.
export type FileType =
  | 'pdf'
  | 'code'
  | 'markdown'
  | 'spreadsheet'
  | 'docx'
  | 'pptx'
  | 'epub'
  | 'text'
  | 'image'
  | 'archive'
  | 'unsupported'
  | 'unknown';

export type SyntaxTheme =
  | 'vscode-dark'
  | 'monokai'
  | 'dracula'
  | 'one-dark'
  | 'github-light'
  | 'solarized-dark';

export type AppThemeMode = 'emerald' | 'dark' | 'oled' | 'light' | 'purple' | 'ocean';

/** Kullanıcının seçtiği tema tercihi; 'system' çalışma anında açık/koyu temaya çözülür (AppThemeMode her zaman somut paledir). */
export type ThemePreference = AppThemeMode | 'system';

export interface FileInfo {
  id: string;
  name: string;
  uri: string;
  size: number;
  mimeType?: string;
  extension: string;
  category: FileType;
  lastOpened?: number;
  content?: string;
  base64?: string;
  isSample?: boolean;
  description?: string;
  tags?: string[];
  lastReadPage?: number;
  isFavorite?: boolean;
  /** Sanal dosya (ör. ZIP içindeki 'zip#entry'): son dosyalara yazılmaz, diskte kendi başına yoktur. */
  virtual?: boolean;
  /** getRecentFiles tarafından işaretlenir: kayıt var ama dosya diskte yok (yalnız favoriler için döner). */
  missing?: boolean;
  /** Dosyanın içe aktarıldığı özgün kaynak URI'si (content:// / file://); aynı belgeyi tekrar seçince kayıt birleştirmek için. */
  sourceUri?: string;
  /** Kaynaktaki özgün ad (kullanıcı yeniden adlandırsa bile değişmez). */
  originalName?: string;
  /** category 'unsupported' ise kullanıcıya gösterilecek Türkçe neden. */
  unsupportedReason?: string;
}
