// Uygulama ayarlarının saf mantığı (RN içe aktarmaz; node'da test edilebilir).
import { SyntaxTheme, ThemePreference } from '../types';
import { isThemePreference, DEFAULT_APP_THEME } from '../theme/themeOptions';
import { isSyntaxThemeId, DEFAULT_SYNTAX_THEME_ID } from '../theme/syntaxThemes';
import { LanguagePref, DEFAULT_LANGUAGE_PREF, isLanguagePref } from '../i18n';

/** Uygulama kilidi ayrı anahtarda tutulur: tema JSON'u bozulsa bile kilit durumu kaybolmaz. */
export const APP_LOCK_STORAGE_KEY = '@tdesk_applock_v1';
/** Arka plana geçip bu süreden uzun kalınırsa tekrar kilitlenir. */
export const APP_LOCK_GRACE_MS = 30 * 1000;

export interface StoredSettings {
  themePreference: ThemePreference;
  codeTheme: SyntaxTheme;
  /** 'system' = cihaz dili (tr→TR, de→DE, diğer→EN). */
  language: LanguagePref;
}

export const DEFAULT_SETTINGS: StoredSettings = {
  themePreference: DEFAULT_APP_THEME,
  codeTheme: DEFAULT_SYNTAX_THEME_ID,
  language: DEFAULT_LANGUAGE_PREF,
};

/** Kayıtlı ayar metnini doğrular. Bozuk/eksik/bilinmeyen değer → varsayılan (asla atmaz). Eski şema: `appTheme` alanı okunur. */
export function parseStoredSettings(raw: string | null | undefined): StoredSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ...DEFAULT_SETTINGS };
  const o = obj as Record<string, unknown>;
  const pref = isThemePreference(o.themePreference)
    ? o.themePreference
    : isThemePreference(o.appTheme)
      ? o.appTheme
      : DEFAULT_SETTINGS.themePreference;
  const code = isSyntaxThemeId(o.codeTheme) ? o.codeTheme : DEFAULT_SETTINGS.codeTheme;
  const language = isLanguagePref(o.language) ? o.language : DEFAULT_SETTINGS.language;
  return { themePreference: pref, codeTheme: code, language };
}

export function serializeSettings(s: StoredSettings): string {
  return JSON.stringify({ themePreference: s.themePreference, codeTheme: s.codeTheme, language: s.language });
}

/** Kilit değeri yalnız tam '1' ise açıktır. */
export function parseLockFlag(raw: string | null | undefined): boolean {
  return raw === '1';
}

/**
 * Arka plandan dönüşte yeniden kilitlenmeli mi?
 * backgroundedAt yoksa (hiç arka plana gitmedi) hayır; saat geriye alınmışsa (negatif süre) güvenli tarafta kalıp evet.
 */
export function shouldRelock(backgroundedAt: number | null, now: number, graceMs: number = APP_LOCK_GRACE_MS): boolean {
  if (backgroundedAt === null || !isFinite(backgroundedAt)) return false;
  const elapsed = now - backgroundedAt;
  if (elapsed < 0) return true;
  return elapsed >= graceMs;
}
