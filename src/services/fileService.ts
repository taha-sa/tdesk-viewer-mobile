import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { FileInfo, FileType } from '../types';
import { localizeDecimal, t, makeRef } from '../i18n';

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

/** Son dosyalar listesinde tutulacak azami (favori OLMAYAN) kayıt sayısı. Favoriler bu sınırın dışındadır. */
export const MAX_RECENT = 3;

/**
 * Depolama anahtarları. Kayıt şeması aynı anahtarda (`_v1`) dizi olarak durur; şema geçişi kayıt bazında
 * `normalizeRecord` ile yapılır (eski kayıtlar okunabilir kalır). FAVORITES ayrı anahtar değil: favori bilgisi kaydın içindedir.
 */
export const STORAGE_KEYS = {
  RECENTS: '@tdesk_recents_v1',
  RECENTS_CORRUPT_BACKUP: '@tdesk_recents_corrupt_backup',
  SETTINGS: '@tdesk_settings_v1',
};

const MANAGED_PREFIXES = ['tdesk_', 'intent_', 'nested_'];
const MAX_COPY_BYTES = 100 * 1024 * 1024; // 100MB üstü cache'e kopyalanmaz
const MAX_ZIP_SNIFF_BYTES = 30 * 1024 * 1024; // PK içerik incelemesi için okunacak azami boyut
const ORPHAN_MIN_AGE_MS = 2 * 60 * 1000; // yeni kopyaları (henüz kayda yazılmamış) temizlikten koru
const MAX_TAGS = 20;
const MAX_NAME_LENGTH = 120;

const ALL_CATEGORIES: FileType[] = [
  'pdf', 'code', 'markdown', 'spreadsheet', 'docx', 'pptx', 'epub', 'text', 'image', 'archive', 'unsupported', 'unknown',
];

const devLog = (...args: unknown[]) => {
  if (__DEV__) console.log(...args);
};
// Release'te URI/yol gibi ayrıntılar loglanmaz; yalnızca kısa mesaj.
const logError = (message: string, err?: unknown) => {
  if (__DEV__) console.error(message, err);
  else console.warn(message);
};

// ---------------------------------------------------------------------------
// Uzantı / MIME tabloları (tek kaynak)
// ---------------------------------------------------------------------------

const CODE_EXTENSIONS = [
  // syntaxService.LANGUAGE_MAP ile tutarlı tutulur
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'html', 'htm', 'xml', 'css', 'scss', 'sass', 'less',
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'py', 'pyw', 'dart', 'java', 'kt', 'kts', 'groovy', 'gradle',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'vue', 'svelte', 'tex',
  'sql', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'dockerfile', 'docker', 'makefile', 'mk',
  'lua', 'r', 'scala', 'perl', 'pl', 'ini', 'env', 'conf', 'cfg', 'properties',
  'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'bashrc', 'zshrc', 'babelrc', 'eslintrc', 'prettierrc',
];

/** Uzantısız (ya da tüm adı bilinen) dosya adları. */
const NAME_CATEGORY: Record<string, FileType> = {
  dockerfile: 'code', makefile: 'code', gemfile: 'code', rakefile: 'code', procfile: 'code',
  jenkinsfile: 'code', vagrantfile: 'code',
  readme: 'text', license: 'text', licence: 'text', changelog: 'text', authors: 'text', notice: 'text',
};

const UNSUPPORTED_REASON: Record<string, string> = {
  mobi: makeRef('unsupported.kindle', { fmt: 'MOBI' }),
  azw: makeRef('unsupported.kindle', { fmt: 'AZW' }),
  azw3: makeRef('unsupported.kindle', { fmt: 'AZW3' }),
  kfx: makeRef('unsupported.kindle', { fmt: 'KFX' }),
  prc: makeRef('unsupported.kindle', { fmt: 'PRC' }),
  odt: makeRef('unsupported.odt'),
  ott: makeRef('unsupported.ott'),
  odp: makeRef('unsupported.odp'),
  doc: makeRef('unsupported.doc'),
  rtf: makeRef('unsupported.rtf'),
  ppt: makeRef('unsupported.ppt', { fmt: 'PPT' }),
  pps: makeRef('unsupported.ppt', { fmt: 'PPS' }),
  heic: makeRef('unsupported.image', { fmt: 'HEIC' }),
  heif: makeRef('unsupported.image', { fmt: 'HEIF' }),
  avif: makeRef('unsupported.image', { fmt: 'AVIF' }),
  tif: makeRef('unsupported.image', { fmt: 'TIFF' }),
  tiff: makeRef('unsupported.image', { fmt: 'TIFF' }),
  jxl: makeRef('unsupported.image', { fmt: 'JPEG XL' }),
  rar: makeRef('unsupported.archive', { fmt: 'RAR' }),
  '7z': makeRef('unsupported.archive', { fmt: '7z' }),
  tar: makeRef('unsupported.archive', { fmt: 'TAR' }),
  gz: makeRef('unsupported.archive', { fmt: 'GZ' }),
  tgz: makeRef('unsupported.archive', { fmt: 'TGZ' }),
  bz2: makeRef('unsupported.archive', { fmt: 'BZ2' }),
  xz: makeRef('unsupported.archive', { fmt: 'XZ' }),
  mp3: makeRef('unsupported.audio'),
  wav: makeRef('unsupported.audio'),
  m4a: makeRef('unsupported.audio'),
  aac: makeRef('unsupported.audio'),
  ogg: makeRef('unsupported.audio'),
  flac: makeRef('unsupported.audio'),
  mp4: makeRef('unsupported.video'),
  mkv: makeRef('unsupported.video'),
  avi: makeRef('unsupported.video'),
  mov: makeRef('unsupported.video'),
  webm: makeRef('unsupported.video'),
  '3gp': makeRef('unsupported.video'),
};

const GENERIC_UNSUPPORTED_REASON = makeRef('unsupported.generic');

const EXTENSION_CATEGORY: Record<string, FileType> = {};
const registerExts = (category: FileType, exts: string[]) => {
  for (const e of exts) EXTENSION_CATEGORY[e] = category;
};
registerExts('pdf', ['pdf']);
registerExts('markdown', ['md', 'markdown', 'mdown', 'mkd']);
registerExts('spreadsheet', ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'fods', 'csv', 'tsv']);
registerExts('docx', ['docx']);
registerExts('pptx', ['pptx']);
registerExts('epub', ['epub']);
registerExts('image', ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'bmp', 'ico']);
registerExts('archive', ['zip']);
registerExts('text', ['txt', 'log', 'text']);
registerExts('code', CODE_EXTENSIONS);
registerExts('unsupported', Object.keys(UNSUPPORTED_REASON));

