// Metin kodlama yardımcıları (Hermes'te TextDecoder'a güvenmez; her şey elle yazılmıştır).
// - decodeTextBytes: BOM sil + UTF-8 doğrula; geçersizse windows-1254 (Türkçe) olarak çöz.
// - readTextFileSmart: dosyayı Base64 okuyup yukarıdakini uygular.
// - encodeTextBytes: kaydederken orijinal kodlamayı koru (bozulma/kalıcı veri kaybı yok).
// Ayrıca CodeViewer/TextViewer/SpreadsheetViewer'ın paylaştığı küçük saf metin yardımcıları.
import * as FileSystem from 'expo-file-system';
import { formatSize } from '../i18n';

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1254';
export type EolStyle = 'lf' | 'crlf' | 'cr';

export interface DecodedText {
  /** BOM'suz, orijinal satır sonlarıyla çözülmüş metin */
  text: string;
  encoding: TextEncodingName;
  hadBom: boolean;
  /** Metinde U+FFFD (okunamayan karakter) var mı */
  hadReplacementChars: boolean;
  eol: EolStyle;
  byteLength: number;
}

export type TextReadErrorCode = 'not_found' | 'too_large' | 'binary' | 'read_failed';

export class TextReadError extends Error {
  code: TextReadErrorCode;
  size?: number;
  constructor(code: TextReadErrorCode, message?: string, size?: number) {
    super(message || code);
    this.name = 'TextReadError';
    this.code = code;
    this.size = size;
  }
}

export const DEFAULT_MAX_TEXT_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------- Base64

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Int16Array = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t['-'.charCodeAt(0)] = 62; // url-safe
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

export function base64ToBytes(b64: string): Uint8Array {
  // boşluk/satır sonu ve '=' dolgusunu yok say
  let clean = 0;
  for (let i = 0; i < b64.length; i++) {
    const c = b64.charCodeAt(i);
    if (c < 256 && B64_LOOKUP[c] >= 0) clean++;
  }
  const out = new Uint8Array(Math.floor((clean * 6) / 8));
  let buf = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < b64.length; i++) {
    const c = b64.charCodeAt(i);
    const v = c < 256 ? B64_LOOKUP[c] : -1;
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 255;
      buf &= (1 << bits) - 1;
    }
  }
  return o === out.length ? out : out.subarray(0, o);
}

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const n = bytes.length;
  let chunk = '';
  for (let i = 0; i < n; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < n ? bytes[i + 1] : 0;
    const b2 = i + 2 < n ? bytes[i + 2] : 0;
    chunk += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)];
    chunk += i + 1 < n ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    chunk += i + 2 < n ? B64[b2 & 63] : '=';
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = '';
    }
  }
  parts.push(chunk);
  return parts.join('');
}

// ---------------------------------------------------------------- windows-1254

// 0x80-0x9F (windows-1254). Tanımsız baytlar WHATWG gibi aynı C1 kod noktasına eşlenir.
const CP1254_80_9F: number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x008e, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x009e, 0x0178,
];

// 0xA0-0xFF: Latin-1 ile aynı, yalnızca Türkçe harfler farklı.
const CP1254_TURKISH_OVERRIDES: Record<number, number> = {
  0xd0: 0x011e, // Ğ
  0xdd: 0x0130, // İ
  0xde: 0x015e, // Ş
  0xf0: 0x011f, // ğ
  0xfd: 0x0131, // ı
  0xfe: 0x015f, // ş
};

const CP1254_TABLE: Uint16Array = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 0x80; i++) t[i] = i;
  for (let i = 0; i < 32; i++) t[0x80 + i] = CP1254_80_9F[i];
  for (let i = 0xa0; i < 256; i++) t[i] = CP1254_TURKISH_OVERRIDES[i] !== undefined ? CP1254_TURKISH_OVERRIDES[i] : i;
  return t;
})();

const CP1254_REVERSE: Map<number, number> = (() => {
  const m = new Map<number, number>();
  for (let i = 0; i < 256; i++) m.set(CP1254_TABLE[i], i);
  return m;
})();

