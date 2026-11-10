// Uygulama kilidi: expo-local-authentication sarmalayıcısı (biyometri veya cihaz ekran kilidi PIN/desen/parola).
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_LOCK_STORAGE_KEY, parseLockFlag } from '../utils/appSettings';
import { t } from '../i18n';

export interface LockAvailability {
  available: boolean;
  /** Kullanıcıya gösterilecek açıklama (kullanılamıyorsa neden; kullanılabiliyorsa hangi yöntem). */
  description: string;
}

/** Cihazda en az bir doğrulama yöntemi (parmak izi/yüz/ekran kilidi) tanımlı mı? */
export async function getLockAvailability(): Promise<LockAvailability> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level !== LocalAuthentication.SecurityLevel.NONE) {
      return {
        available: true,
        description:
          level === LocalAuthentication.SecurityLevel.SECRET
            ? t('lock.descDevice')
            : t('lock.descBio'),
      };
    }
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    return {
      available: false,
      description: hasHardware
        ? t('lock.noEnrolled')
        : t('lock.noSupport'),
    };
  } catch {
    return { available: false, description: t('lock.readFail') };
  }
}

export interface AuthOutcome {
  ok: boolean;
  /** expo-local-authentication hata kodu (ok=false ise) */
  error?: string;
  /** Tekrar denemekle düzelmeyecek durum (kilit yöntemi yok/kaldırılmış vb.). */
  unrecoverable: boolean;
  message?: string;
}

const UNRECOVERABLE = new Set(['not_enrolled', 'not_available', 'passcode_not_set', 'missing_usage_description']);

function messageFor(code: string): string {
  switch (code) {
    case 'user_cancel':
    case 'system_cancel':
    case 'app_cancel':
      return t('lock.err.cancelled');
    case 'authentication_failed':
      return t('lock.authFailed');
    case 'lockout':
      return t('lock.err.lockout');
    case 'timeout':
      return t('lock.err.timeout');
    case 'not_enrolled':
    case 'passcode_not_set':
      return t('lock.err.notEnrolled');
    case 'not_available':
      return t('lock.err.unavailable');
    case 'missing_usage_description':
      return t('lock.err.faceId');
    default:
      return t('lock.err.generic');
  }
}

let inFlight: Promise<AuthOutcome> | null = null;

/** Doğrulama penceresini açar. Eşzamanlı çağrılar aynı pencereyi paylaşır (çift istem açılmaz). Asla atmaz. */
export function authenticate(promptMessage: string): Promise<AuthOutcome> {
  if (inFlight) return inFlight;
  inFlight = (async (): Promise<AuthOutcome> => {
    try {
      const r = await LocalAuthentication.authenticateAsync({
        promptMessage,
        cancelLabel: t('common.cancel'),
        fallbackLabel: t('lock.usePassword'),
        disableDeviceFallback: false,
      });
      if (r.success) return { ok: true, unrecoverable: false };
      const code = r.error || 'unknown';
      return { ok: false, error: code, unrecoverable: UNRECOVERABLE.has(code), message: messageFor(code) };
    } catch {
      return { ok: false, error: 'exception', unrecoverable: false, message: t('lock.err.start') };
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export async function loadLockEnabled(): Promise<boolean> {
  try {
    return parseLockFlag(await AsyncStorage.getItem(APP_LOCK_STORAGE_KEY));
  } catch {
    return false;
  }
}

/** Kilit ayarını kalıcı yazar; yazılamazsa false (çağıran durumu değiştirmemeli). */
export async function saveLockEnabled(enabled: boolean): Promise<boolean> {
  try {
    await AsyncStorage.setItem(APP_LOCK_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
