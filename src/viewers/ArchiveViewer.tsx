import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import JSZip from 'jszip';
import * as FileSystem from 'expo-file-system';
import { FileInfo, AppThemeMode, FileType } from '../types';
import { Colors } from '../theme/colors';
import { FormatBadge } from '../components/FormatBadge';
import { FileService, getBaseName, getExtension, toCacheFileName, base64ToBytes } from '../services/fileService';
import { DEFAULT_MAX_TEXT_BYTES, decodeTextBytes, isLikelyBinary } from '../utils/textEncoding';
import { t, makeRef, formatDateParts } from '../i18n';

interface ArchiveViewerProps {
  file: FileInfo;
  appTheme?: AppThemeMode;
  onOpenNestedFile?: (file: FileInfo) => void;
}

interface ArchiveEntry {
  /** Temizlenmiş görüntü yolu (klasör ayracı '/'), sondaki '/' yok. */
  path: string;
  /** Üst klasör yolu ('' = kök). */
  dir: string;
  name: string;
  /** JSZip içindeki özgün anahtar (dosya çıkarmak için). */
  sourcePath: string;
  size: number;
  date: string;
  type: FileType;
  unsafe: boolean;
}

type Row =
  | { kind: 'up'; key: string }
  | { kind: 'dir'; key: string; name: string; path: string; count: number }
  | { kind: 'file'; key: string; entry: ArchiveEntry; showPath: boolean };

// ---------------------------------------------------------------------------
// Sınırlar
// ---------------------------------------------------------------------------
const MAX_ARCHIVE_BYTES = 60 * 1024 * 1024; // arşivin kendisi
const MAX_ENTRY_BYTES = 50 * 1024 * 1024; // tek öğe
const MAX_ENTRIES = 20000; // listelenecek öğe sayısı
const MAX_SEARCH_RESULTS = 1000;
const ROW_HEIGHT = 60;
const ROW_STRIDE = ROW_HEIGHT + 8;

// @@PURE-START (JSZip/React/RN bağımlılığı olmayan saf mantık; node testi bu bölümü çıkarıp çalıştırır)
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const CP857_HIGH =
  'ÇüéâäàåçêëèïîıÄÅÉæÆôöòûùİÖÜø£ØŞşáíóúñÑĞğ¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ºªÊËÈ�ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµ�×ÚÛÙìÿ¯´­±�¾¶§÷¸°¨·¹³²■ ';

/** Katı UTF-8 çözümü; geçersiz dizide null döner. */
function tryDecodeUtf8(bytes: ArrayLike<number>): string | null {
  let out = '';
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i++;
      continue;
    }
    let need = 0;
    let cp = 0;
    let min = 0;
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
      cp = b & 0x1f;
      min = 0x80;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      cp = b & 0x0f;
      min = 0x800;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      cp = b & 0x07;
      min = 0x10000;
    } else {
      return null;
    }
    if (i + need >= n) return null;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}

/** ZIP'te UTF-8 bayrağı olmayan ad baytları: UTF-8 -> CP857 (Türkçe DOS) -> Windows-1254 -> CP437. */
function decodeZipNameBytes(bytes: ArrayLike<number>): string {
  let ascii = true;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  const utf = tryDecodeUtf8(bytes);
  if (utf !== null) return utf;

  let has857 = false;
  let has1254 = false;
  let hasMid = false;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x8d || b === 0x98 || b === 0x9e || b === 0x9f || b === 0xa6 || b === 0xa7) has857 = true;
    if (b === 0xd0 || b === 0xdd || b === 0xde || b === 0xf0 || b === 0xfd || b === 0xfe) has1254 = true;
    if (b >= 0x80 && b <= 0xbf) hasMid = true;
  }
  let s = '';
  if (has857) {
    for (let i = 0; i < bytes.length; i++) s += bytes[i] < 0x80 ? String.fromCharCode(bytes[i]) : CP857_HIGH[bytes[i] - 0x80];
    return s;
  }
  if (has1254 && !hasMid) {
    const map: Record<number, string> = { 0xd0: 'Ğ', 0xdd: 'İ', 0xde: 'Ş', 0xf0: 'ğ', 0xfd: 'ı', 0xfe: 'ş' };
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      s += map[b] !== undefined ? map[b] : String.fromCharCode(b);
    }
    return s;
  }
  for (let i = 0; i < bytes.length; i++) s += bytes[i] < 0x80 ? String.fromCharCode(bytes[i]) : CP437_HIGH[bytes[i] - 0x80];
  return s;
}