// ---------------------------------------------------------------- yardımcılar

const FLUSH = 8192;

function codeUnitsToString(units: number[], out: string[]) {
  out.push(String.fromCharCode.apply(null, units as unknown as number[]));
  units.length = 0;
}

/** NUL bayt (UTF-16 BOM'u yoksa) -> büyük olasılıkla ikili dosya */
export function isLikelyBinary(bytes: Uint8Array): boolean {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    return false;
  }
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

/** Katı UTF-8 çözümü; geçersiz dizide null döner. */
function decodeUtf8Strict(bytes: Uint8Array, start: number): string | null {
  const n = bytes.length;
  const parts: string[] = [];
  const units: number[] = [];
  let i = start;
  while (i < n) {
    const b = bytes[i];
    if (b < 0x80) {
      units.push(b);
      i++;
    } else if (b >= 0xc2 && b <= 0xdf) {
      if (i + 1 >= n) return null;
      const b1 = bytes[i + 1];
      if ((b1 & 0xc0) !== 0x80) return null;
      units.push(((b & 0x1f) << 6) | (b1 & 0x3f));
      i += 2;
    } else if (b >= 0xe0 && b <= 0xef) {
      if (i + 2 >= n) return null;
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) return null;
      if (b === 0xe0 && b1 < 0xa0) return null; // aşırı uzun
      if (b === 0xed && b1 >= 0xa0) return null; // vekil (surrogate)
      units.push(((b & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
      i += 3;
    } else if (b >= 0xf0 && b <= 0xf4) {
      if (i + 3 >= n) return null;
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      const b3 = bytes[i + 3];
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) return null;
      if (b === 0xf0 && b1 < 0x90) return null;
      if (b === 0xf4 && b1 > 0x8f) return null;
      const cp = ((b & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      const c = cp - 0x10000;
      units.push(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
      i += 4;
    } else {
      return null;
    }
    if (units.length >= FLUSH) codeUnitsToString(units, parts);
  }
  if (units.length) codeUnitsToString(units, parts);
  return parts.join('');
}

function decodeCp1254(bytes: Uint8Array, start: number): string {
  const parts: string[] = [];
  const units: number[] = [];
  for (let i = start; i < bytes.length; i++) {
    units.push(CP1254_TABLE[bytes[i]]);
    if (units.length >= FLUSH) codeUnitsToString(units, parts);
  }
  if (units.length) codeUnitsToString(units, parts);
  return parts.join('');
}

function decodeUtf16(bytes: Uint8Array, start: number, littleEndian: boolean): string {
  const parts: string[] = [];
  const units: number[] = [];
  for (let i = start; i + 1 < bytes.length; i += 2) {
    units.push(littleEndian ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
    if (units.length >= FLUSH) codeUnitsToString(units, parts);
  }
  if (units.length) codeUnitsToString(units, parts);
  return parts.join('');
}

export function detectEol(text: string): EolStyle {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  const limit = Math.min(text.length, 200000);
  for (let i = 0; i < limit; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else cr++;
    } else if (c === 10) lf++;
  }
  if (crlf > 0 && crlf >= lf && crlf >= cr) return 'crlf';
  if (cr > lf && cr > crlf) return 'cr';
  return 'lf';
}

/**
 * Bayt dizisini metne çevirir.
 * Sıra: UTF-8/UTF-16 BOM -> BOM'suz katı UTF-8 -> windows-1254 (Türkçe) yedek çözümü.
 */
export function decodeTextBytes(input: Uint8Array | ArrayLike<number>): DecodedText {
  const bytes = input instanceof Uint8Array ? input : Uint8Array.from(input as ArrayLike<number>);
  let encoding: TextEncodingName = 'utf-8';
  let hadBom = false;
  let text: string;

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    hadBom = true;
    const t = decodeUtf8Strict(bytes, 3);
    if (t === null) {
      encoding = 'windows-1254';
      text = decodeCp1254(bytes, 3);
    } else text = t;
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    hadBom = true;
    encoding = 'utf-16le';
    text = decodeUtf16(bytes, 2, true);
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    hadBom = true;
    encoding = 'utf-16be';
    text = decodeUtf16(bytes, 2, false);
  } else {
    const t = decodeUtf8Strict(bytes, 0);
    if (t === null) {
      encoding = 'windows-1254';
      text = decodeCp1254(bytes, 0);
    } else text = t;
  }

  return {
    text,
    encoding,
    hadBom,
    hadReplacementChars: text.indexOf('�') >= 0,
    eol: detectEol(text),
    byteLength: bytes.length,
  };
}

// ---------------------------------------------------------------- kodlama (kaydetme)

function encodeUtf8(text: string): { bytes: Uint8Array; lossless: boolean } {
  const out: number[] = [];
  let lossless = true;
  const chunks: Uint8Array[] = [];
  const flush = () => {
    chunks.push(Uint8Array.from(out));
    out.length = 0;
  };
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      } else {
        c = 0xfffd;
        lossless = false;
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      c = 0xfffd;
      lossless = false;
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    if (out.length >= 65536) flush();
  }
  flush();
  let total = 0;
  for (const c of chunks) total += c.length;
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.length;
  }
  return { bytes, lossless };
}

/**
 * Metni verilen kodlamada bayt dizisine çevirir.
 * lossless=false: kodlamada temsil edilemeyen karakter var (örn. windows-1254'e '→' yazılamaz);
 * bu durumda çağıran UTF-8'e geçmeyi onaylatmalıdır.
 */
export function encodeTextBytes(
  text: string,
  encoding: TextEncodingName = 'utf-8',
  withBom = false
): { bytes: Uint8Array; lossless: boolean } {
  if (encoding === 'utf-8') {
    const r = encodeUtf8(text);
    if (!withBom) return r;
    const bytes = new Uint8Array(r.bytes.length + 3);
    bytes.set([0xef, 0xbb, 0xbf], 0);
    bytes.set(r.bytes, 3);
    return { bytes, lossless: r.lossless };
  }
  if (encoding === 'windows-1254') {
    const bytes = new Uint8Array(text.length);
    let lossless = true;
    for (let i = 0; i < text.length; i++) {
      const b = CP1254_REVERSE.get(text.charCodeAt(i));
      if (b === undefined) {
        bytes[i] = 0x3f; // '?'
        lossless = false;
      } else bytes[i] = b;
    }
    return { bytes, lossless };
  }
  // UTF-16: her zaman BOM'lu yaz
  const le = encoding === 'utf-16le';
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = le ? 0xff : 0xfe;
  bytes[1] = le ? 0xfe : 0xff;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (le) {
      bytes[2 + i * 2] = c & 255;
      bytes[3 + i * 2] = c >> 8;
    } else {
      bytes[2 + i * 2] = c >> 8;
      bytes[3 + i * 2] = c & 255;
    }
  }
  return { bytes, lossless: true };
}

