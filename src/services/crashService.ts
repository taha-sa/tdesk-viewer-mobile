// Çökme/hata kaydı (yalnız JS): küresel hata yakalayıcı + hata sınırı → maskelenmiş kayıt belge klasörüne yazılır.
// Hiçbir şey kendiliğinden gönderilmez; sonraki açılışta kullanıcı önizleyip kendisi gönderir (bkz. CrashReportSheet).
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_DISPLAY_NAME, getAppVersion } from '../utils/appInfo';
import { CrashRecord, describeError } from '../utils/crashReport';
import { Scrubber } from '../utils/scrubber';

const AUTO_REPORT_KEY = '@tdesk_autoreport_v1';
const CRASH_FILE = 'tdesk-crash-report.json';
const MAX_LOG_LINES = 200;
const MAX_FIELD = 20000;
const FLUSH_TIMEOUT_MS = 1500;

const startedAt = Date.now();
const logRing: string[] = [];
let autoReport = true;
let installed = false;

const scrubber = new Scrubber();
const cap = (s: string) => (s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) : s);

function pushLog(level: string, args: unknown[]) {
  try {
    const text = args
      .map(a => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    logRing.push(`${new Date().toISOString()} ${level} ${scrubber.scrub(text).slice(0, 500)}`);
    if (logRing.length > MAX_LOG_LINES) logRing.shift();
  } catch {
    /* günlük tutma asla hata üretmemeli */
  }
}

function crashPath(): string | null {
  const dir = FileSystem.documentDirectory;
  return dir ? dir + CRASH_FILE : null;
}

function runtimeInfo(): string {
  const rn = (Platform.constants as { reactNativeVersion?: { major: number; minor: number; patch: number } } | undefined)
    ?.reactNativeVersion;
  const hermes = (globalThis as { HermesInternal?: unknown }).HermesInternal ? 'Hermes' : 'JSC';
  return `RN ${rn ? `${rn.major}.${rn.minor}.${rn.patch}` : '?'} / ${hermes}`;
}

function currentLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || '';
  } catch {
    return '';
  }
}

function otaUpdateId(): string | null {
  try {
    return Updates.updateId ?? null;
  } catch {
    return null;
  }
}

/** Kaydı yazılmadan önce maskeler (diskte ham kişisel veri bulunmaz). */
function buildRecord(error: unknown, isFatal: boolean, extraStack?: string): CrashRecord {
  const d = describeError(error);
  const stack = extraStack ? `${d.stack}\n--- Component stack ---${extraStack}` : d.stack;
  return {
    appName: APP_DISPLAY_NAME,
    version: getAppVersion(),
    utc: new Date().toISOString(),
    os: `${Platform.OS} ${String(Platform.Version)}`,
    runtime: runtimeInfo(),
    locale: currentLocale(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    updateId: otaUpdateId(),
    isFatal,
    errorName: scrubber.scrub(d.errorName),
    message: cap(scrubber.scrub(d.message)),
    stack: cap(scrubber.scrub(stack)),
    logLines: logRing.slice(-MAX_LOG_LINES),
  };
}

/** Son hatayı yazar (ayar kapalıysa yazmaz). Asla atmaz. */
export async function recordError(error: unknown, isFatal: boolean, componentStack?: string): Promise<void> {
  if (!autoReport) return;
  try {
    const path = crashPath();
    if (!path) return;
    const rec = buildRecord(error, isFatal, componentStack);
    await FileSystem.writeAsStringAsync(path, JSON.stringify(rec));
  } catch {
    /* yazılamadıysa sessizce vazgeç */
  }
}

/** Önceki oturumdan kalan kayıt (yoksa/bozuksa null). */
export async function loadPendingCrash(): Promise<CrashRecord | null> {
  try {
    const path = crashPath();
    if (!path) return null;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const obj = JSON.parse(await FileSystem.readAsStringAsync(path)) as Partial<CrashRecord>;
    if (!obj || typeof obj !== 'object' || typeof obj.message !== 'string' || typeof obj.errorName !== 'string') {
      await clearPendingCrash();
      return null;
    }
    return {
      appName: String(obj.appName ?? APP_DISPLAY_NAME),
      version: String(obj.version ?? '?'),
      utc: String(obj.utc ?? ''),
      os: String(obj.os ?? ''),
      runtime: String(obj.runtime ?? ''),
      locale: String(obj.locale ?? ''),
      uptimeSec: typeof obj.uptimeSec === 'number' ? obj.uptimeSec : null,
      updateId: typeof obj.updateId === 'string' ? obj.updateId : null,
      isFatal: obj.isFatal === true,
      errorName: obj.errorName,
      message: obj.message,
      stack: String(obj.stack ?? ''),
      logLines: Array.isArray(obj.logLines) ? obj.logLines.map(String) : [],
    };
  } catch {
    await clearPendingCrash();
    return null;
  }
}

export async function clearPendingCrash(): Promise<void> {
  try {
    const path = crashPath();
    if (path) await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    /* yok say */
  }
}

export function getAutoReportSync(): boolean {
  return autoReport;
}

export async function loadAutoReport(): Promise<boolean> {
  try {
    autoReport = (await AsyncStorage.getItem(AUTO_REPORT_KEY)) !== '0';
  } catch {
    autoReport = true;
  }
  return autoReport;
}

export async function setAutoReport(on: boolean): Promise<void> {
  autoReport = on;
  try {
    await AsyncStorage.setItem(AUTO_REPORT_KEY, on ? '1' : '0');
    if (!on) await clearPendingCrash();
  } catch {
    /* yok say */
  }
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

/** Uygulama başında bir kez çağrılır: konsol günlüğü + küresel hata yakalayıcı. */
export function installCrashHandlers(): void {
  if (installed) return;
  installed = true;
  void loadAutoReport();

  for (const level of ['warn', 'error'] as const) {
    const orig = console[level];
    console[level] = (...args: unknown[]) => {
      pushLog(level, args);
      orig.apply(console, args as []);
    };
  }

  const eu = (globalThis as { ErrorUtils?: { getGlobalHandler(): GlobalHandler; setGlobalHandler(h: GlobalHandler): void } }).ErrorUtils;
  if (!eu) return;
  const previous = eu.getGlobalHandler();
  eu.setGlobalHandler((error, isFatal) => {
    let done = false;
    const forward = () => {
      if (done) return;
      done = true;
      try {
        previous(error, isFatal);
      } catch {
        /* varsayılan işleyici de atabilir */
      }
    };
    // Ölümcül hatada süreç hemen sonlanır: yazma bitene (en çok 1,5 sn) kadar bekletip sonra devam et.
    const timer = setTimeout(forward, FLUSH_TIMEOUT_MS);
    void recordError(error, isFatal === true).finally(() => {
      clearTimeout(timer);
      forward();
    });
  });
}

/** Kullanıcının "Hata raporu gönder…" ile elle başlattığı rapor (hata yok; ortam + son günlük satırları). */
export function buildManualRecord(): CrashRecord {
  return buildRecord(new Error('User-initiated report'), false);
}