interface SafePath {
  path: string;
  dir: boolean;
  /** Mutlak yol, '..', sürücü harfi veya kontrol karakteri temizlendi mi */
  changed: boolean;
}

/** Zip-Slip savunması: yolu normalize eder; '..', mutlak yol, sürücü harfi ve kontrol karakterlerini atar. */
function sanitizeZipPath(raw: string): SafePath {
  const p = String(raw).replace(/\\/g, '/');
  const dir = p.endsWith('/');
  let changed = p.startsWith('/');
  const out: string[] = [];
  const parts = p.split('/');
  for (let i = 0; i < parts.length; i++) {
    let seg = parts[i];
    // eslint-disable-next-line no-control-regex
    const cleaned = seg.replace(/[\u0000-\u001f\u007f]/g, '');
    if (cleaned !== seg) changed = true;
    seg = cleaned;
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      changed = true;
      continue;
    }
    if (out.length === 0 && /^[A-Za-z]:$/.test(seg)) {
      changed = true;
      continue;
    }
    out.push(seg);
  }
  return { path: out.join('/'), dir, changed };
}

type ArchiveKind = 'zip' | 'rar' | '7z' | 'gzip' | 'bzip2' | 'xz' | 'tar' | 'ole' | 'unknown';

/** İlk baytlardan (tar için 257. bayttan sonrası dahil) arşiv türü. */
function detectArchiveKind(b: ArrayLike<number>): ArchiveKind {
  const n = b.length;
  if (n >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7) && (b[3] === 4 || b[3] === 6 || b[3] === 8)) return 'zip';
  if (n >= 6 && b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21 && b[4] === 0x1a && b[5] === 0x07) return 'rar';
  if (n >= 6 && b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf && b[4] === 0x27 && b[5] === 0x1c) return '7z';
  if (n >= 2 && b[0] === 0x1f && b[1] === 0x8b) return 'gzip';
  if (n >= 3 && b[0] === 0x42 && b[1] === 0x5a && b[2] === 0x68) return 'bzip2';
  if (n >= 6 && b[0] === 0xfd && b[1] === 0x37 && b[2] === 0x7a && b[3] === 0x58 && b[4] === 0x5a && b[5] === 0x00) return 'xz';
  if (n >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'ole';
  if (n >= 262 && b[257] === 0x75 && b[258] === 0x73 && b[259] === 0x74 && b[260] === 0x61 && b[261] === 0x72) return 'tar';
  return 'unknown';
}

function foldTr(s: string): string {
  return s
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[şŞ]/g, 's')
    .replace(/[üÜ]/g, 'u')
    .toLowerCase();
}

function safeCompare(a: string, b: string): number {
  try {
    return a.localeCompare(b, 'tr', { numeric: true, sensitivity: 'base' });
  } catch {
    return a < b ? -1 : a > b ? 1 : 0;
  }
}

interface DirNode {
  dirs: string[];
  files: number[];
}

/** Düz öğe listesinden klasör ağacı: dizin yolu -> {alt klasör adları, dosya indeksleri}. Klasörler/dosyalar ada göre sıralı. */
function buildIndex(entries: { dir: string; name: string }[], explicitDirs: string[]): Map<string, DirNode> {
  const dirSets = new Map<string, Set<string>>();
  const fileLists = new Map<string, number[]>();
  const allDirs = new Set<string>();
  const ensureDir = (path: string) => {
    let cur = path;
    while (cur !== '') {
      allDirs.add(cur);
      const slash = cur.lastIndexOf('/');
      const parent = slash < 0 ? '' : cur.slice(0, slash);
      const name = slash < 0 ? cur : cur.slice(slash + 1);
      let set = dirSets.get(parent);
      if (!set) {
        set = new Set<string>();
        dirSets.set(parent, set);
      }
      if (set.has(name)) break;
      set.add(name);
      cur = parent;
    }
  };
  for (let i = 0; i < explicitDirs.length; i++) ensureDir(explicitDirs[i]);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    ensureDir(e.dir);
    let list = fileLists.get(e.dir);
    if (!list) {
      list = [];
      fileLists.set(e.dir, list);
    }
    list.push(i);
  }
  const index = new Map<string, DirNode>();
  const keys = new Set<string>([...dirSets.keys(), ...fileLists.keys(), ...allDirs, '']);
  keys.forEach((k) => {
    const dirs = Array.from(dirSets.get(k) || []).sort(safeCompare);
    const files = (fileLists.get(k) || []).slice().sort((x, y) => safeCompare(entries[x].name, entries[y].name));
    index.set(k, { dirs, files });
  });
  return index;
}
// @@PURE-END