// ---------------------------------------------------------------- dosya okuma

/**
 * Dosyayı Base64 olarak okuyup akıllı kodlamayla metne çevirir (expo-file-system legacy API).
 * @throws TextReadError  not_found | too_large | binary | read_failed
 */
export async function readTextFileSmart(
  uri: string,
  opts: { maxBytes?: number; allowBinary?: boolean } = {}
): Promise<DecodedText> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_TEXT_BYTES;

  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) throw new TextReadError('not_found');
    if (typeof info.size === 'number' && info.size > maxBytes) {
      throw new TextReadError('too_large', undefined, info.size);
    }
  } catch (e) {
    if (e instanceof TextReadError) throw e;
    // content:// gibi durumlarda getInfoAsync başarısız olabilir; okumayı yine de dene.
  }

  let b64: string;
  try {
    // length+position birlikte verilmeli; maxBytes+1 okuyup aşımı yakalarız (boyutu yanlış bildiren kaynaklar için).
    b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: maxBytes + 1,
    });
  } catch (e) {
    throw new TextReadError('read_failed', e instanceof Error ? e.message : String(e));
  }

  const bytes = base64ToBytes(b64);
  if (bytes.length > maxBytes) throw new TextReadError('too_large', undefined, bytes.length);
  if (!opts.allowBinary && isLikelyBinary(bytes)) throw new TextReadError('binary');
  return decodeTextBytes(bytes);
}