const MIME_EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp',
  'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
  'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv', 'text/tab-separated-values': 'tsv',
  'text/html': 'html', 'text/xml': 'xml', 'application/xml': 'xml', 'application/json': 'json',
  'text/css': 'css', 'application/javascript': 'js', 'text/javascript': 'js',
  'application/zip': 'zip', 'application/x-zip-compressed': 'zip',
  'application/epub+zip': 'epub',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-excel': 'xls',
};

const EXTENSION_MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
  txt: 'text/plain', log: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
  csv: 'text/csv', tsv: 'text/tab-separated-values', html: 'text/html', htm: 'text/html', xml: 'text/xml',
  json: 'application/json', css: 'text/css', js: 'text/javascript',
  zip: 'application/zip', epub: 'application/epub+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
};

// ---------------------------------------------------------------------------
// Saf yardımcılar (test edilebilir)
// ---------------------------------------------------------------------------

/** Yol / URI / ad içinden son parçayı (sorgu ve parça kısmı olmadan) döndürür. */
export function getBaseName(nameOrPath: string): string {
  const s = String(nameOrPath ?? '').replace(/\\/g, '/');
  let last = s.slice(s.lastIndexOf('/') + 1);
  // URI ise sorgu / parça kısmını at; düz adlarda '#' ve '?' ad parçası olabilir
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) last = last.split(/[?#]/)[0];
  return last;
}

/** Küçük harfli uzantı (noktasız). '.env' gibi nokta ile başlayan adlar için ad kısmı uzantı sayılır. */
export function getExtension(nameOrPath: string): string {
  const base = getBaseName(nameOrPath);
  const idx = base.lastIndexOf('.');
  if (idx < 0 || idx === base.length - 1) return '';
  return base.slice(idx + 1).toLowerCase();
}

function normalizeMime(mime?: string | null): string {
  return (mime || '').split(';')[0].trim().toLowerCase();
}

function categoryFromMime(mimeRaw?: string | null): { category: FileType; reason?: string } | null {
  const mime = normalizeMime(mimeRaw);
  if (!mime || mime === 'application/octet-stream') return null;
  if (mime === 'application/pdf') return { category: 'pdf' };
  if (mime === 'image/svg+xml') return { category: 'image' };
  if (/^image\/(heic|heif|avif|tiff|jxl)/.test(mime)) {
    return { category: 'unsupported', reason: makeRef('unsupported.imageMime') };
  }
  if (mime.startsWith('image/')) return { category: 'image' };
  if (mime === 'text/markdown' || mime === 'text/x-markdown') return { category: 'markdown' };
  if (mime === 'text/csv' || mime === 'text/tab-separated-values') return { category: 'spreadsheet' };
  if (mime.includes('opendocument.spreadsheet')) return { category: 'spreadsheet' };
  if (mime.includes('spreadsheetml') || mime.includes('ms-excel') || mime.includes('spreadsheet')) return { category: 'spreadsheet' };
  if (mime.includes('wordprocessingml')) return { category: 'docx' };
  if (mime === 'application/msword' || mime.includes('opendocument.text')) {
    return { category: 'unsupported', reason: UNSUPPORTED_REASON.doc };
  }
  if (mime.includes('presentationml')) return { category: 'pptx' };
  if (mime.includes('ms-powerpoint') || mime.includes('opendocument.presentation')) {
    return { category: 'unsupported', reason: UNSUPPORTED_REASON.ppt };
  }
  if (mime === 'application/rtf' || mime === 'text/rtf') return { category: 'unsupported', reason: UNSUPPORTED_REASON.rtf };
  if (mime === 'application/epub+zip') return { category: 'epub' };
  if (mime.includes('mobipocket') || mime.includes('kindle')) return { category: 'unsupported', reason: UNSUPPORTED_REASON.mobi };
  if (mime === 'application/zip' || mime === 'application/x-zip-compressed') return { category: 'archive' };
  if (/(rar|7z|x-tar|gzip|x-bzip|x-xz|compressed)/.test(mime)) {
    return { category: 'unsupported', reason: makeRef('unsupported.archiveMime') };
  }
  if (mime.startsWith('audio/')) return { category: 'unsupported', reason: UNSUPPORTED_REASON.mp3 };
  if (mime.startsWith('video/')) return { category: 'unsupported', reason: UNSUPPORTED_REASON.mp4 };
  if (mime === 'application/json' || mime === 'application/xml' || mime === 'application/javascript' ||
      mime === 'application/x-sh' || mime === 'application/x-yaml' || mime === 'text/html' || mime === 'text/xml' ||
      mime === 'text/css' || mime === 'text/javascript' || mime.startsWith('text/x-')) {
    return { category: 'code' };
  }
  if (mime.startsWith('text/')) return { category: 'text' };
  return null;
}

export interface DetectedType {
  category: FileType;
  /** Küçük harfli uzantı ('' olabilir). */
  extension: string;
  /** category === 'unsupported' ise Türkçe neden. */
  unsupportedReason?: string;
}

/** Ad (yol olabilir) ve MIME'dan tür çıkarır. Önce uzantı, sonra tam ad, en son MIME. */
export function detectFileTypeDetailed(filename: string, mimeType?: string | null): DetectedType {
  const base = getBaseName(filename);
  const extension = getExtension(base);
  let category: FileType | undefined = extension ? EXTENSION_CATEGORY[extension] : undefined;
  let reason: string | undefined;

  if (category === 'unsupported') reason = UNSUPPORTED_REASON[extension];
  if (!category) category = NAME_CATEGORY[base.toLowerCase()];
  if (!category) {
    const fromMime = categoryFromMime(mimeType);
    if (fromMime) {
      category = fromMime.category;
      reason = fromMime.reason;
    }
  }
  if (!category) category = 'unknown';
  if (category === 'unsupported' && !reason) reason = GENERIC_UNSUPPORTED_REASON;
  return { category, extension, unsupportedReason: category === 'unsupported' ? reason : undefined };
}

/** Bayt cinsinden boyutu okunabilir metne çevirir (1024 tabanlı, ondalık virgül). */
export function formatFileSize(bytes: number): string {
  if (typeof bytes !== 'number' || !isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  let rounded = i === 0 ? Math.round(value) : Number(value.toFixed(1));
  if (rounded >= 1024 && i < units.length - 1) {
    value = rounded / 1024;
    i++;
    rounded = Number(value.toFixed(1));
  }
  return `${localizeDecimal(String(rounded))}\u00A0${units[i]}`;
}

/** Yalnızca file:// ve content:// kabul edilir (exp://, http(s)://, özel şemalar reddedilir). */
export function isSupportedFileUri(uri: unknown): boolean {
  if (typeof uri !== 'string') return false;
  const u = uri.trim().toLowerCase();
  return u.startsWith('file://') || u.startsWith('content://');
}

/** ZIP içi sanal dosya URI'si ('<zip>#<entry>'): diskte kendi başına yoktur, son dosyalara yazılmaz. */
export function isVirtualUri(uri: unknown): boolean {
  if (typeof uri !== 'string') return false;
  return uri.includes('#') || uri.startsWith('zip://') || uri.startsWith('virtual://');
}

/** Bozuk % dizilerinde bile hata atmayan decodeURIComponent. */
export function safeDecodeURI(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input.replace(/(?:%[0-9a-fA-F]{2})+/g, m => {
      try {
        return decodeURIComponent(m);
      } catch {
        return m;
      }
    });
  }
}

/** Görünen ad temizliği: Türkçe/Unicode harfler korunur; yalnızca yasak ve kontrol karakterleri `_` olur. */
export function sanitizeDisplayName(name: string): string {
  let s = String(name ?? '').normalize('NFC');
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001F\u007F\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, m => (m.length ? '_' : ''));
  if (s.length > MAX_NAME_LENGTH) {
    const ext = getExtension(s);
    const keep = ext && ext.length <= 10 ? '.' + ext : '';
    s = s.slice(0, MAX_NAME_LENGTH - keep.length) + keep;
  }
  return s;
}