// ---------------------------------------------------------------------------

class ArchiveError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ArchiveError';
    this.code = code;
  }
}

function formatKindMessage(kind: ArchiveKind): string | null {
  switch (kind) {
    case 'rar':
      return t('archive.rar');
    case '7z':
      return t('archive.sevenZ');
    case 'gzip':
      return t('archive.gz');
    case 'bzip2':
      return t('archive.bz2');
    case 'xz':
      return t('archive.xz');
    case 'tar':
      return t('archive.tar');
    case 'ole':
      return t('archive.ole');
    default:
      return null;
  }
}

function kindFromExtension(ext: string): ArchiveKind {
  switch (ext) {
    case 'rar':
      return 'rar';
    case '7z':
      return '7z';
    case 'gz':
    case 'tgz':
      return 'gzip';
    case 'bz2':
    case 'tbz2':
      return 'bzip2';
    case 'xz':
    case 'txz':
      return 'xz';
    case 'tar':
      return 'tar';
    default:
      return 'unknown';
  }
}

async function readArchiveBase64(file: FileInfo): Promise<string> {
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new ArchiveError('too_large', t('archive.tooLarge', { size: FileService.formatFileSize(file.size), max: FileService.formatFileSize(MAX_ARCHIVE_BYTES) }));
  }
  if (file.uri && !FileService.isVirtualUri(file.uri)) {
    try {
      const info = await FileSystem.getInfoAsync(file.uri);
      if (info.exists && typeof info.size === 'number' && info.size > MAX_ARCHIVE_BYTES) {
        throw new ArchiveError('too_large', t('archive.tooLarge', { size: FileService.formatFileSize(info.size), max: FileService.formatFileSize(MAX_ARCHIVE_BYTES) }));
      }
      return await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
    } catch (e) {
      if (e instanceof ArchiveError) throw e;
      if (!file.base64) throw new ArchiveError('read_failed', t('archive.readFailDeleted'));
    }
  }
  if (file.base64) return file.base64;
  throw new ArchiveError('read_failed', t('archive.readFail'));
}