export interface ViewerTextSource {
  uri: string;
  content?: string;
}

/**
 * Görüntüleyiciler için ortak yükleyici.
 * - file.content (ViewerScreen'in UTF-8 okuması, arşiv içi sanal dosya) varsa ve bozulmamışsa onu kullanır.
 * - İçerikte U+FFFD varsa (yanlış kodlama) ve dosya gerçek bir URI ise baştan akıllı okur.
 * - İçerik yoksa akıllı okur.
 */
export async function loadViewerText(
  file: ViewerTextSource,
  opts: { maxBytes?: number } = {}
): Promise<DecodedText> {
  const given = typeof file.content === 'string' && file.content.length > 0 ? file.content : null;
  if (given !== null) {
    let text = given;
    let hadBom = false;
    if (text.charCodeAt(0) === 0xfeff) {
      hadBom = true;
      text = text.slice(1);
    }
    const damaged = text.indexOf('�') >= 0;
    if (!damaged || isVirtualTextUri(file.uri)) {
      return {
        text,
        encoding: 'utf-8',
        hadBom,
        hadReplacementChars: damaged,
        eol: detectEol(text),
        byteLength: text.length,
      };
    }
    try {
      return await readTextFileSmart(file.uri, opts);
    } catch {
      return {
        text,
        encoding: 'utf-8',
        hadBom,
        hadReplacementChars: true,
        eol: detectEol(text),
        byteLength: text.length,
      };
    }
  }
  return readTextFileSmart(file.uri, opts);
}

/** Arşiv içi / gerçek dosya olmayan URI mı? (yazılamaz, yeniden okunamaz) */
export function isVirtualTextUri(uri: string): boolean {
  return !uri || uri.indexOf('#') >= 0 || !/^file:\/\//i.test(uri);
}

// ---------------------------------------------------------------- saf metin yardımcıları

export function normalizeNewlines(text: string): string {
  return text.indexOf('\r') >= 0 ? text.replace(/\r\n?/g, '\n') : text;
}

export function applyEol(text: string, eol: EolStyle): string {
  if (eol === 'lf') return text;
  return text.replace(/\n/g, eol === 'crlf' ? '\r\n' : '\r');
}

/** Arama için katlama: uzunluğu KORUR (indeksler eşleşir); Türkçe İ/ı/I -> i. */
export function foldForSearch(s: string): string {
  return s.replace(/[İıI]/g, 'i').toLowerCase();
}

export interface LineMatch {
  line: number; // 0 tabanlı satır indeksi
  start: number; // satır içi başlangıç
  length: number;
}

/** Satırlarda (büyük/küçük harf ve Türkçe i duyarsız) tüm eşleşmeleri bulur; en fazla `max` döner. */
export function findMatches(
  lines: readonly string[],
  query: string,
  max = 5000
): { matches: LineMatch[]; truncated: boolean } {
  const matches: LineMatch[] = [];
  const q = foldForSearch(query);
  if (!q) return { matches, truncated: false };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < q.length) continue;
    const hay = foldForSearch(line);
    let from = 0;
    for (;;) {
      const idx = hay.indexOf(q, from);
      if (idx < 0) break;
      matches.push({ line: i, start: idx, length: q.length });
      if (matches.length >= max) return { matches, truncated: true };
      from = idx + Math.max(1, q.length);
    }
  }
  return { matches, truncated: false };
}

export function formatBytes(n: number): string {
  return formatSize(n);
}

export function encodingLabel(e: TextEncodingName): string {
  switch (e) {
    case 'windows-1254':
      return 'Windows-1254';
    case 'utf-16le':
      return 'UTF-16 LE';
    case 'utf-16be':
      return 'UTF-16 BE';
    default:
      return 'UTF-8';
  }
}
