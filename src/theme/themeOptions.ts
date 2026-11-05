// Uygulama temalarının tek liste kaynağı (Ayarlar, Header, App paylaşır). RN içe aktarmaz; saf veri + saf fonksiyon.
import { AppThemeMode, ThemePreference } from '../types';

export interface ThemeOption {
  id: AppThemeMode;
  name: string;
  desc: string;
  /** Ionicons adı */
  icon: string;
}

export const DEFAULT_APP_THEME: AppThemeMode = 'emerald';
/** Sistem koyu temadayken kullanılacak koyu tema. */
export const SYSTEM_DARK_THEME: AppThemeMode = 'emerald';
export const SYSTEM_LIGHT_THEME: AppThemeMode = 'light';

export const THEME_OPTIONS: readonly ThemeOption[] = [
  { id: 'emerald', name: 'Zümrüt Slate', desc: 'Gözü yormayan yumuşak koyu tema (varsayılan)', icon: 'leaf' },
  { id: 'dark', name: 'Siber Lacivert', desc: 'Gece mavisi zemin, camgöbeği vurgu', icon: 'moon' },
  { id: 'oled', name: 'Saf Siyah (OLED)', desc: 'OLED ekranlarda derin siyah', icon: 'contrast' },
  { id: 'light', name: 'Açık Tema', desc: 'Gündüz kullanımına uygun açık tema', icon: 'sunny' },
  { id: 'purple', name: 'Amethyst', desc: 'Mor ve derin gece renkleri', icon: 'color-palette' },
  { id: 'ocean', name: 'Derin Okyanus', desc: 'Mavi ve lacivert tonları', icon: 'water' },
];

export const THEME_IDS: readonly AppThemeMode[] = THEME_OPTIONS.map(t => t.id);

export function isAppThemeMode(x: unknown): x is AppThemeMode {
  return typeof x === 'string' && (THEME_IDS as readonly string[]).includes(x);
}

export function isThemePreference(x: unknown): x is ThemePreference {
  return x === 'system' || isAppThemeMode(x);
}

export function getThemeName(id: AppThemeMode): string {
  const found = THEME_OPTIONS.find(t => t.id === id);
  return found ? found.name : id;
}

/** Tercihi somut temaya çevirir. scheme: RN useColorScheme() sonucu (null/undefined → koyu varsay). */
export function resolveTheme(pref: ThemePreference, scheme: string | null | undefined): AppThemeMode {
  if (pref === 'system') return scheme === 'light' ? SYSTEM_LIGHT_THEME : SYSTEM_DARK_THEME;
  return isAppThemeMode(pref) ? pref : DEFAULT_APP_THEME;
}

/** Header'daki hızlı düğme için sıradaki somut tema. */
export function nextTheme(current: AppThemeMode): AppThemeMode {
  const i = THEME_IDS.indexOf(current);
  return THEME_IDS[(i + 1) % THEME_IDS.length];
}
