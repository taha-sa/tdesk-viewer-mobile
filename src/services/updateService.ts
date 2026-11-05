// GitHub Releases üzerinden uygulama güncelleme denetimi.
//
// Çalışma biçimi: Güncelleme deposunun (aşağıdaki UPDATE_REPO) en son "release" kaydı sorgulanır; etiket
// (ör. v1.0.3) mevcut sürümle karşılaştırılır. Yeni sürüm varsa release'e eklenmiş .apk dosyasının indirme
// bağlantısı sistem tarayıcısında açılır (Android bunu indirip kurulum penceresini gösterir).
// Güvenlik: yalnızca bu deponun github.com/.../releases/ adresleri açılır; yönlendirme/başka alan adı reddedilir.
// Not: Güncellemenin mevcut uygulamanın üstüne kurulabilmesi için APK aynı imza anahtarıyla (EAS keystore) üretilmelidir.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Linking, Platform } from 'react-native';
import { getAppVersion } from '../utils/appInfo';

/** Güncellemelerin yayımlandığı GitHub deposu (T-Desk Viewer'a ÖZEL; diğer depolarla karışmaz). */
export const UPDATE_REPO = { owner: 'taha-sa', repo: 'tdesk-viewer-releases' } as const;

const KEYS = {
  LAST_CHECK: '@tdesk_update_last_check',
  SKIPPED: '@tdesk_update_skipped_version',
};
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12000;
const RELEASE_URL_PREFIX = `https://github.com/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/`;

export type UpdateResult =
  | { status: 'available'; current: string; latest: string; notes: string; apkUrl: string | null; pageUrl: string; apkSize: number | null }
  | { status: 'latest'; current: string; latest: string }
  | { status: 'error'; message: string };

// ---------------------------------------------------------------------------
// Saf yardımcılar (test edilebilir)
// ---------------------------------------------------------------------------