const TR_FOLD: Record<string, string> = {
  'ç': 'c', 'Ç': 'C', 'ğ': 'g', 'Ğ': 'G', 'ı': 'i', 'İ': 'I', 'ö': 'o', 'Ö': 'O', 'ş': 's', 'Ş': 'S', 'ü': 'u', 'Ü': 'U',
};

/** Disk üzerindeki cache dosya adı: yalnız ASCII (Türkçe harfler sadeleştirilir). Görünen ad bundan bağımsızdır. */
export function toCacheFileName(name: string): string {
  const folded = String(name ?? '')
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, ch => TR_FOLD[ch] || ch)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  let s = folded.replace(/[^A-Za-z0-9.\-_]/g, '_').replace(/_{2,}/g, '_').replace(/^\.+/, '_');
  if (!s) s = 'belge';
  if (s.length > 100) {
    const ext = getExtension(s);
    const keep = ext && ext.length <= 10 ? '.' + ext : '';
    s = s.slice(0, 100 - keep.length) + keep;
  }
  return s;
}

function timestampLabel(now = Date.now()): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** URI'den kullanıcıya gösterilecek ad türetir (Türkçe karakter korunur; anlamsız provider kimliği ise Belge_<tarih>). */
export function deriveDisplayName(rawUri: string, now = Date.now()): string {
  // Önce ham adresteki gerçek ?/# ayırıcıları kesilir, SONRA çözülür; yoksa "Plan%20%232.pdf" → "Plan" olurdu.
  const decoded = safeDecodeURI(String(rawUri ?? '').trim().split(/[?#]/)[0]);
  let seg = getBaseName(decoded);
  const colon = seg.lastIndexOf(':');
  if (colon >= 0) seg = seg.slice(colon + 1);
  seg = sanitizeDisplayName(seg);
  const opaque = !seg || /^\d+$/.test(seg) || /^(msf|document|raw|image|video|audio)[:_]?\d+$/i.test(seg);
  return opaque ? `Belge_${timestampLabel(now)}` : seg;
}

export function extensionFromMime(mime?: string | null): string {
  return MIME_EXTENSION[normalizeMime(mime)] || '';
}

export function guessMimeType(nameOrExt: string): string | undefined {
  const ext = nameOrExt.includes('.') ? getExtension(nameOrExt) : nameOrExt.toLowerCase();
  return EXTENSION_MIME[ext];
}

export function utf8ByteLength(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64ToBytes(b64: string): number[] {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buffer = (buffer << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Magic bytes
// ---------------------------------------------------------------------------

export interface MagicInfo {
  kind: 'pdf' | 'zip' | 'ole' | 'image' | 'unsupported';
  category: FileType;
  extension: string;
  reason?: string;
  /** Zayıf imza (yalnız uzantısız/bilinmeyen dosyalarda geçerli). */
  weak?: boolean;
}

const startsWith = (b: ArrayLike<number>, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

export function detectMagic(b: ArrayLike<number>): MagicInfo | null {
  if (!b || b.length < 2) return null;
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46])) return { kind: 'pdf', category: 'pdf', extension: 'pdf' };
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06])) {
    return { kind: 'zip', category: 'archive', extension: 'zip' };
  }
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return { kind: 'ole', category: 'unsupported', extension: '', reason: makeRef('unsupported.ole') };
  }
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', category: 'image', extension: 'png' };
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { kind: 'image', category: 'image', extension: 'jpg' };
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return { kind: 'image', category: 'image', extension: 'gif' };
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { kind: 'image', category: 'image', extension: 'webp' };
  }
  if (startsWith(b, [0x7b, 0x5c, 0x72, 0x74, 0x66])) {
    return { kind: 'unsupported', category: 'unsupported', extension: 'rtf', reason: UNSUPPORTED_REASON.rtf };
  }
  if (startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
    return { kind: 'unsupported', category: 'unsupported', extension: '7z', reason: UNSUPPORTED_REASON['7z'] };
  }
  if (startsWith(b, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) {
    return { kind: 'unsupported', category: 'unsupported', extension: 'rar', reason: UNSUPPORTED_REASON.rar };
  }
  if (startsWith(b, [0x1f, 0x8b])) {
    return { kind: 'unsupported', category: 'unsupported', extension: 'gz', reason: UNSUPPORTED_REASON.gz };
  }
  if (b.length >= 12 && startsWith(b, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (/^(heic|heix|hevc|hevx|mif1|msf1|avif|avis)/.test(brand)) {
      return { kind: 'unsupported', category: 'unsupported', extension: brand.startsWith('av') ? 'avif' : 'heic', reason: UNSUPPORTED_REASON.heic };
    }
    return { kind: 'unsupported', category: 'unsupported', extension: 'mp4', reason: UNSUPPORTED_REASON.mp4 };
  }
  if (startsWith(b, [0x42, 0x4d]) && b.length >= 10 && b[6] === 0 && b[7] === 0 && b[8] === 0 && b[9] === 0) {
    return { kind: 'image', category: 'image', extension: 'bmp', weak: true };
  }
  if (startsWith(b, [0x49, 0x44, 0x33])) {
    return { kind: 'unsupported', category: 'unsupported', extension: 'mp3', reason: UNSUPPORTED_REASON.mp3, weak: true };
  }
  return null;
}

/** ZIP girdi adlarından gerçek biçimi çıkarır. */
export function classifyZipNames(names: string[]): DetectedType {
  const set = new Set(names.map(n => n.replace(/\\/g, '/')));
  const lower = Array.from(set).map(n => n.toLowerCase());
  const has = (n: string) => lower.includes(n.toLowerCase());
  const any = (pred: (n: string) => boolean) => lower.some(pred);

  if (has('META-INF/container.xml') && (has('mimetype') || any(n => n.endsWith('.opf')))) {
    return { category: 'epub', extension: 'epub' };
  }
  if (has('xl/workbook.xml') || any(n => n.startsWith('xl/worksheets/'))) return { category: 'spreadsheet', extension: 'xlsx' };
  if (has('word/document.xml') || any(n => n.startsWith('word/'))) return { category: 'docx', extension: 'docx' };
  if (has('ppt/presentation.xml') || any(n => n.startsWith('ppt/slides/'))) return { category: 'pptx', extension: 'pptx' };
  if (has('mimetype') && has('content.xml')) {
    return { category: 'unsupported', extension: 'odt', unsupportedReason: UNSUPPORTED_REASON.odt };
  }
  return { category: 'archive', extension: 'zip' };
}

const ZIP_BASED_EXTS = ['docx', 'xlsx', 'xlsm', 'xlsb', 'pptx', 'epub', 'zip', 'ods', 'fods', 'odt', 'odp', 'ott'];

export interface ReconcileResult extends DetectedType {
  /** true ise PK içeriği ayrıca ZIP girdi adlarıyla sınıflandırılmalı. */
  needsZip?: boolean;
}

/**
 * Uzantı/MIME'dan gelen sonucu içerik imzasıyla uzlaştırır.
 * Önce uzantı; uzantı yoksa/bilinmiyorsa ya da içerikle açıkça çelişiyorsa imza kazanır.
 */
export function reconcileWithMagic(base: DetectedType, magic: MagicInfo | null, mimeType?: string | null): ReconcileResult {
  if (!magic) return base;
  if (magic.weak && base.category !== 'unknown') return base;

  if (magic.kind === 'zip') {
    if (ZIP_BASED_EXTS.includes(base.extension)) return base;
    return { ...base, needsZip: true };
  }
  if (magic.kind === 'ole') {
    if (base.category === 'spreadsheet' || base.category === 'unsupported') return base;
    if (normalizeMime(mimeType).includes('excel')) return { category: 'spreadsheet', extension: 'xls' };
    return { category: 'unsupported', extension: base.extension, unsupportedReason: magic.reason };
  }
  // pdf / image / unsupported imzaları
  if (base.category === magic.category) return base;
  return {
    category: magic.category,
    extension: base.extension || magic.extension,
    unsupportedReason: magic.category === 'unsupported' ? magic.reason : undefined,
  };
}

// ---------------------------------------------------------------------------
// Kayıt doğrulama / normalizasyon
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Depodaki ham kaydı güvenli FileInfo'ya çevirir; kullanılamaz kayıtta null döner (tüm listeyi düşürmez). */
export function normalizeRecord(raw: unknown): FileInfo | null {
  if (!isRecord(raw)) return null;
  const uri = typeof raw.uri === 'string' ? raw.uri : '';
  if (!uri || isVirtualUri(uri) || uri.startsWith('content://')) return null;
  const name = typeof raw.name === 'string' && raw.name ? raw.name : getBaseName(safeDecodeURI(uri)) || 'Belge';
  const id = typeof raw.id === 'string' && raw.id ? raw.id : typeof raw.id === 'number' ? String(raw.id) : `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const size = typeof raw.size === 'number' && isFinite(raw.size) && raw.size >= 0 ? raw.size : 0;
  const extension = typeof raw.extension === 'string' ? raw.extension.toLowerCase() : getExtension(name);
  let category: FileType;
  const rawCat = raw.category as string;
  if (rawCat === 'audio') category = 'unsupported';
  else if (ALL_CATEGORIES.includes(rawCat as FileType)) category = rawCat as FileType;
  else category = detectFileTypeDetailed(name, typeof raw.mimeType === 'string' ? raw.mimeType : undefined).category;

  const rec: FileInfo = { id, name, uri, size, extension, category };
  if (typeof raw.mimeType === 'string') rec.mimeType = raw.mimeType;
  if (typeof raw.lastOpened === 'number' && isFinite(raw.lastOpened)) rec.lastOpened = raw.lastOpened;
  if (typeof raw.description === 'string') rec.description = raw.description;
  if (Array.isArray(raw.tags)) rec.tags = raw.tags.filter((t): t is string => typeof t === 'string' && t.length > 0);
  if (typeof raw.lastReadPage === 'number' && isFinite(raw.lastReadPage) && raw.lastReadPage >= 0) rec.lastReadPage = raw.lastReadPage;
  rec.isFavorite = raw.isFavorite === true;
  if (raw.isSample === true) rec.isSample = true;
  if (typeof raw.sourceUri === 'string') rec.sourceUri = raw.sourceUri;
  if (typeof raw.originalName === 'string') rec.originalName = raw.originalName;
  if (typeof raw.unsupportedReason === 'string') rec.unsupportedReason = raw.unsupportedReason;
  // eski kayıtlardaki ASCII-katlanmış metni düzelt
  if (rec.description === 'Harici uygulamadan T-Desk ile acildi' || rec.description === 'Harici uygulamadan T-Desk ile açıldı') rec.description = makeRef('file.fromExternal');
  return rec;
}

function sameDocument(a: FileInfo, b: FileInfo): boolean {
  if (a.id === b.id) return true;
  if (a.uri === b.uri) return true;
  if (a.sourceUri && b.sourceUri && a.sourceUri === b.sourceUri) return true;
  const an = a.originalName || a.name;
  const bn = b.originalName || b.name;
  return a.size > 0 && a.size === b.size && an === bn && !!a.sourceUri === !!b.sourceUri && (!a.sourceUri || a.sourceUri === b.sourceUri);
}

// ---------------------------------------------------------------------------
// FileService
// ---------------------------------------------------------------------------

export class FileService {
  private static queue: Promise<unknown> = Promise.resolve();

  /** Tüm kayıt okuma-değiştirme-yazma işlemleri bu tek kuyruktan geçer. */
  private static enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // ----- Tür tespiti / biçimleme (statik sarmalayıcılar, geriye uyumlu) -----

  public static detectFileType(filename: string, mimeType?: string): FileType {
    return detectFileTypeDetailed(filename, mimeType).category;
  }

  public static detectFileTypeDetailed = detectFileTypeDetailed;
  public static formatFileSize(bytes: number): string {
    return formatFileSize(bytes);
  }
  public static isVirtualUri(uri: unknown): boolean {
    return isVirtualUri(uri);
  }
  public static isSupportedFileUri(uri: unknown): boolean {
    return isSupportedFileUri(uri);
  }

  // ----- Depolama (dahili) -----

  private static async readRecents(): Promise<FileInfo[]> {
    let json: string | null = null;
    try {
      json = await AsyncStorage.getItem(STORAGE_KEYS.RECENTS);
    } catch (e) {
      // Boş liste DÖNMEYİZ: çağıranlar bunu "kayıt yok" sanıp üzerine yazar ve favori/etiketleri siler.
      logError('Son dosyalar okunamadı.', e);
      throw e;
    }
    if (!json) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      logError('Son dosyalar kaydı bozuk; yedeklenip sıfırlanıyor.', e);
      try {
        await AsyncStorage.setItem(STORAGE_KEYS.RECENTS_CORRUPT_BACKUP, json);
      } catch { /* yedek yazılamadıysa devam */ }
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const out: FileInfo[] = [];
    for (const item of parsed) {
      const rec = normalizeRecord(item);
      if (rec) out.push(rec);
    }
    return out.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
  }

  private static async writeRecents(list: FileInfo[]): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.RECENTS, JSON.stringify(list));
  }

  /** Favoriler hariç en yeni MAX_RECENT kaydı tutar; favoriler her zaman kalır. */
  private static trimRecents(list: FileInfo[]): FileInfo[] {
    const sorted = [...list].sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
    let nonFav = 0;
    return sorted.filter(f => {
      if (f.isFavorite) return true;
      nonFav++;
      return nonFav <= MAX_RECENT;
    });
  }

  private static isManagedCacheUri(uri: string): boolean {
    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir || !uri.startsWith(cacheDir)) return false;
    const name = uri.slice(cacheDir.length);
    return MANAGED_PREFIXES.some(p => name.startsWith(p));
  }

  private static async deleteManagedCopy(uri: string): Promise<void> {
    try {
      if (this.isManagedCacheUri(uri)) await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch (e) {
      logError('Önbellek kopyası silinemedi.', e);
    }
  }

  /** Hiçbir kayıtta referansı kalmamış (ve yeni olmayan) cache kopyalarını siler. */
  private static async cleanupOrphans(records: FileInfo[]): Promise<void> {
    try {
      const cacheDir = FileSystem.cacheDirectory;
      if (!cacheDir) return;
      const referenced = new Set(records.map(f => f.uri));
      const names = await FileSystem.readDirectoryAsync(cacheDir);
      const now = Date.now();
      for (const name of names) {
        if (!MANAGED_PREFIXES.some(p => name.startsWith(p))) continue;
        const full = cacheDir + name;
        if (referenced.has(full)) continue;
        try {
          const info = await FileSystem.getInfoAsync(full);
          if (info.exists && typeof info.modificationTime === 'number' && now - info.modificationTime * 1000 < ORPHAN_MIN_AGE_MS) continue;
          await FileSystem.deleteAsync(full, { idempotent: true });
        } catch { /* tek dosya hatası temizliği durdurmasın */ }
      }
    } catch (e) {
      logError('Önbellek temizliği başarısız.', e);
    }
  }

  // ----- Kayıt API'si -----

  /** Son dosyalar. Diskte olmayan kayıtlar listelenmez; favoriler `missing: true` ile döner. */
  public static async getRecentFiles(): Promise<FileInfo[]> {
    try {
      const stored = await this.readRecents();
      const checked = await Promise.all(
        stored.map(async (file): Promise<FileInfo | null> => {
          let exists = false;
          try {
            exists = (await FileSystem.getInfoAsync(file.uri)).exists;
          } catch {
            exists = false;
          }
          if (exists) return file;
          return file.isFavorite ? { ...file, missing: true } : null;
        })
      );
      return checked.filter((f): f is FileInfo => f !== null);
    } catch (e) {
      logError('Son dosyalar yüklenemedi.', e);
      return [];
    }
  }

  public static async getFavorites(): Promise<FileInfo[]> {
    const all = await this.getRecentFiles();
    return all.filter(f => f.isFavorite);
  }

  /**
   * Dosyayı son dosyalara yazar. Aynı belge (id / uri / kaynak uri / ad+boyut) varsa kayıt BİRLEŞİR:
   * mevcut id, favori, etiket, lastReadPage ve kullanıcı yeniden adı korunur.
   * Sanal (zip#entry) ve content:// dosyalar yazılmaz → null. Başarıda kaydedilen (birleşmiş) kaydı döndürür.
   */
  public static async saveRecentFile(file: FileInfo): Promise<FileInfo | null> {
    if (!file || !file.uri || file.virtual || isVirtualUri(file.uri) || file.uri.startsWith('content://')) return null;
    try {
      return await this.enqueue(async () => {
        const list = await this.readRecents();
        const matches = list.filter(f => sameDocument(f, file));
        const prev = matches[0];
        const rest = list.filter(f => !sameDocument(f, file));

        const { content: _c, base64: _b, missing: _m, virtual: _v, ...clean } = file;
        void _c; void _b; void _m; void _v;
        const renamed = !!prev && !!prev.originalName && prev.name !== prev.originalName;
        const tags = matches.find(m => m.tags && m.tags.length)?.tags ?? file.tags;
        const lastReadPage = file.lastReadPage ?? matches.find(m => m.lastReadPage !== undefined)?.lastReadPage;
        const record: FileInfo = {
          ...clean,
          id: prev ? prev.id : file.id,
          name: renamed && prev ? prev.name : file.name,
          originalName: file.originalName ?? prev?.originalName ?? file.name,
          isFavorite: matches.some(m => m.isFavorite) || file.isFavorite === true,
          tags,
          lastReadPage,
          lastOpened: Date.now(),
        };

        const trimmed = this.trimRecents([record, ...rest]);
        await this.writeRecents(trimmed);
        await this.cleanupOrphans(trimmed);
        return record;
      });
    } catch (e) {
      logError('Son açılan kaydedilemedi.', e);
      return null;
    }
  }

  /** lastOpened'ı şimdi yapar (kayıt yoksa dokunmaz). */
  public static async touchRecentFile(id: string): Promise<boolean> {
    try {
      return await this.enqueue(async () => {
        const list = await this.readRecents();
        const idx = list.findIndex(f => f.id === id);
        if (idx < 0) return false;
        list[idx] = { ...list[idx], lastOpened: Date.now() };
        await this.writeRecents(list);
        return true;
      });
    } catch (e) {
      logError('Son açılma zamanı güncellenemedi.', e);
      return false;
    }
  }

  /** Favori durumunu tersine çevirir; yeni durumu döndürür (kayıt yoksa false). */
  public static async toggleFavorite(fileId: string): Promise<boolean> {
    try {
      return await this.enqueue(async () => {
        const list = await this.readRecents();
        const idx = list.findIndex(f => f.id === fileId);
        if (idx < 0) return false;
        const next = !list[idx].isFavorite;
        list[idx] = { ...list[idx], isFavorite: next };
        await this.writeRecents(list);
        return next;
      });
    } catch (e) {
      logError('Favori güncellenemedi.', e);
      return false;
    }
  }

  /** Kaydı listeden siler ve cache kopyasını da siler (favori olsa bile; çağıran onay almalıdır). */
  public static async removeRecentFile(id: string): Promise<boolean> {
    try {
      return await this.enqueue(async () => {
        const list = await this.readRecents();
        const target = list.find(f => f.id === id);
        if (!target) return false;
        const remaining = list.filter(f => f.id !== id);
        await this.writeRecents(remaining);
        await this.deleteManagedCopy(target.uri);
        await this.cleanupOrphans(remaining);
        return true;
      });
    } catch (e) {
      logError('Kayıt silinemedi.', e);
      return false;
    }
  }

  /** Görünen adı değiştirir (dosyanın diskteki adı ve uzantısı değişmez). Başarıda güncel kaydı döndürür. */
  public static async renameRecentFile(id: string, newName: string): Promise<FileInfo | null> {
    const name = sanitizeDisplayName(newName);
    if (!name) return null;
    try {
      return await this.enqueue(async () => {
        const list = await this.readRecents();
        const idx = list.findIndex(f => f.id === id);
        if (idx < 0) return null;
        const prev = list[idx];
        list[idx] = { ...prev, name, originalName: prev.originalName ?? prev.name };
        await this.writeRecents(list);
        return list[idx];
      });
    } catch (e) {
      logError('Ad değiştirilemedi.', e);
      return null;
    }
  }

  /** Geçmişi temizler. keepFavorites (varsayılan true) iken favoriler (etiket/okuma sayfası dahil) ve kopyaları korunur. Silinen kayıt sayısını döndürür. */
  public static async clearRecentFiles(options: { keepFavorites?: boolean } = {}): Promise<number> {
    const keepFavorites = options.keepFavorites !== false;
    try {
      return await this.enqueue(async () => {
        const list = await this.readRecents();
        const kept = keepFavorites ? list.filter(f => f.isFavorite) : [];
        const removed = list.filter(f => !kept.includes(f));
        await this.writeRecents(kept);
        for (const f of removed) await this.deleteManagedCopy(f.uri);
        await this.cleanupOrphans(kept);
        return removed.length;
      });
    } catch (e) {
      logError('Geçmiş temizlenemedi.', e);
      return 0;
    }
  }

  /**
   * Yönetilen cache kopyalarını siler. keepFavorites (varsayılan true) iken favori kayıtların kopyaları ve kayıtları korunur;
   * diğer kayıtlar (kopyası silindiği için) listeden çıkar. Hata durumunda atar (çağıran uyarı gösterir).
   */
  public static async clearManagedCache(options: { keepFavorites?: boolean } = {}): Promise<void> {
    const keepFavorites = options.keepFavorites !== false;
    await this.enqueue(async () => {
      const cacheDir = FileSystem.cacheDirectory;
      if (!cacheDir) throw new Error(t('io.cacheDirFail'));
      const list = await this.readRecents();
      const protectedUris = new Set(keepFavorites ? list.filter(f => f.isFavorite).map(f => f.uri) : []);
      const names = await FileSystem.readDirectoryAsync(cacheDir);
      const deletedUris = new Set<string>();
      for (const name of names) {
        if (!MANAGED_PREFIXES.some(p => name.startsWith(p))) continue;
        const full = cacheDir + name;
        if (protectedUris.has(full)) continue;
        await FileSystem.deleteAsync(full, { idempotent: true });
        deletedUris.add(full);
      }
      // Sistem/diğer modüllerin bıraktığı geçici alt dizinler (paylaşım kopyaları, belge seçici, yazdırma çıktıları)
      for (const sub of ['share/', 'DocumentPicker/', 'Print/']) {
        try { await FileSystem.deleteAsync(cacheDir + sub, { idempotent: true }); } catch { /* yoksa sorun değil */ }
      }
      const remaining = list.filter(f => !deletedUris.has(f.uri));
      await this.writeRecents(remaining);
    });
  }

  /** Son okunan sayfa (PDF/EPUB). Değer değişmediyse yazmaz. */
  public static async updateLastReadPage(fileId: string, page: number): Promise<void> {
    if (typeof page !== 'number' || !isFinite(page) || page < 0) return;
    try {
      await this.enqueue(async () => {
        const list = await this.readRecents();
        const idx = list.findIndex(f => f.id === fileId);
        if (idx < 0 || list[idx].lastReadPage === page) return;
        list[idx] = { ...list[idx], lastReadPage: page };
        await this.writeRecents(list);
      });
    } catch (e) {
      logError('Sayfa kaydedilemedi.', e);
    }
  }

  /** Etiketleri günceller (kırpılır, tekilleştirilir, en çok 20). */
  public static async updateTags(fileId: string, tags: string[]): Promise<void> {
    const clean = Array.from(new Set(tags.map(t => String(t).trim()).filter(Boolean).map(t => t.slice(0, 30)))).slice(0, MAX_TAGS);
    try {
      await this.enqueue(async () => {
        const list = await this.readRecents();
        const idx = list.findIndex(f => f.id === fileId);
        if (idx < 0) return;
        list[idx] = { ...list[idx], tags: clean };
        await this.writeRecents(list);
      });
    } catch (e) {
      logError('Etiketler güncellenemedi.', e);
    }
  }

  // ----- Dosya içeriği kaydetme -----

  /** Düzenlenen metni dosyaya (UTF-8) yazar ve kaydı günceller. Sanal / file:// olmayan hedefe yazmaz. */
  public static async saveFileContent(file: FileInfo, newContent: string): Promise<boolean> {
    try {
      if (!file.uri || !file.uri.startsWith('file://') || isVirtualUri(file.uri)) return false;
      await FileSystem.writeAsStringAsync(file.uri, newContent, { encoding: FileSystem.EncodingType.UTF8 });
      await this.saveRecentFile({ ...file, size: utf8ByteLength(newContent) });
      return true;
    } catch (err) {
      logError('Dosya kaydetme hatası.', err);
      return false;
    }
  }

  // ----- İçe aktarma (picker + gelen intent) -----

  private static async readHeader(uri: string): Promise<number[] | null> {
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64, length: 16, position: 0 });
      const bytes = base64ToBytes(b64);
      return bytes.length ? bytes : null;
    } catch {
      return null;
    }
  }

  private static async sniffZipKind(uri: string, size: number): Promise<DetectedType> {
    const fallback: DetectedType = { category: 'archive', extension: 'zip' };
    if (size > MAX_ZIP_SNIFF_BYTES) return fallback;
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const JSZipLib = require('jszip');
      const zip = await JSZipLib.loadAsync(b64, { base64: true });
      return classifyZipNames(Object.keys(zip.files));
    } catch {
      return fallback;
    }
  }

  private static async importDocument(opts: {
    sourceUri: string;
    displayName: string;
    mimeType?: string;
    knownSize?: number;
    prefix: 'tdesk_' | 'intent_';
    copyAlways: boolean;
    description?: string;
    altSourceUri?: string;
  }): Promise<FileInfo | null> {
    const { sourceUri, mimeType, prefix } = opts;
    let displayName = opts.displayName;
    const isContent = sourceUri.startsWith('content://');
    let size = opts.knownSize && opts.knownSize > 0 ? opts.knownSize : 0;

    try {
      const info = await FileSystem.getInfoAsync(sourceUri);
      if (!info.exists && !isContent) {
        Alert.alert(t('common.fileNotFound'), t('file.notAccessible'));
        return null;
      }
      if (info.exists && !size && info.size) size = info.size;
    } catch {
      // Bazı sağlayıcılar meta veri vermez; kopyalamayı yine deneriz.
    }

    let uri = sourceUri;
    const cacheDir = FileSystem.cacheDirectory;
    const wantCopy = (opts.copyAlways || isContent) && (size === 0 || size <= MAX_COPY_BYTES);
    if (wantCopy && cacheDir) {
      const target = `${cacheDir}${prefix}${Date.now()}_${toCacheFileName(displayName)}`;
      const sources = [sourceUri];
      if (opts.altSourceUri && opts.altSourceUri !== sourceUri) sources.push(opts.altSourceUri);
      for (const from of sources) {
        try {
          await FileSystem.copyAsync({ from, to: target });
          uri = target;
          break;
        } catch (e) {
          logError('Dosya önbelleğe kopyalanamadı.', e);
          try { await FileSystem.deleteAsync(target, { idempotent: true }); } catch { /* kısmi kopya temizliği */ }
        }
      }
    } else if (wantCopy && !cacheDir) {
      logError('Önbellek dizini yok; kopyalama atlandı.');
    }

    if (uri !== sourceUri || !size) {
      try {
        const real = await FileSystem.getInfoAsync(uri);
        if (real.exists && typeof real.size === 'number' && (uri !== sourceUri || real.size > 0)) size = real.size;
      } catch { /* boyut belirlenemedi */ }
    }

    let detected = detectFileTypeDetailed(displayName, mimeType);
    const header = await this.readHeader(uri);
    let resolved: ReconcileResult = reconcileWithMagic(detected, detectMagic(header || []), mimeType);
    if (resolved.needsZip) {
      const zipKind = await this.sniffZipKind(uri, size);
      resolved = { ...zipKind };
    }
    detected = resolved;

    let extension = detected.extension;
    if (!extension) extension = extensionFromMime(mimeType);
    if (!getExtension(displayName) && extension) displayName = `${displayName}.${extension}`;
    const category = detected.category;
    // Mime/magic ile uzantı tamamlandıysa ve kategori hâlâ 'unknown' ise ad üzerinden yeniden dene
    const finalCategory: FileType = category === 'unknown' && extension ? detectFileTypeDetailed(displayName, mimeType).category : category;

    const info: FileInfo = {
      id: `${prefix === 'intent_' ? 'intent' : 'pick'}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name: displayName,
      originalName: displayName,
      uri,
      sourceUri,
      size,
      mimeType,
      extension,
      category: finalCategory,
      lastOpened: Date.now(),
      isFavorite: false,
      description: opts.description,
    };
    if (finalCategory === 'unsupported') {
      info.unsupportedReason = detected.unsupportedReason || detectFileTypeDetailed(displayName, mimeType).unsupportedReason || GENERIC_UNSUPPORTED_REASON;
    }
    if (isVirtualUri(uri)) info.virtual = true;

    const saved = await this.saveRecentFile(info);
    return saved ? { ...saved, content: undefined } : info;
  }

  /**
   * Harici uygulamalardan (WhatsApp, Telegram, Dosya Yöneticisi) gelen URI'ları karşılar.
   * Yalnız file:// ve content:// kabul edilir; diğer şemalar sessizce null döner.
   */
  public static async handleIncomingUri(rawUri: string): Promise<FileInfo | null> {
    try {
      const raw = typeof rawUri === 'string' ? rawUri.trim() : '';
      if (!raw) return null;
      if (!isSupportedFileUri(raw)) {
        devLog('Desteklenmeyen URI şeması yok sayıldı.');
        return null;
      }
      const decoded = safeDecodeURI(raw);
      const result = await this.importDocument({
        sourceUri: raw,
        displayName: deriveDisplayName(raw),
        prefix: 'intent_',
        copyAlways: false,
        description: makeRef('file.fromExternal'),
        altSourceUri: decoded !== raw ? decoded : undefined,
      });
      return result;
    } catch (err) {
      logError('Gelen dosya işlenemedi.', err);
      Alert.alert(t('app.incomingFailTitle'), t('app.incomingFailBody'));
      return null;
    }
  }

  /** Cihazdan dosya seçtirir. İptal → null (hata değil); hata → uyarı gösterilir ve null döner. */
  public static async pickDocument(): Promise<FileInfo | null> {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: false, // kopyalamayı kendimiz yaparız
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return null;

      const asset = result.assets[0];
      if (!isSupportedFileUri(asset.uri)) {
        Alert.alert(t('app.incomingFailTitle'), t('file.locationUnsupported'));
        return null;
      }
      const displayName = sanitizeDisplayName(asset.name || '') || deriveDisplayName(asset.uri);
      return await this.importDocument({
        sourceUri: asset.uri,
        displayName,
        mimeType: asset.mimeType || undefined,
        knownSize: asset.size || 0,
        prefix: 'tdesk_',
        copyAlways: true,
      });
    } catch (error) {
      logError('Dosya seçme hatası.', error);
      Alert.alert(t('file.pickFailTitle'), t('file.pickFailBody'));
      return null;
    }
  }

  // ----- Paylaşım / yazdırma -----

  /** Paylaşım penceresini açar. Başarıda true; başarısızlıkta kullanıcıya uyarı gösterip false döner. */
  private static sharing = false;

  public static async shareFile(file: FileInfo): Promise<boolean> {
    // Çift dokunuş: ikinci çağrı expo-sharing'de "SharingInProgress" hatası verip yanlış uyarı çıkarıyordu.
    if (this.sharing) return false;
    this.sharing = true;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(t('share.unavailableTitle'), t('share.unavailableBody'));
        return false;
      }
      const cacheDir = FileSystem.cacheDirectory;
      const ext = file.extension || getExtension(file.name);
      const mimeType = file.mimeType || guessMimeType(file.name) || (ext ? guessMimeType(ext) : undefined);
      const dialogTitle = file.name ? t('share.dialogTitle', { name: file.name }) : t('common.share');
      let uri = file.uri;

      // Alıcı uygulamanın "tdesk_<sayı>_..." öneki yerine gerçek dosya adını görmesi için her zaman
      // cache/share/<zaman>/<gerçek ad> altına bir kopya paylaşılır (sanal/örnek/content:// dosyalar zaten kopya ister).
      if (!cacheDir) {
        Alert.alert(t('common.shareFailTitle'), t('share.tempDirFail'));
        return false;
      }
      const shareRoot = `${cacheDir}share/`;
      try { await FileSystem.deleteAsync(shareRoot, { idempotent: true }); } catch { /* eski paylaşım kopyaları */ }
      const dir = `${shareRoot}${Date.now()}/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      let shareName = String(file.originalName || file.name || 'belge').replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').trim().slice(0, 120) || 'belge';
      if (ext && !shareName.toLowerCase().endsWith(`.${ext.toLowerCase()}`) && !/\.[A-Za-z0-9]{1,8}$/.test(shareName)) shareName += `.${ext}`;
      const tempPath = `${dir}${encodeURIComponent(shareName).replace(/%2F/g, '_')}`;
      if (!file.isSample && !isVirtualUri(uri) && (uri.startsWith('content://') || uri.startsWith('file://'))) {
        await FileSystem.copyAsync({ from: uri, to: tempPath });
      } else if (typeof file.content === 'string') {
        await FileSystem.writeAsStringAsync(tempPath, file.content, { encoding: FileSystem.EncodingType.UTF8 });
      } else if (typeof file.base64 === 'string') {
        await FileSystem.writeAsStringAsync(tempPath, file.base64, { encoding: FileSystem.EncodingType.Base64 });
      } else if (!isVirtualUri(uri) && !uri.startsWith('content://')) {
        await FileSystem.copyAsync({ from: uri, to: tempPath });
      } else {
        Alert.alert(t('common.shareFailTitle'), t('share.notStandalone'));
        return false;
      }
      uri = tempPath;
      await Sharing.shareAsync(uri, { mimeType, dialogTitle });
      return true;
    } catch (e) {
      logError('Paylaşım hatası.', e);
      Alert.alert(t('common.shareFailTitle'), t('share.fail'));
      return false;
    } finally {
      this.sharing = false;
    }
  }

  /**
   * Dosyanın gerçek adıyla geçici bir kopyasını (cache/export/<zaman>/<ad>) yazar ve file:// yolunu döndürür; yapılamazsa null.
   * T-Bridge'e gönderme / sunum için kullanılır (alıcı doğru dosya adını görsün).
   */
  public static async exportCopy(file: FileInfo): Promise<string | null> {
    try {
      const cacheDir = FileSystem.cacheDirectory;
      if (!cacheDir) return null;
      const ext = file.extension || getExtension(file.name);
      const root = `${cacheDir}export/`;
      const exportTtlMs = 60 * 60 * 1000; // 1 saatten eski dışa aktarma kopyaları silinir
      try {
        const names = await FileSystem.readDirectoryAsync(root);
        const now = Date.now();
        for (const name of names) {
          try {
            const full = `${root}${name}`;
            const info = await FileSystem.getInfoAsync(full);
            if (info.exists && typeof info.modificationTime === 'number' && now - info.modificationTime * 1000 < exportTtlMs) continue;
            await FileSystem.deleteAsync(full, { idempotent: true });
          } catch { /* tek öğe hatası temizliği durdurmasın */ }
        }
      } catch { /* eski kopyalar */ }
      const dir = `${root}${Date.now()}/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      let name = String(file.originalName || file.name || 'belge').replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').trim().slice(0, 120) || 'belge';
      if (ext && !name.toLowerCase().endsWith(`.${ext.toLowerCase()}`) && !/\.[A-Za-z0-9]{1,8}$/.test(name)) name += `.${ext}`;
      const dest = `${dir}${name}`;
      const uri = file.uri;
      if (!file.isSample && !isVirtualUri(uri) && (uri.startsWith('content://') || uri.startsWith('file://'))) {
        await FileSystem.copyAsync({ from: uri, to: dest });
      } else if (typeof file.content === 'string') {
        await FileSystem.writeAsStringAsync(dest, file.content, { encoding: FileSystem.EncodingType.UTF8 });
      } else if (typeof file.base64 === 'string') {
        await FileSystem.writeAsStringAsync(dest, file.base64, { encoding: FileSystem.EncodingType.Base64 });
      } else if (!isVirtualUri(uri) && !uri.startsWith('content://')) {
        await FileSystem.copyAsync({ from: uri, to: dest });
      } else {
        return null;
      }
      return dest;
    } catch (e) {
      logError('Dışa aktarma kopyası hatası.', e);
      return null;
    }
  }

  /** Yazdırma (Print Service) entegrasyonu. */
  public static async printDocument(_title: string, htmlContent: string): Promise<void> {
    try {
      await Print.printAsync({ html: htmlContent });
    } catch (e) {
      logError('Yazdırma hatası.', e);
    }
  }
}
