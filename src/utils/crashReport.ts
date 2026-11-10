// Çökme raporu biçimi (T-Suite TSuite.Diagnostics/ReportFormatter.cs ile aynı kurallar). Saf mantık, RN içe aktarmaz.
import { Scrubber } from './scrubber';

export const RELEASES_REPO = 'taha-sa/tdesk-viewer-releases';
/** Sorun bildirim adresinin üst sınırı (ReportFormatter.cs ile aynı). */
const MAX_URL_LENGTH = 7000;

export interface CrashRecord {
  appName: string;
  version: string;
  /** ISO 8601 UTC */
  utc: string;
  /** Platform + sürüm, ör. "android 14" */
  os: string;
  /** Çalışma zamanı, ör. "RN 0.76.9 / Hermes" */
  runtime: string;
  locale: string;
  /** Açılıştan hataya kadar geçen süre (sn); bilinmiyorsa null. */
  uptimeSec: number | null;
  /** OTA güncelleme kimliği; yoksa null. */
  updateId: string | null;
  isFatal: boolean;
  errorName: string;
  message: string;
  stack: string;
  /** Son günlük satırları (en fazla 200). */
  logLines: string[];
}

export function validateRepo(repo: string): void {
  if (
    typeof repo !== 'string' ||
    !/^[A-Za-z0-9_-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(repo) ||
    repo.endsWith('/.') ||
    repo.endsWith('/..')
  ) {
    throw new Error('Expected a GitHub owner/repository.');
  }
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r/g, ' ').replace(/\n/g, ' ').replace(/`/g, "'");

function header(r: CrashRecord, scrubber: Scrubber): string {
  const uptime = r.uptimeSec === null ? '-' : `${r.uptimeSec}s`;
  return scrubber.scrub(
    '# Crash report\n\n| Environment | Value |\n| --- | --- |\n' +
      `| App | ${cell(r.appName)} |\n| Version | ${cell(r.version)} |\n| UTC | ${cell(r.utc)} |\n` +
      `| OS / build | ${cell(r.os)} |\n| Runtime | ${cell(r.runtime)} |\n| OTA update | ${cell(r.updateId ?? '-')} |\n` +
      `| Culture | ${cell(r.locale)} |\n| Uptime | ${uptime} |\n| Fatal | ${r.isFatal ? 'yes' : 'no'} |\n\n`,
  );
}

function content(r: CrashRecord, scrubber: Scrubber): string {
  const lines: string[] = [`${r.errorName}: ${r.message}`, r.stack, '--- Recent log (up to 200 lines) ---'];
  for (const l of r.logLines.slice(-200)) lines.push(l);
  return scrubber.scrub(lines.join('\n')).replace(/`/g, "'");
}

/** Önizleme/kopyalama metni (Markdown). Tamamı maskelenmiştir. */
export function formatReportText(r: CrashRecord, scrubber: Scrubber = new Scrubber()): string {
  return header(r, scrubber) + '```text\n' + content(r, scrubber) + '\n```\n';
}

function prefix(s: string, length: number): string {
  const n = Math.min(length, s.length);
  if (n > 0 && n < s.length) {
    const c = s.charCodeAt(n - 1);
    if (c >= 0xd800 && c <= 0xdbff) return s.slice(0, n - 1); // yarım vekil çifti
  }
  return s.slice(0, n);
}

/** Önceden doldurulmuş GitHub "yeni sorun" adresi (en fazla ~7000 karakter). */
export function buildIssueUrl(r: CrashRecord, repo: string = RELEASES_REPO, scrubber: Scrubber = new Scrubber()): string {
  validateRepo(repo);
  const type = r.errorName.slice(r.errorName.lastIndexOf('.') + 1);
  let title = scrubber.scrub(`[${r.appName} ${r.version}] ${type}: ${r.message}`).replace(/\r/g, ' ').replace(/\n/g, ' ');
  title = prefix(title, Math.min(title.length, 180));
  const start = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=`;
  let head = header(r, scrubber);
  if (encodeURIComponent(head).length > 2000) head = '# Crash report\n\nEnvironment omitted (too large); see full preview.\n\n';
  const body = content(r, scrubber);
  const build = (length: number) =>
    start +
    encodeURIComponent(
      head + '```text\n' + prefix(body, length) + (length < body.length ? '\n[truncated; full report available via Copy]' : '') + '\n```\n',
    );
  let low = 0;
  let high = body.length;
  while (low < high) {
    const middle = low + Math.floor((high - low + 1) / 2);
    if (build(middle).length < MAX_URL_LENGTH) low = middle;
    else high = middle - 1;
  }
  return build(low);
}

/** Bilinmeyen bir hata nesnesinden ad/ileti/yığın çıkarır (asla atmaz). */
export function describeError(error: unknown): { errorName: string; message: string; stack: string } {
  if (error instanceof Error) {
    return { errorName: error.name || 'Error', message: String(error.message ?? ''), stack: String(error.stack ?? '') };
  }
  let message = '';
  try {
    message = typeof error === 'string' ? error : JSON.stringify(error) ?? String(error);
  } catch {
    message = String(error);
  }
  return { errorName: 'Error', message, stack: '' };
}