/** "v1.2.3", "1.2", "1.2.3-beta.1" → [1,2,3]; geçersizse null. Önek/sonek (-beta) yok sayılır. */
export function parseVersion(input: unknown): number[] | null {
  if (typeof input !== 'string') return null;
  const m = input.trim().match(/^[vV]?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}

/** a > b ise 1, a < b ise -1, eşitse 0; çözülemeyen sürümde 0. */
export function compareVersions(a: unknown, b: unknown): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/** Bu depoya ait bir release bağlantısı mı (yalnızca https + doğru kullanıcı/depo). */
export function isTrustedReleaseUrl(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith(RELEASE_URL_PREFIX) && !/[\s"'<>]/.test(url);
}

interface GitHubAsset { name?: unknown; browser_download_url?: unknown; size?: unknown; }
interface GitHubRelease {
  tag_name?: unknown; body?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown;
}

/** GitHub release yanıtından karar üretir (ağdan bağımsız, test edilebilir). */
export function evaluateRelease(release: unknown, currentVersion: string): UpdateResult {
  if (!release || typeof release !== 'object') return { status: 'error', message: 'Beklenmeyen yanıt alındı.' };
  const r = release as GitHubRelease;
  if (r.draft === true || r.prerelease === true) return { status: 'latest', current: currentVersion, latest: currentVersion };
  const tag = typeof r.tag_name === 'string' ? r.tag_name : '';
  if (!parseVersion(tag)) return { status: 'error', message: 'Yayın etiketi anlaşılamadı.' };
  const latest = tag.replace(/^[vV]/, '');
  if (compareVersions(latest, currentVersion) <= 0) return { status: 'latest', current: currentVersion, latest };

  let apkUrl: string | null = null;
  let apkSize: number | null = null;
  if (Array.isArray(r.assets)) {
    for (const a of r.assets as GitHubAsset[]) {
      const name = typeof a?.name === 'string' ? a.name : '';
      const url = a?.browser_download_url;
      if (/\.apk$/i.test(name) && isTrustedReleaseUrl(url)) {
        apkUrl = url;
        apkSize = typeof a.size === 'number' ? a.size : null;
        break;
      }
    }
  }
  const pageUrl = isTrustedReleaseUrl(r.html_url) ? r.html_url : `${RELEASE_URL_PREFIX}tag/${encodeURIComponent(tag)}`;
  const notes = typeof r.body === 'string' ? r.body.trim().slice(0, 1200) : '';
  return { status: 'available', current: currentVersion, latest, notes, apkUrl, pageUrl, apkSize };
}

// ---------------------------------------------------------------------------
// Ağ ve eylemler
// ---------------------------------------------------------------------------

export async function checkForUpdate(): Promise<UpdateResult> {
  const current = getAppVersion();
  if (!parseVersion(current)) return { status: 'error', message: 'Mevcut sürüm okunamadı.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (res.status === 404) return { status: 'latest', current, latest: current }; // henüz yayın yok
    if (!res.ok) return { status: 'error', message: `Güncelleme sunucusu yanıt vermedi (${res.status}).` };
    return evaluateRelease(await res.json(), current);
  } catch (e: any) {
    const aborted = e?.name === 'AbortError';
    return { status: 'error', message: aborted ? 'Bağlantı zaman aşımına uğradı.' : 'İnternet bağlantısı kurulamadı.' };
  } finally {
    clearTimeout(timer);
    try { await AsyncStorage.setItem(KEYS.LAST_CHECK, String(Date.now())); } catch { /* önemsiz */ }
  }
}

/** Android: APK bağlantısını açar (indirme + kurulum). iOS/APK yoksa: yayın sayfası. */
export async function openUpdate(update: Extract<UpdateResult, { status: 'available' }>): Promise<boolean> {
  const target = Platform.OS === 'android' && update.apkUrl ? update.apkUrl : update.pageUrl;
  if (!isTrustedReleaseUrl(target)) return false;
  try {
    await Linking.openURL(target);
    return true;
  } catch {
    Alert.alert('Açılamadı', 'Güncelleme bağlantısı açılamadı. Lütfen daha sonra tekrar deneyin.');
    return false;
  }
}

export function formatUpdateMessage(u: Extract<UpdateResult, { status: 'available' }>): string {
  const size = u.apkSize ? ` (${(u.apkSize / 1048576).toFixed(1)} MB)` : '';
  const notes = u.notes ? `\n\nYenilikler:\n${u.notes}` : '';
  const how = Platform.OS === 'android' && u.apkUrl
    ? '\n\nGüncelle\'ye basınca APK indirilir; indirme bitince bildirimden açıp kurabilirsiniz (ilk seferde "bu kaynaktan kurulum"a izin vermeniz istenebilir).'
    : '\n\nGüncelle\'ye basınca yayın sayfası açılır.';
  return `Yeni sürüm: ${u.latest}${size}\nMevcut sürüm: ${u.current}${notes}${how}`;
}

/** Açılışta sessiz denetim: günde en fazla bir kez; "Bu sürümü atla" seçilen sürüm bir daha sorulmaz. */
export async function autoCheckAndPrompt(): Promise<void> {
  try {
    const last = Number((await AsyncStorage.getItem(KEYS.LAST_CHECK)) || 0);
    if (last && Date.now() - last < AUTO_CHECK_INTERVAL_MS) return;
    const result = await checkForUpdate();
    if (result.status !== 'available') return;
    const skipped = await AsyncStorage.getItem(KEYS.SKIPPED);
    if (skipped && skipped === result.latest) return;
    Alert.alert('Güncelleme mevcut', formatUpdateMessage(result), [
      { text: 'Sonra', style: 'cancel' },
      { text: 'Bu sürümü atla', onPress: () => { void AsyncStorage.setItem(KEYS.SKIPPED, result.latest); } },
      { text: 'Güncelle', onPress: () => { void openUpdate(result); } },
    ]);
  } catch { /* açılışı asla bozma */ }
}