interface LoadedArchive {
  zip: JSZip;
  entries: ArchiveEntry[];
  explicitDirs: string[];
  truncated: boolean;
  unsafeCount: number;
  totalSize: number;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDate(d: Date | undefined | null): string {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '—';
  return formatDateParts(d);
}

function entryUncompressedSize(zipEntry: unknown): number {
  const data = (zipEntry as { _data?: { uncompressedSize?: number } })._data;
  const n = data && data.uncompressedSize;
  return typeof n === 'number' && isFinite(n) && n >= 0 ? n : -1;
}

async function loadArchive(file: FileInfo): Promise<LoadedArchive> {
  const b64 = await readArchiveBase64(file);
  const head = b64.slice(0, 520);
  const kind = detectArchiveKind(base64ToBytes(head));
  const byMagic = formatKindMessage(kind);
  if (byMagic) throw new ArchiveError(kind, byMagic);
  if (kind === 'unknown') {
    const byExt = formatKindMessage(kindFromExtension(getExtension(file.name)));
    if (byExt) throw new ArchiveError('format', byExt);
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(b64, {
      base64: true,
      decodeFileName: (bytes) => decodeZipNameBytes(bytes as ArrayLike<number>),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(msg)) {
      throw new ArchiveError('encrypted', t('archive.encrypted'));
    }
    throw new ArchiveError('corrupt', t('archive.corrupt'));
  }

  const keys = Object.keys(zip.files);
  const entries: ArchiveEntry[] = [];
  const explicitDirs: string[] = [];
  let truncated = false;
  let unsafeCount = 0;
  let totalSize = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const zipEntry = zip.files[key];
    const safe = sanitizeZipPath(key);
    if (!safe.path) continue;
    if (safe.changed) unsafeCount++;
    if (zipEntry.dir || safe.dir) {
      explicitDirs.push(safe.path);
      continue;
    }
    if (entries.length >= MAX_ENTRIES) {
      truncated = true;
      continue;
    }
    const slash = safe.path.lastIndexOf('/');
    const name = slash < 0 ? safe.path : safe.path.slice(slash + 1);
    const size = entryUncompressedSize(zipEntry);
    if (size > 0) totalSize += size;
    entries.push({
      path: safe.path,
      dir: slash < 0 ? '' : safe.path.slice(0, slash),
      name,
      sourcePath: key,
      size,
      date: formatDate(zipEntry.date),
      type: FileService.detectFileType(name),
      unsafe: safe.changed,
    });
  }
  return { zip, entries, explicitDirs, truncated, unsafeCount, totalSize };
}

export const ArchiveViewer: React.FC<ArchiveViewerProps> = ({
  file,
  appTheme = 'emerald',
  onOpenNestedFile,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>('');
  const [archive, setArchive] = useState<Omit<LoadedArchive, 'zip'> | null>(null);
  const [currentDir, setCurrentDir] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [opening, setOpening] = useState<boolean>(false);

  const zipRef = useRef<JSZip | null>(null);
  const openingRef = useRef<boolean>(false);
  const mountedRef = useRef<boolean>(true);

  const currentColors = Colors[appTheme] || Colors.emerald;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      zipRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setArchive(null);
    setCurrentDir('');
    setSearchQuery('');
    zipRef.current = null;

    loadArchive(file)
      .then((res) => {
        if (cancelled) return;
        zipRef.current = res.zip;
        setArchive({
          entries: res.entries,
          explicitDirs: res.explicitDirs,
          truncated: res.truncated,
          unsafeCount: res.unsafeCount,
          totalSize: res.totalSize,
        });
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof ArchiveError ? err.message : t('archive.openFail');
        if (__DEV__) console.warn('Arşiv yükleme hatası:', err);
        setLoadError(message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [file.uri, file.base64, file.size, file.name, reloadKey]);

  const index = useMemo(
    () => (archive ? buildIndex(archive.entries, archive.explicitDirs) : new Map<string, DirNode>()),
    [archive]
  );

  const rows = useMemo<Row[]>(() => {
    if (!archive) return [];
    const q = foldTr(searchQuery.trim());
    if (q) {
      const out: Row[] = [];
      index.forEach((_node, dirPath) => {
        if (dirPath !== '' && foldTr(dirPath).includes(q) && out.length < MAX_SEARCH_RESULTS) {
          const node = index.get(dirPath);
          out.push({
            kind: 'dir',
            key: `d:${dirPath}`,
            name: dirPath,
            path: dirPath,
            count: node ? node.dirs.length + node.files.length : 0,
          });
        }
      });
      for (let i = 0; i < archive.entries.length && out.length < MAX_SEARCH_RESULTS; i++) {
        const e = archive.entries[i];
        if (foldTr(e.path).includes(q)) out.push({ kind: 'file', key: `f:${e.sourcePath}:${i}`, entry: e, showPath: true });
      }
      return out;
    }
    const out: Row[] = [];
    if (currentDir !== '') out.push({ kind: 'up', key: 'up' });
    const node = index.get(currentDir);
    if (node) {
      for (const name of node.dirs) {
        const full = currentDir ? `${currentDir}/${name}` : name;
        const child = index.get(full);
        out.push({
          kind: 'dir',
          key: `d:${full}`,
          name,
          path: full,
          count: child ? child.dirs.length + child.files.length : 0,
        });
      }
      for (const fi of node.files) {
        const e = archive.entries[fi];
        out.push({ kind: 'file', key: `f:${e.sourcePath}:${fi}`, entry: e, showPath: false });
      }
    }
    return out;
  }, [archive, index, currentDir, searchQuery]);

  const crumbs = useMemo(() => {
    const parts = currentDir ? currentDir.split('/') : [];
    return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }));
  }, [currentDir]);

  const goUp = useCallback(() => {
    setCurrentDir((d) => {
      const slash = d.lastIndexOf('/');
      return slash < 0 ? '' : d.slice(0, slash);
    });
  }, []);

  const openEntry = useCallback(
    async (entry: ArchiveEntry) => {
      if (openingRef.current) return;
      const zip = zipRef.current;
      if (!zip) {
        Alert.alert(t('common.error'), t('archive.notInMemory'));
        return;
      }
      if (!onOpenNestedFile) {
        Alert.alert(t('archive.cannotOpenTitle'), t('archive.cannotOpenBody'));
        return;
      }
      const zipFile = zip.file(entry.sourcePath);
      if (!zipFile) {
        Alert.alert(t('common.fileNotFound'), t('archive.entryMissing', { name: entry.name }));
        return;
      }
      if (entry.size > MAX_ENTRY_BYTES) {
        Alert.alert(t('viewer.tooBigTitle'), t('archive.entryTooLarge', { name: entry.name, size: FileService.formatFileSize(entry.size), max: FileService.formatFileSize(MAX_ENTRY_BYTES) }));
        return;
      }

      openingRef.current = true;
      setOpening(true);
      try {
        const detected = FileService.detectFileTypeDetailed(entry.name);
        const ext = detected.extension || getExtension(entry.name);
        let category: FileType = detected.category;
        let unsupportedReason = detected.unsupportedReason;
        const virtualUri = `${file.uri}#${entry.path}`;

        const base: FileInfo = {
          id: `zip_entry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          name: entry.name,
          uri: virtualUri,
          size: entry.size > 0 ? entry.size : 0,
          extension: ext,
          category,
          isSample: false,
          virtual: true,
          originalName: entry.name,
        };

        if (category === 'unsupported') {
          if (!mountedRef.current) return;
          onOpenNestedFile({ ...base, category, unsupportedReason });
          return;
        }

        const isTextual = category === 'code' || category === 'markdown' || category === 'text' || category === 'unknown' || (category === 'image' && ext === 'svg');
        if (isTextual) {
          if (entry.size > DEFAULT_MAX_TEXT_BYTES) {
            Alert.alert(t('viewer.tooBigTitle'), t('archive.textTooLarge', { size: FileService.formatFileSize(entry.size), max: FileService.formatFileSize(DEFAULT_MAX_TEXT_BYTES) }));
            return;
          }
          const bytes = await zipFile.async('uint8array');
          if (!mountedRef.current) return;
          if (bytes.length > DEFAULT_MAX_TEXT_BYTES) {
            Alert.alert(t('viewer.tooBigTitle'), t('archive.textTooLarge', { size: FileService.formatFileSize(bytes.length), max: FileService.formatFileSize(DEFAULT_MAX_TEXT_BYTES) }));
            return;
          }
          if (category === 'unknown' && isLikelyBinary(bytes)) {
            category = 'unsupported';
            unsupportedReason = makeRef('archive.unknownBinary');
            onOpenNestedFile({ ...base, size: bytes.length, category, unsupportedReason });
            return;
          }
          const decoded = decodeTextBytes(bytes);
          onOpenNestedFile({
            ...base,
            size: bytes.length,
            category: category === 'unknown' ? 'text' : category,
            content: decoded.text,
          });
          return;
        }

        // İkili öğe (pdf/docx/xlsx/pptx/epub/görsel/iç arşiv): önbelleğe yaz, o dosya yolundan aç.
        const cacheDir = FileSystem.cacheDirectory;
        if (!cacheDir) throw new Error(t('archive.cacheDirFail'));
        const b64 = await zipFile.async('base64');
        if (!mountedRef.current) return;
        const cacheUri = `${cacheDir}nested_${Date.now()}_${toCacheFileName(getBaseName(entry.name))}`;
        await FileSystem.writeAsStringAsync(cacheUri, b64, { encoding: FileSystem.EncodingType.Base64 });
        if (!mountedRef.current) {
          FileSystem.deleteAsync(cacheUri, { idempotent: true }).catch(() => undefined);
          return;
        }
        onOpenNestedFile({ ...base, uri: cacheUri, category, size: base.size || Math.floor((b64.length * 3) / 4) });
      } catch (err) {
        if (__DEV__) console.warn('Arşiv öğesi açılamadı:', err);
        const msg = err instanceof Error ? err.message : '';
        if (/encrypt/i.test(msg)) {
          Alert.alert(t('archive.protectedTitle'), t('archive.protectedBody'));
        } else {
          Alert.alert(t('common.error'), t('archive.extractFail'));
        }
      } finally {
        openingRef.current = false;
        if (mountedRef.current) setOpening(false);
      }
    },
    [file.uri, onOpenNestedFile]
  );

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'up') {
        return (
          <TouchableOpacity
            style={[styles.entryItem, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}
            onPress={goUp}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('archive.upA11y')}
          >
            <View style={styles.entryLeft}>
              <Ionicons name="arrow-up-circle-outline" size={22} color={currentColors.primary} />
              <Text style={[styles.entryPath, { color: currentColors.text }]}>{t('archive.up')}</Text>
            </View>
          </TouchableOpacity>
        );
      }
      if (item.kind === 'dir') {
        return (
          <TouchableOpacity
            style={[styles.entryItem, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}
            onPress={() => {
              setSearchQuery('');
              setCurrentDir(item.path);
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('archive.folderA11y', { name: item.name, count: item.count })}
          >
            <View style={styles.entryLeft}>
              <Ionicons name="folder" size={22} color={currentColors.warning} />
              <View style={styles.entryMeta}>
                <Text style={[styles.entryPath, { color: currentColors.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.entrySub, { color: currentColors.textMuted }]}>{t('archive.items', { count: item.count })}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={currentColors.textMuted} />
          </TouchableOpacity>
        );
      }
      const e = item.entry;
      const sizeText = e.size >= 0 ? FileService.formatFileSize(e.size) : 'boyut bilinmiyor';
      return (
        <TouchableOpacity
          style={[styles.entryItem, { backgroundColor: currentColors.card, borderColor: currentColors.cardBorder }]}
          onPress={() => openEntry(e)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('archive.entryA11y', { name: e.name, size: sizeText })}
        >
          <View style={styles.entryLeft}>
            <Ionicons name="document-text-outline" size={22} color={currentColors.primary} />
            <View style={styles.entryMeta}>
              <Text style={[styles.entryPath, { color: currentColors.text }]} numberOfLines={1}>
                {item.showPath ? e.path : e.name}
              </Text>
              <Text style={[styles.entrySub, { color: currentColors.textMuted }]} numberOfLines={1}>
                {sizeText} • {e.date}
              </Text>
            </View>
          </View>
          <View style={styles.entryRight}>
            <FormatBadge type={e.type} extension={getExtension(e.name) || undefined} size="small" />
            <Ionicons name="chevron-forward" size={16} color={currentColors.textMuted} style={{ marginLeft: 6 }} />
          </View>
        </TouchableOpacity>
      );
    },
    [currentColors, goUp, openEntry]
  );

  const getItemLayout = useCallback(
    (_data: ArrayLike<Row> | null | undefined, i: number) => ({ length: ROW_STRIDE, offset: ROW_STRIDE * i, index: i }),
    []
  );

  const searching = searchQuery.trim().length > 0;
  const fileCount = archive ? archive.entries.length : 0;

  let emptyText = t('archive.emptyFolder');
  if (searching) emptyText = t('archive.noMatch');
  else if (archive && archive.entries.length === 0 && archive.explicitDirs.length === 0) emptyText = t('archive.emptyArchive');

  return (
    <View style={[styles.container, { backgroundColor: currentColors.background }]}>
      {/* Üst bilgi */}
      <View style={[styles.topBar, { backgroundColor: currentColors.surface, borderBottomColor: currentColors.border }]}>
        <View style={styles.topInfo}>
          <MaterialCommunityIcons name="zip-box" size={24} color={currentColors.warning} />
          <Text style={[styles.title, { color: currentColors.text }]} numberOfLines={1}>
            {file.name}
          </Text>
        </View>
        {archive && archive.unsafeCount > 0 ? (
          <View
            style={[styles.secureBadge, { backgroundColor: currentColors.primaryGlow }]}
            accessible
            accessibilityLabel={t('archive.unsafeA11y', { count: archive.unsafeCount })}
          >
            <Ionicons name="shield-checkmark" size={12} color={currentColors.warning} />
            <Text style={[styles.secureText, { color: currentColors.warning }]}>{archive.unsafeCount} yol temizlendi</Text>
          </View>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={currentColors.primary} />
          <Text style={[styles.loadingText, { color: currentColors.textSecondary }]}>{t('archive.opening')}</Text>
        </View>
      ) : loadError ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={42} color={currentColors.warning} />
          <Text style={[styles.errorText, { color: currentColors.text }]} accessibilityRole="alert">
            {loadError}
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { borderColor: currentColors.border }]}
            onPress={() => setReloadKey((k) => k + 1)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t('common.retry')}
          >
            <Ionicons name="refresh" size={16} color={currentColors.primary} />
            <Text style={[styles.retryText, { color: currentColors.primary }]}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Arama */}
          <View style={[styles.searchWrap, { backgroundColor: currentColors.surface, borderColor: currentColors.border }]}>
            <Ionicons name="search" size={18} color={currentColors.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: currentColors.text }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('archive.searchPlaceholder')}
              placeholderTextColor={currentColors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel={t('archive.searchA11y')}
            />
            {searching ? (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.clearBtn}
                accessibilityRole="button"
                accessibilityLabel={t('search.clear')}
              >
                <Ionicons name="close-circle" size={18} color={currentColors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Breadcrumb */}
          {!searching ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.crumbScroll}
              contentContainerStyle={styles.crumbContent}
              keyboardShouldPersistTaps="handled"
            >
              <TouchableOpacity
                onPress={() => setCurrentDir('')}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                style={styles.crumbBtn}
                accessibilityRole="button"
                accessibilityLabel={t('archive.rootA11y')}
              >
                <Ionicons name="home-outline" size={16} color={currentDir === '' ? currentColors.text : currentColors.primary} />
              </TouchableOpacity>
              {crumbs.map((c, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <View key={c.path} style={styles.crumbItem}>
                    <Ionicons name="chevron-forward" size={12} color={currentColors.textMuted} />
                    <TouchableOpacity
                      onPress={() => setCurrentDir(c.path)}
                      disabled={last}
                      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                      style={styles.crumbBtn}
                      accessibilityRole="button"
                      accessibilityLabel={t('archive.goFolderA11y', { name: c.name })}
                    >
                      <Text style={[styles.crumbText, { color: last ? currentColors.text : currentColors.primary, fontWeight: last ? '700' : '500' }]}>
                        {c.name}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          ) : null}

          <Text style={[styles.sectionTitle, { color: currentColors.textSecondary }]}>
            {searching
              ? t('archive.searchResults', { count: `${rows.length}${rows.length >= MAX_SEARCH_RESULTS ? '+' : ''}` })
              : `${t('archive.fileCount', { count: fileCount })}${archive && archive.totalSize > 0 ? ` • ${t('archive.unpacked', { size: FileService.formatFileSize(archive.totalSize) })}` : ''}`}
          </Text>
          {archive && archive.truncated ? (
            <Text style={[styles.noteText, { color: currentColors.warning }]}>
              {t('archive.truncated', { max: MAX_ENTRIES })}
            </Text>
          ) : null}

          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            renderItem={renderRow}
            getItemLayout={getItemLayout}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            initialNumToRender={20}
            windowSize={9}
            maxToRenderPerBatch={20}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Text style={[styles.emptyText, { color: currentColors.textSecondary }]}>{emptyText}</Text>
            }
          />
        </>
      )}

      {opening ? (
        <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.45)' }]} pointerEvents="auto" accessibilityLiveRegion="polite">
          <View style={[styles.overlayBox, { backgroundColor: currentColors.card, borderColor: currentColors.border }]}>
            <ActivityIndicator color={currentColors.primary} />
            <Text style={[styles.loadingText, { color: currentColors.text, marginTop: 8 }]}>{t('archive.extracting')}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  topInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
    marginLeft: 8,
  },
  secureText: {
    fontSize: 10,
    fontWeight: '700',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    fontWeight: '600',
  },
  retryBtn: {
    marginTop: 16,
    minHeight: 44,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '700',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
  },
  clearBtn: {
    minWidth: 28,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crumbScroll: {
    flexGrow: 0,
    marginTop: 8,
  },
  crumbContent: {
    paddingHorizontal: 16,
    alignItems: 'center',
    minHeight: 36,
  },
  crumbItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  crumbBtn: {
    paddingHorizontal: 6,
    minHeight: 32,
    justifyContent: 'center',
  },
  crumbText: {
    fontSize: 13,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
  },
  noteText: {
    fontSize: 12,
    fontWeight: '600',
    marginHorizontal: 16,
    marginBottom: 8,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 28,
    fontSize: 13,
    fontWeight: '600',
  },
  entryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    height: ROW_HEIGHT,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  entryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  entryMeta: {
    flex: 1,
  },
  entryPath: {
    fontSize: 13,
    fontWeight: '600',
  },
  entrySub: {
    fontSize: 11,
    marginTop: 2,
  },
  entryRight: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayBox: {
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
});
