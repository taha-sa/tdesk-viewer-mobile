import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  Pressable,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as XLSX from 'xlsx';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import { FileInfo, AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import {
  loadViewerText,
  encodeTextBytes,
  bytesToBase64,
  isVirtualTextUri,
  foldForSearch,
  formatBytes,
  encodingLabel,
  TextEncodingName,
  EolStyle,
  TextReadError,
} from '../utils/textEncoding';

interface SpreadsheetViewerProps {
  file: FileInfo;
  appTheme?: AppThemeMode;
}

// @@PURE-START
// ---------------------------------------------------------------------------
// Saf mantık (React Native'e bağımlı değil). Node testi bu bloğu dosyadan çıkarıp çalıştırır.
// ---------------------------------------------------------------------------

export const MAX_ROWS = 20000;
export const MAX_COLS = 256;
const ROW_H = 44;

interface CellAddrUtils {
  decode_cell: (a: string) => { r: number; c: number };
  encode_cell: (c: { r: number; c: number }) => string;
}

interface GridSheet {
  name: string;
  hidden: boolean;
  /** Mutlak (0 tabanlı) başlangıç satır/sütun: A1 dışı başlayan sayfalarda adres ofseti. */
  startRow: number;
  startCol: number;
  /** Görüntülenen satır/sütun sayısı (sınırlı). */
  rowCount: number;
  colCount: number;
  /** Gerçek toplam satır sayısı (sınır aşıldıysa rowCount'tan büyük). */
  totalRows: number;
  truncated: boolean;
  cells: string[][];
  widths: number[];
}

export function colLetter(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function readableOn(bg: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((bg || '').trim());
  if (!m) return '#FFFFFF';
  const v = parseInt(m[1], 16);
  const ch = (x: number) => {
    const c = x / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * ch((v >> 16) & 255) + 0.7152 * ch((v >> 8) & 255) + 0.0722 * ch(v & 255);
  return L > 0.35 ? '#0B0F19' : '#FFFFFF';
}

// ---- hücre metni (biçimli) ----

interface RawCell {
  t?: string;
  v?: unknown;
  w?: string;
  z?: string | number;
  f?: string;
  F?: string;
}

export function cellText(cell: RawCell | undefined | null): string {
  if (!cell) return '';
  if (typeof cell.w === 'string') return cell.w;
  const v = cell.v;
  if (v === undefined || v === null) return '';
  if (cell.t === 'd') {
    const d = v instanceof Date ? v : new Date(v as string | number);
    if (isNaN(d.getTime())) return String(v);
    const iso = d.toISOString();
    return iso.slice(11, 19) === '00:00:00' ? iso.slice(0, 10) : iso.slice(0, 10) + ' ' + iso.slice(11, 19);
  }
  if (cell.t === 'b') return v ? 'TRUE' : 'FALSE';
  if (cell.t === 'e') return typeof v === 'string' ? v : '#HATA';
  return String(v);
}

export function computeWidths(cells: string[][], rowCount: number, colCount: number, startCol: number): number[] {
  const widths: number[] = [];
  const sample = Math.min(rowCount, 300);
  for (let c = 0; c < colCount; c++) {
    let maxLen = colLetter(startCol + c).length + 2;
    for (let r = 0; r < sample; r++) {
      const t = cells[r] ? cells[r][c] : undefined;
      if (t && t.length > maxLen) maxLen = t.length;
    }
    widths.push(Math.max(64, Math.min(240, Math.round(maxLen * 7.4 + 24))));
  }
  return widths;
}

/** Sayfayı ızgaraya çevirir: sınırlar gerçek hücrelerden (taramayla) bulunur, !ref ile yetinilmez. */
export function buildGrid(
  name: string,
  hidden: boolean,
  ws: Record<string, unknown>,
  U: CellAddrUtils
): GridSheet {
  let minR = Infinity;
  let minC = Infinity;
  let maxR = -1;
  let maxC = -1;
  const keys = Object.keys(ws);
  for (const k of keys) {
    if (k.charCodeAt(0) === 33 /* ! */) continue;
    const cell = ws[k] as RawCell | undefined;
    if (!cell || typeof cell !== 'object') continue;
    // Yalnızca biçimli ama boş saplamalar !ref'i şişirmesin.
    if (cell.t === 'z' && cell.v === undefined) continue;
    const a = U.decode_cell(k);
    if (a.r < minR) minR = a.r;
    if (a.c < minC) minC = a.c;
    if (a.r > maxR) maxR = a.r;
    if (a.c > maxC) maxC = a.c;
  }
  if (maxR < 0) {
    return { name, hidden, startRow: 0, startCol: 0, rowCount: 0, colCount: 0, totalRows: 0, truncated: false, cells: [], widths: [] };
  }
  const totalRows = maxR - minR + 1;
  const rowCount = Math.min(totalRows, MAX_ROWS);
  const totalCols = maxC - minC + 1;
  const colCount = Math.min(totalCols, MAX_COLS);
  const cells: string[][] = new Array(rowCount);
  for (let r = 0; r < rowCount; r++) cells[r] = new Array(colCount).fill('');
  for (const k of keys) {
    if (k.charCodeAt(0) === 33) continue;
    const cell = ws[k] as RawCell | undefined;
    if (!cell || typeof cell !== 'object') continue;
    const a = U.decode_cell(k);
    const r = a.r - minR;
    const c = a.c - minC;
    if (r < 0 || c < 0 || r >= rowCount || c >= colCount) continue;
    cells[r][c] = cellText(cell);
  }
  return {
    name,
    hidden,
    startRow: minR,
    startCol: minC,
    rowCount,
    colCount,
    totalRows,
    truncated: totalRows > rowCount || totalCols > colCount,
    cells,
    widths: computeWidths(cells, rowCount, colCount, minC),
  };
}

// ---- sınırlı metin (CSV / TSV) ----

export function detectDelimiter(text: string): string {
  const cands = [',', ';', '\t', '|'];
  const sample = text.length > 16384 ? text.slice(0, 16384) : text;
  const lines = sample.split(/\r\n|\n|\r/).filter((l) => l.length > 0).slice(0, 30);
  if (lines.length === 0) return ',';
  let best = ',';
  let bestScore = 0;
  for (const d of cands) {
    const counts = lines.map((line) => {
      let inQ = false;
      let n = 0;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') inQ = !inQ;
        else if (ch === d && !inQ) n++;
      }
      return n;
    });
    const first = counts[0];
    if (first === 0) continue;
    let same = 0;
    for (const c of counts) if (c === first) same++;
    const score = same * 1000 + first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

export function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  const n = text.length;
  let i = 0;
  let any = false; // satırda en az bir karakter görüldü mü
  while (i < n) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      inQ = true;
      any = true;
      i++;
    } else if (ch === delim) {
      row.push(field);
      field = '';
      any = true;
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      any = false;
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
    } else {
      field += ch;
      any = true;
      i++;
    }
  }
  if (any || field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function serializeDelimited(rows: string[][], delim: string, eol: string): string {
  const out: string[] = [];
  for (const row of rows) {
    out.push(
      row
        .map((f) => (f.indexOf('"') >= 0 || f.indexOf(delim) >= 0 || f.indexOf('\n') >= 0 || f.indexOf('\r') >= 0 ? '"' + f.replace(/"/g, '""') + '"' : f))
        .join(delim)
    );
  }
  return out.join(eol) + (rows.length > 0 ? eol : '');
}

export function gridFromRows(name: string, rows: string[][]): GridSheet {
  const totalRows = rows.length;
  const rowCount = Math.min(totalRows, MAX_ROWS);
  let widest = 0;
  for (let r = 0; r < totalRows; r++) if (rows[r].length > widest) widest = rows[r].length;
  const colCount = Math.min(widest, MAX_COLS);
  return {
    name,
    hidden: false,
    startRow: 0,
    startCol: 0,
    rowCount,
    colCount,
    totalRows,
    truncated: totalRows > rowCount || widest > colCount,
    cells: rows, // dağınık (ragged) satırlar korunur; kayıtta dosya biçimi bozulmaz
    widths: computeWidths(rows, rowCount, colCount, 0),
  };
}

// ---- düzenleme türü korunumu ----

export interface CoerceResult {
  ok: boolean;
  clear?: boolean;
  cell?: { t: string; v: string | number | boolean; z?: string | number };
  message?: string;
}

function isDateFormat(z: unknown): boolean {
  if (typeof z !== 'string') return false;
  const s = z.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(s) && !/^general$/i.test(s.trim());
}

export function parseNumberText(text: string, z?: unknown): number | null {
  let s = text.trim().replace(/[\s ]/g, '').replace(/[₺$€£]|TL|TRY|USD|EUR/gi, '');
  if (s === '') return null;
  let pct = false;
  if (s.endsWith('%')) {
    pct = true;
    s = s.slice(0, -1);
  }
  if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(s)) {
    const e = Number(s);
    return isFinite(e) ? (pct ? e / 100 : e) : null;
  }
  const hasC = s.indexOf(',') >= 0;
  const hasD = s.indexOf('.') >= 0;
  if (hasC && hasD) {
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const other = dec === ',' ? '.' : ',';
    s = s.split(other).join('').replace(dec, '.');
  } else if (hasC) {
    // "1,234" -> binlik (görüntülenen biçimle uyumlu); "1,5" -> ondalık (Türkçe girdi)
    if ((s.match(/,/g) as RegExpMatchArray).length > 1 || /^[+-]?\d{1,3},\d{3}$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
  } else if (hasD) {
    if ((s.match(/\./g) as RegExpMatchArray).length > 1) s = s.replace(/\./g, '');
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  let n = Number(s);
  if (!isFinite(n)) return null;
  if (pct) n = n / 100;
  else if (typeof z === 'string' && z.indexOf('%') >= 0 && Math.abs(n) >= 1) n = n / 100;
  return Math.round(n * 1e12) / 1e12;
}

export function parseDateText(text: string): number | null {
  const t = text.trim();
  let y: number, mo: number, d: number, hh = 0, mi = 0, ss = 0;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
  if (m) {
    y = +m[1]; mo = +m[2]; d = +m[3];
    hh = m[4] ? +m[4] : 0; mi = m[5] ? +m[5] : 0; ss = m[6] ? +m[6] : 0;
  } else {
    m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3];
    hh = m[4] ? +m[4] : 0; mi = m[5] ? +m[5] : 0; ss = m[6] ? +m[6] : 0;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59 || ss > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, hh, mi, ss);
  const chk = new Date(ms);
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
  const serial = (ms - Date.UTC(1899, 11, 30)) / 86400000;
  return Math.round(serial * 1e9) / 1e9;
}

/** Düzenlenen metni hücrenin özgün türüne göre yazılabilir hücreye çevirir (tür bozulmaz). */
export function coerceEdit(existing: RawCell | undefined, text: string): CoerceResult {
  if (text === '') return existing ? { ok: true, clear: true } : { ok: true, clear: true };
  const t = existing ? existing.t : undefined;
  if (existing && (t === 'd' || (t === 'n' && isDateFormat(existing.z)))) {
    const serial = parseDateText(text);
    if (serial === null) return { ok: false, message: 'Bu hücre bir tarih. Geçerli biçim: 31.12.2024, 2024-12-31 veya 31.12.2024 14:30.' };
    return { ok: true, cell: { t: 'n', v: serial, z: existing.z } };
  }
  if (existing && t === 'n') {
    const n = parseNumberText(text, existing.z);
    if (n === null) return { ok: false, message: 'Bu hücre bir sayı. Geçerli bir sayı girin (örn. 1234,5 veya 12%).' };
    return { ok: true, cell: { t: 'n', v: n, z: existing.z } };
  }
  if (existing && t === 'b') {
    const s = foldForSearch(text.trim());
    if (['true', 'doğru', 'dogru', '1', 'evet'].indexOf(s) >= 0) return { ok: true, cell: { t: 'b', v: true } };
    if (['false', 'yanlış', 'yanlis', '0', 'hayır', 'hayir'].indexOf(s) >= 0) return { ok: true, cell: { t: 'b', v: false } };
    return { ok: false, message: 'Bu hücre mantıksal (DOĞRU/YANLIŞ). TRUE veya FALSE girin.' };
  }
  if (!existing || t === 'z') {
    if (/^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/.test(text.trim())) {
      const n = parseNumberText(text);
      if (n !== null) return { ok: true, cell: { t: 'n', v: n } };
    }
  }
  return { ok: true, cell: { t: 's', v: text } };
}

// ---- sıralama / arama ----

function sortKey(s: string): number | null {
  const t = s.trim();
  if (!/^[+-]?(\d+([.,]\d+)?|[.,]\d+)%?$/.test(t)) return null;
  const n = parseFloat(t.replace(',', '.').replace('%', ''));
  return isNaN(n) ? null : n;
}

export function sortOrder(cells: string[][], rowCount: number, col: number, asc: boolean): number[] {
  const idx: number[] = new Array(rowCount);
  for (let i = 0; i < rowCount; i++) idx[i] = i;
  const val = (r: number) => (cells[r] && cells[r][col]) || '';
  const keys = idx.map((r) => sortKey(val(r)));
  idx.sort((a, b) => {
    const sa = val(a);
    const sb = val(b);
    // boşlar her zaman sonda
    if (sa === '' && sb !== '') return 1;
    if (sb === '' && sa !== '') return -1;
    const ka = keys[a];
    const kb = keys[b];
    let cmp: number;
    if (ka !== null && kb !== null) cmp = ka - kb;
    else if (ka !== null) cmp = -1; // sayılar metinden önce
    else if (kb !== null) cmp = 1;
    else cmp = sa.localeCompare(sb, 'tr');
    if (cmp === 0) return a - b;
    return asc ? cmp : -cmp;
  });
  return idx;
}

export interface CellMatch {
  di: number; // görüntü sırasındaki indeks
  r: number;
  c: number;
}

export function findCellMatches(
  cells: string[][],
  order: number[],
  colCount: number,
  query: string,
  max = 2000
): { matches: CellMatch[]; truncated: boolean } {
  const q = foldForSearch(query.trim());
  const matches: CellMatch[] = [];
  if (!q) return { matches, truncated: false };
  for (let di = 0; di < order.length; di++) {
    const r = order[di];
    const row = cells[r];
    if (!row) continue;
    const lim = Math.min(row.length, colCount);
    for (let c = 0; c < lim; c++) {
      const t = row[c];
      if (t && t.length >= q.length && foldForSearch(t).indexOf(q) >= 0) {
        matches.push({ di, r, c });
        if (matches.length >= max) return { matches, truncated: true };
      }
    }
  }
  return { matches, truncated: false };
}

export function bookTypeFor(ext: string): XLSX.BookType {
  switch (ext) {
    case 'xls':
      return 'biff8';
    case 'xlsm':
      return 'xlsm';
    case 'xlsb':
      return 'xlsb';
    case 'ods':
      return 'ods';
    case 'fods':
      return 'fods';
    default:
      return 'xlsx';
  }
}
// @@PURE-END

type EditKey = string;

interface PendingEdit {
  sheetIdx: number;
  r: number;
  c: number;
  text: string;
}

interface CsvMeta {
  delim: string;
  eol: EolStyle;
  encoding: TextEncodingName;
  hadBom: boolean;
}

interface SelectedCell {
  sheetIdx: number;
  r: number;
  c: number;
  address: string;
  text: string;
  formula?: string;
  arrayFormula?: boolean;
}

const MAX_XLSX_BYTES = 30 * 1024 * 1024;
const MAX_CSV_BYTES = 12 * 1024 * 1024;
const ROW_NUM_W = 56;
const HEADER_H = 40;

function confirmAsync(title: string, message: string, okLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Vazgeç', style: 'cancel', onPress: () => resolve(false) },
        { text: okLabel, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

const delay = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

type ThemeColors = (typeof Colors)[keyof typeof Colors];

interface SheetRowProps {
  cells: string[];
  r: number;
  rowNumber: number;
  colCount: number;
  widths: number[];
  rowNumW: number;
  /** Bu satırdaki arama sonucu sütunları */
  hits?: number[];
  /** Bu satırdaki geçerli sonuç sütunu (yoksa -1) */
  cur: number;
  colors: ThemeColors;
  letterOf: (c: number) => string;
  onPress: (r: number, c: number) => void;
}

const SheetRow = React.memo(function SheetRow({ cells, r, rowNumber, colCount, widths, rowNumW, hits, cur, colors, letterOf, onPress }: SheetRowProps) {
  const out: React.ReactNode[] = [];
  for (let c = 0; c < colCount; c++) {
    const val = (cells && cells[c]) || '';
    const isCur = c === cur;
    const isHit = !isCur && !!hits && hits.indexOf(c) >= 0;
    out.push(
      <Pressable
        key={c}
        style={[
          styles.cell,
          { width: widths[c], borderColor: colors.border },
          isHit && { backgroundColor: colors.primaryGlow },
          isCur && { backgroundColor: colors.primaryGlow, borderColor: colors.primary, borderWidth: 2 },
        ]}
        onPress={() => onPress(r, c)}
        accessibilityRole="button"
        accessibilityLabel={`${letterOf(c)}${rowNumber}: ${val === '' ? 'boş' : val}`}
        accessibilityHint="Hücre ayrıntılarını açar"
      >
        <Text style={[styles.dataText, { color: colors.text }]} numberOfLines={1} ellipsizeMode="tail">
          {val}
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.dataRow}>
      <View style={[styles.cell, styles.rowNumberCell, { width: rowNumW, backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.rowNumberText, { color: colors.textMuted }]}>{rowNumber}</Text>
      </View>
      {out}
    </View>
  );
});

export const SpreadsheetViewer: React.FC<SpreadsheetViewerProps> = ({ file, appTheme = 'emerald' }) => {
  const colors = Colors[appTheme] || Colors.emerald;
  const onPrimary = readableOn(colors.primary);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [grids, setGrids] = useState<GridSheet[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [editValue, setEditValue] = useState('');
  const [pending, setPending] = useState<PendingEdit[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const wbRef = useRef<XLSX.WorkBook | null>(null);
  const csvRef = useRef<CsvMeta | null>(null);
  const listRef = useRef<FlatList<number>>(null);
  const hScrollRef = useRef<ScrollView>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ext = (file.extension || '').toLowerCase();
  const isCsv = ext === 'csv' || ext === 'tsv';
  const readOnly = !!file.virtual || isVirtualTextUri(file.uri);

  // ---- yükleme (ertelenmiş; unmount'ta iptal) ----
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErrorMsg('');
    setPending([]);
    setSelected(null);
    setActiveIdx(0);
    setSortCol(null);
    setSearchInput('');
    setQuery('');
    wbRef.current = null;
    csvRef.current = null;

    (async () => {
      await delay(60); // spinner'ın çizilmesine izin ver
      if (cancelled) return;
      try {
        if (isCsv) {
          const dec = await loadViewerText(file, { maxBytes: MAX_CSV_BYTES });
          if (cancelled) return;
          const delim = ext === 'tsv' ? '\t' : detectDelimiter(dec.text);
          const rows = parseDelimited(dec.text, delim);
          csvRef.current = { delim, eol: dec.eol, encoding: dec.encoding, hadBom: dec.hadBom };
          const g = gridFromRows('CSV', rows);
          setGrids([g]);
          setStatus('ready');
          return;
        }

        if (typeof file.size === 'number' && file.size > MAX_XLSX_BYTES) {
          throw new Error(`Dosya çok büyük (${formatBytes(file.size)}). Bu görüntüleyici en fazla ${formatBytes(MAX_XLSX_BYTES)} destekler.`);
        }
        let b64: string | undefined;
        if (!file.virtual) {
          try {
            b64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
          } catch {
            b64 = undefined;
          }
        }
        if (!b64) b64 = file.base64;
        if (!b64) throw new Error('Dosya içeriği okunamadı.');
        if (cancelled) return;
        await delay(0);
        if (cancelled) return;

        let wb: XLSX.WorkBook;
        try {
          wb = XLSX.read(b64, { type: 'base64', cellFormula: true, cellDates: true, cellNF: true, cellText: true });
        } catch (e) {
          throw new Error('Tablo ayrıştırılamadı. Dosya bozuk, şifreli veya desteklenmeyen bir biçimde olabilir.');
        }
        if (cancelled) return;
        b64 = undefined;
        const metaSheets = wb.Workbook?.Sheets;
        const list: GridSheet[] = [];
        wb.SheetNames.forEach((name, i) => {
          const ws = wb.Sheets[name];
          if (!ws) return;
          const hiddenFlag = !!metaSheets && !!metaSheets[i] && !!metaSheets[i].Hidden;
          list.push(buildGrid(name, hiddenFlag, ws as unknown as Record<string, unknown>, XLSX.utils));
        });
        if (list.length === 0) throw new Error('Çalışma kitabında sayfa bulunamadı.');
        wbRef.current = wb;
        setGrids(list);
        const firstVisible = list.findIndex((g) => !g.hidden);
        setActiveIdx(firstVisible >= 0 ? firstVisible : 0);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        let msg = e instanceof Error ? e.message : 'Tablo okunamadı.';
        if (e instanceof TextReadError) {
          msg =
            e.code === 'too_large'
              ? `Dosya çok büyük${e.size ? ` (${formatBytes(e.size)})` : ''}. En fazla ${formatBytes(MAX_CSV_BYTES)} açılabilir.`
              : e.code === 'binary'
              ? 'Dosya metin gibi görünmüyor.'
              : e.code === 'not_found'
              ? 'Dosya bulunamadı.'
              : 'Dosya okunamadı.';
        }
        setErrorMsg(msg);
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.uri, file.id, file.virtual, ext]);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  // ---- arama (debounce) ----
  useEffect(() => {
    const h = setTimeout(() => setQuery(searchInput), 250);
    return () => clearTimeout(h);
  }, [searchInput]);

  const grid: GridSheet | undefined = grids[activeIdx];

  const order = useMemo(() => {
    if (!grid) return [] as number[];
    if (sortCol === null || sortCol >= grid.colCount) {
      const seq: number[] = new Array(grid.rowCount);
      for (let i = 0; i < grid.rowCount; i++) seq[i] = i;
      return seq;
    }
    return sortOrder(grid.cells, grid.rowCount, sortCol, sortAsc);
  }, [grid, sortCol, sortAsc]);

  const found = useMemo(() => {
    if (!grid || query.trim() === '') return { matches: [], truncated: false };
    return findCellMatches(grid.cells, order, grid.colCount, query);
  }, [grid, order, query]);
  const matches = found.matches;

  useEffect(() => {
    setMatchIdx(0);
  }, [query, activeIdx]);

  const colOffsets = useMemo(() => {
    const offs: number[] = [];
    let x = 0;
    if (grid) for (let c = 0; c < grid.colCount; c++) {
      offs.push(x);
      x += grid.widths[c];
    }
    return offs;
  }, [grid]);

  const hitMap = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const h of matches) {
      const a = m.get(h.r);
      if (a) a.push(h.c);
      else m.set(h.r, [h.c]);
    }
    return m;
  }, [matches]);

  const current = matches.length > 0 ? matches[Math.min(matchIdx, matches.length - 1)] : undefined;

  const scrollToMatch = useCallback(
    (m: { di: number; c: number } | undefined) => {
      if (!m) return;
      listRef.current?.scrollToIndex({ index: m.di, viewPosition: 0.4, animated: true });
      const x = colOffsets[m.c] ?? 0;
      hScrollRef.current?.scrollTo({ x: Math.max(0, x - 40), animated: true });
    },
    [colOffsets]
  );

  // yeni sorguda ilk sonuca git
  useEffect(() => {
    if (matches.length > 0) scrollToMatch(matches[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found]);

  const goMatch = (delta: number) => {
    if (matches.length === 0) return;
    const next = (Math.min(matchIdx, matches.length - 1) + delta + matches.length) % matches.length;
    setMatchIdx(next);
    scrollToMatch(matches[next]);
  };

  const letterOf = useCallback((c: number) => colLetter((grid ? grid.startCol : 0) + c), [grid]);

  // ---- hücre açma / düzenleme ----
  const openCell = useCallback(
    (r: number, c: number) => {
      if (!grid) return;
      const text = (grid.cells[r] && grid.cells[r][c]) || '';
      const address = XLSX.utils.encode_cell({ r: grid.startRow + r, c: grid.startCol + c });
      let formula: string | undefined;
      let arrayFormula = false;
      const wb = wbRef.current;
      if (wb) {
        const ws = wb.Sheets[grid.name];
        const raw = ws ? (ws[address] as RawCell | undefined) : undefined;
        if (raw?.F) arrayFormula = true;
        if (raw?.f) formula = raw.f;
      }
      setSelected({ sheetIdx: activeIdx, r, c, address, text, formula, arrayFormula });
      setEditValue(text);
      setCopied(false);
    },
    [grid, activeIdx]
  );

  const applyCellEdit = (sel: SelectedCell, text: string) => {
    setGrids((prev) =>
      prev.map((g, i) => {
        if (i !== sel.sheetIdx) return g;
        const cells = g.cells.slice();
        const row = (cells[sel.r] || []).slice();
        while (row.length <= sel.c) row.push('');
        row[sel.c] = text;
        cells[sel.r] = row;
        return { ...g, cells };
      })
    );
    setPending((prev) => [
      ...prev.filter((e) => !(e.sheetIdx === sel.sheetIdx && e.r === sel.r && e.c === sel.c)),
      { sheetIdx: sel.sheetIdx, r: sel.r, c: sel.c, text },
    ]);
    setSelected(null);
  };

  const handleUpdateCell = async () => {
    if (!selected || readOnly || selected.arrayFormula) return;
    if (editValue === selected.text) {
      setSelected(null);
      return;
    }
    const wb = wbRef.current;
    if (wb) {
      const g = grids[selected.sheetIdx];
      const ws = g ? wb.Sheets[g.name] : undefined;
      const existing = ws ? (ws[selected.address] as RawCell | undefined) : undefined;
      const res = coerceEdit(existing, editValue);
      if (!res.ok) {
        Alert.alert('Geçersiz değer', res.message || 'Değer bu hücre türüne uymuyor.');
        return;
      }
      if (selected.formula) {
        const go = await confirmAsync(
          'Formül silinecek',
          `Bu hücre bir formül içeriyor (=${selected.formula}). Güncellerseniz formül kalkar ve hücre sabit değer olur.`,
          'Yine de güncelle'
        );
        if (!go) return;
      }
    }
    applyCellEdit(selected, editValue);
  };

  const copyCell = async () => {
    if (!selected) return;
    try {
      await Clipboard.setStringAsync(selected.text);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      Alert.alert('Hata', 'Panoya kopyalanamadı.');
    }
  };

  // ---- kaydet ----
  const handleSave = async () => {
    if (readOnly || isSaving) return;
    if (pending.length === 0) {
      Alert.alert('Değişiklik yok', 'Kaydedilecek bir değişiklik bulunmuyor.');
      return;
    }
    if (!isCsv) {
      const warn =
        ext === 'xls'
          ? 'Kaydetmek dosyayı yeniden yazar. Biçimlendirme, grafik, resim, koşullu biçim ve makrolar kaybolabilir.'
          : ext === 'xlsm'
          ? 'Kaydetmek dosyayı yeniden yazar. Makrolar (VBA), grafikler, resimler ve biçimlendirmenin bir kısmı kaybolur.'
          : 'Kaydetmek dosyayı yeniden yazar. Hücre stilleri, grafikler, resimler, koşullu biçim ve doğrulama kuralları kaybolabilir; yalnızca hücre değerleri ve formüller korunur.';
      const ok = await confirmAsync('Kayıpla kaydedilsin mi?', warn, 'Kaydet');
      if (!ok) return;
    }
    setIsSaving(true);
    try {
      let note = '';
      if (isCsv) {
        const meta = csvRef.current;
        const g = grids[0];
        if (!meta || !g) throw new Error('CSV verisi yüklenemedi.');
        const text = serializeDelimited(g.cells, meta.delim, meta.eol === 'crlf' ? '\r\n' : meta.eol === 'cr' ? '\r' : '\n');
        const nonAscii = /[^\u0000-\u007f]/.test(text);
        let enc: TextEncodingName = meta.encoding;
        let enc1 = encodeTextBytes(text, enc, enc === 'utf-8' ? meta.hadBom || nonAscii : false);
        if (!enc1.lossless) {
          enc = 'utf-8';
          enc1 = encodeTextBytes(text, 'utf-8', true);
          note = '\nBazı karakterler özgün kodlamada yazılamadığı için dosya UTF-8 (BOM\'lu) olarak kaydedildi.';
        }
        await FileSystem.writeAsStringAsync(file.uri, bytesToBase64(enc1.bytes), { encoding: FileSystem.EncodingType.Base64 });
      } else {
        const wb = wbRef.current;
        if (!wb) throw new Error('Özgün çalışma kitabı yüklenemedi.');
        for (const edit of pending) {
          const g = grids[edit.sheetIdx];
          if (!g) throw new Error('Sayfa bulunamadı.');
          const ws = wb.Sheets[g.name];
          if (!ws) throw new Error(`Çalışma sayfası bulunamadı: ${g.name}`);
          const addr = XLSX.utils.encode_cell({ r: g.startRow + edit.r, c: g.startCol + edit.c });
          const existing = ws[addr] as (XLSX.CellObject & RawCell) | undefined;
          if (existing?.F) throw new Error('Dizi formülü içeren hücreler bu görüntüleyicide düzenlenemez.');
          const res = coerceEdit(existing, edit.text);
          if (!res.ok) throw new Error(`${addr}: ${res.message || 'geçersiz değer'}`);
          if (res.clear) {
            delete ws[addr];
            continue;
          }
          const cell = res.cell as { t: string; v: string | number | boolean; z?: string | number };
          // Yeni hücre nesnesi: eski formül/biçimli metin/HTML alanları taşınmaz.
          const next: Record<string, unknown> = { t: cell.t, v: cell.v };
          if (cell.z !== undefined) next.z = cell.z;
          ws[addr] = next as unknown as XLSX.CellObject;
          // !ref hücreyi kapsamıyorsa genişlet
          const rng = XLSX.utils.decode_range(ws['!ref'] || addr);
          const a = XLSX.utils.decode_cell(addr);
          if (a.r < rng.s.r) rng.s.r = a.r;
          if (a.c < rng.s.c) rng.s.c = a.c;
          if (a.r > rng.e.r) rng.e.r = a.r;
          if (a.c > rng.e.c) rng.e.c = a.c;
          ws['!ref'] = XLSX.utils.encode_range(rng);
        }
        const out = XLSX.write(wb, { type: 'base64', bookType: bookTypeFor(ext), cellDates: true });
        await FileSystem.writeAsStringAsync(file.uri, out, { encoding: FileSystem.EncodingType.Base64 });
      }
      setPending([]);
      const isAppCopy = !!FileSystem.cacheDirectory && file.uri.startsWith(FileSystem.cacheDirectory);
      Alert.alert(
        'Kaydedildi',
        (isAppCopy
          ? 'Değişiklikler uygulama kopyasına kaydedildi. Orijinal dosyayı güncellemek için Paylaş düğmesinden dışa aktarın.'
          : 'Değişiklikler dosyaya kaydedildi.') + note
      );
    } catch (e) {
      Alert.alert('Kaydedilemedi', e instanceof Error && e.message ? e.message : 'Tablo kaydedilirken hata oluştu.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSort = (c: number) => {
    if (sortCol !== c) {
      setSortCol(c);
      setSortAsc(true);
    } else if (sortAsc) {
      setSortAsc(false);
    } else {
      setSortCol(null);
      setSortAsc(true);
    }
  };

  const renderRow = useCallback(
    ({ item: r }: { item: number }) => {
      if (!grid) return null;
      const isCurRow = current && current.r === r;
      return (
        <SheetRow
          cells={grid.cells[r]}
          r={r}
          rowNumber={grid.startRow + r + 1}
          colCount={grid.colCount}
          widths={grid.widths}
          rowNumW={ROW_NUM_W}
          hits={hitMap.get(r)}
          cur={isCurRow ? (current as { c: number }).c : -1}
          colors={colors}
          letterOf={letterOf}
          onPress={openCell}
        />
      );
    },
    [grid, hitMap, current, colors, letterOf, openCell]
  );

  // ---- yükleniyor / hata ----
  if (status === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.infoText, { color: colors.textMuted, marginTop: 14 }]}>Tablo hazırlanıyor...</Text>
      </View>
    );
  }
  if (status === 'error' || !grid) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.danger} />
        <Text style={[styles.errorTitle, { color: colors.text }]}>Tablo açılamadı</Text>
        <Text style={[styles.infoText, { color: colors.textSecondary }]}>{errorMsg || 'Bilinmeyen hata.'}</Text>
      </View>
    );
  }

  const totalW = ROW_NUM_W + grid.widths.reduce((a, b) => a + b, 0);
  const dirtyCount = pending.length;
  const csv = csvRef.current;
  const visibleSheets = grids.length;
  const emptySheet = grid.rowCount === 0 || grid.colCount === 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Üst araç çubuğu */}
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Tabloda ara..."
            placeholderTextColor={colors.textMuted}
            value={searchInput}
            onChangeText={setSearchInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => goMatch(1)}
            accessibilityLabel="Tabloda ara"
          />
          {searchInput.length > 0 && (
            <Pressable
              onPress={() => setSearchInput('')}
              hitSlop={12}
              style={styles.iconBtnSmall}
              accessibilityRole="button"
              accessibilityLabel="Aramayı temizle"
            >
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        {!readOnly && (
          <Pressable
            style={[styles.saveBtn, { backgroundColor: colors.primary }, (isSaving || dirtyCount === 0) && { opacity: 0.55 }]}
            onPress={handleSave}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel={dirtyCount > 0 ? `Kaydet, ${dirtyCount} değişiklik` : 'Kaydet, değişiklik yok'}
            accessibilityState={{ disabled: isSaving, busy: isSaving }}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={onPrimary} />
            ) : (
              <MaterialCommunityIcons name="content-save-outline" size={18} color={onPrimary} />
            )}
            <Text style={[styles.saveBtnText, { color: onPrimary }]}>{dirtyCount > 0 ? `Kaydet (${dirtyCount})` : 'Kaydet'}</Text>
          </Pressable>
        )}
      </View>

      {/* Arama sonucu çubuğu */}
      {query.trim() !== '' && (
        <View style={[styles.matchBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <Text style={[styles.matchText, { color: matches.length === 0 ? colors.warning : colors.textSecondary }]} accessibilityLiveRegion="polite">
            {matches.length === 0
              ? 'Sonuç bulunamadı'
              : `${Math.min(matchIdx, matches.length - 1) + 1} / ${matches.length}${found.truncated ? '+' : ''} sonuç`}
          </Text>
          <View style={styles.matchBtns}>
            <Pressable
              onPress={() => goMatch(-1)}
              disabled={matches.length === 0}
              hitSlop={6}
              style={[styles.iconBtn, matches.length === 0 && { opacity: 0.4 }]}
              accessibilityRole="button"
              accessibilityLabel="Önceki sonuç"
            >
              <Ionicons name="chevron-up" size={22} color={colors.text} />
            </Pressable>
            <Pressable
              onPress={() => goMatch(1)}
              disabled={matches.length === 0}
              hitSlop={6}
              style={[styles.iconBtn, matches.length === 0 && { opacity: 0.4 }]}
              accessibilityRole="button"
              accessibilityLabel="Sonraki sonuç"
            >
              <Ionicons name="chevron-down" size={22} color={colors.text} />
            </Pressable>
          </View>
        </View>
      )}

      {/* Bilgi bantları */}
      {(grid.truncated || readOnly || csv) && (
        <View style={[styles.banner, { backgroundColor: colors.primaryGlow, borderBottomColor: colors.border }]}>
          {grid.truncated && (
            <Text style={[styles.bannerText, { color: colors.text }]}>
              {grid.totalRows > grid.rowCount
                ? `Büyük sayfa: ilk ${grid.rowCount.toLocaleString('tr-TR')} satır gösteriliyor (toplam ${grid.totalRows.toLocaleString('tr-TR')}). Gösterilmeyen satırlar kayıtta korunur.`
                : `Çok sayıda sütun: ilk ${MAX_COLS} sütun gösteriliyor. Gösterilmeyen sütunlar kayıtta korunur.`}
            </Text>
          )}
          {readOnly && (
            <Text style={[styles.bannerText, { color: colors.text }]}>
              Bu dosya yalnızca okunabilir (arşiv içinden açıldı); düzenleme ve kaydetme kapalı.
            </Text>
          )}
          {csv && (
            <Text style={[styles.bannerText, { color: colors.textSecondary }]}>
              {`Ayırıcı: ${csv.delim === '\t' ? 'Sekme' : csv.delim === ';' ? 'Noktalı virgül (;)' : csv.delim === '|' ? 'Dikey çizgi (|)' : 'Virgül (,)'} · Kodlama: ${encodingLabel(csv.encoding)}${csv.hadBom ? ' (BOM)' : ''}`}
            </Text>
          )}
        </View>
      )}

      {/* Sayfa sekmeleri */}
      {visibleSheets > 1 && (
        <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sheetTabs}>
            {grids.map((g, index) => {
              const isActive = index === activeIdx;
              return (
                <Pressable
                  key={index}
                  style={[styles.sheetTabBtn, isActive && { borderBottomColor: colors.primary, borderBottomWidth: 3 }]}
                  onPress={() => {
                    setActiveIdx(index);
                    setSortCol(null);
                    setSortAsc(true);
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={`Sayfa ${g.name}${g.hidden ? ' (gizli)' : ''}`}
                >
                  <Text style={[styles.sheetTabBtnText, { color: isActive ? colors.primary : colors.textMuted }]}>
                    {g.name}
                    {g.hidden ? ' (gizli)' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Tablo */}
      {emptySheet ? (
        <View style={styles.center}>
          <Ionicons name="grid-outline" size={44} color={colors.textMuted} />
          <Text style={[styles.infoText, { color: colors.textSecondary, marginTop: 10 }]}>
            {visibleSheets === 1 ? `"${grid.name}" ` : 'Bu '}sayfa boş.
          </Text>
        </View>
      ) : (
        <ScrollView
          ref={hScrollRef}
          horizontal
          bounces={false}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          style={styles.horizontalScroll}
        >
          <View style={{ width: totalW, flex: 1 }}>
            {/* Yapışkan başlık: dikey listenin dışında, yatayda birlikte kayar */}
            <View style={styles.headerRow}>
              <View style={[styles.cell, styles.rowNumberCell, { width: ROW_NUM_W, height: HEADER_H, backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.headerText, { color: colors.textMuted }]}>#</Text>
              </View>
              {grid.widths.map((w, c) => {
                const isSorted = sortCol === c;
                return (
                  <Pressable
                    key={c}
                    style={[styles.cell, styles.headerCell, { width: w, height: HEADER_H, backgroundColor: colors.surface, borderColor: colors.border }]}
                    onPress={() => handleSort(c)}
                    accessibilityRole="button"
                    accessibilityLabel={`Sütun ${letterOf(c)}, sırala${isSorted ? (sortAsc ? ', artan' : ', azalan') : ''}`}
                  >
                    <Text style={[styles.headerText, { color: isSorted ? colors.primary : colors.text }]}>{letterOf(c)}</Text>
                    {isSorted && <Ionicons name={sortAsc ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primary} style={{ marginLeft: 4 }} />}
                  </Pressable>
                );
              })}
            </View>

            <FlatList
              key={`sheet-${activeIdx}`}
              ref={listRef}
              data={order}
              renderItem={renderRow}
              keyExtractor={(r) => String(r)}
              extraData={current}
              getItemLayout={(_, index) => ({ length: ROW_H, offset: ROW_H * index, index })}
              initialNumToRender={24}
              maxToRenderPerBatch={24}
              windowSize={9}
              removeClippedSubviews={Platform.OS === 'android'}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              onScrollToIndexFailed={(info) => {
                listRef.current?.scrollToOffset({ offset: info.index * ROW_H, animated: true });
              }}
            />
          </View>
        </ScrollView>
      )}

      {/* Hücre detay / düzenleme */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setSelected(null)}
            accessibilityRole="button"
            accessibilityLabel="Kapat"
          />
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalColName, { color: colors.primary }]}>{selected?.address}</Text>
                <Text style={[styles.modalRowName, { color: colors.textMuted }]}>
                  Sütun {selected ? letterOf(selected.c) : ''} · Satır {selected && grid ? grid.startRow + selected.r + 1 : ''}
                </Text>
              </View>
              <Pressable
                onPress={() => setSelected(null)}
                hitSlop={10}
                style={styles.iconBtn}
                accessibilityRole="button"
                accessibilityLabel="Hücre penceresini kapat"
              >
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>

            {!!selected?.formula && (
              <View style={[styles.formulaBox, { backgroundColor: colors.surface, borderColor: colors.warning }]}>
                <Text style={[styles.formulaText, { color: colors.textSecondary }]} selectable>
                  Formül: ={selected.formula}
                </Text>
                {!readOnly && <Text style={[styles.formulaWarn, { color: colors.warning }]}>Değeri değiştirirseniz formül silinir.</Text>}
              </View>
            )}
            {!!selected?.arrayFormula && (
              <Text style={[styles.formulaWarn, { color: colors.warning, marginBottom: 10 }]}>
                Dizi formülü içeren hücreler bu görüntüleyicide düzenlenemez.
              </Text>
            )}

            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>
              {readOnly || selected?.arrayFormula ? 'Hücre değeri' : 'Hücre değerini düzenle'}
            </Text>
            <TextInput
              style={[styles.modalTextInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              multiline
              value={editValue}
              onChangeText={setEditValue}
              editable={!readOnly && !selected?.arrayFormula}
              accessibilityLabel="Hücre değeri"
            />

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
                onPress={copyCell}
                accessibilityRole="button"
                accessibilityLabel="Hücre içeriğini kopyala"
              >
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={colors.text} />
                <Text style={[styles.modalBtnText, { color: colors.text }]}>{copied ? 'Kopyalandı' : 'Kopyala'}</Text>
              </Pressable>

              {!readOnly && !selected?.arrayFormula && (
                <Pressable
                  style={[styles.modalBtn, { backgroundColor: colors.primary }]}
                  onPress={handleUpdateCell}
                  accessibilityRole="button"
                  accessibilityLabel="Hücreyi güncelle"
                >
                  <Ionicons name="checkmark" size={18} color={onPrimary} />
                  <Text style={[styles.modalBtnText, { color: onPrimary }]}>Güncelle</Text>
                </Pressable>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { flex: 1 },
  infoText: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  errorTitle: { fontSize: 17, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  topBar: {
    flexDirection: 'row',
    padding: 10,
    borderBottomWidth: 1,
    gap: 10,
    alignItems: 'center',
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingLeft: 12,
    paddingRight: 4,
    height: 44,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14, height: '100%' },
  iconBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  iconBtnSmall: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    minHeight: 44,
    borderRadius: 8,
  },
  saveBtnText: { fontWeight: '700', fontSize: 14 },
  matchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 14,
    paddingRight: 4,
    borderBottomWidth: 1,
  },
  matchText: { fontSize: 13, fontWeight: '600' },
  matchBtns: { flexDirection: 'row' },
  banner: { paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, gap: 4 },
  bannerText: { fontSize: 12, lineHeight: 17 },
  sheetTabs: { flexDirection: 'row', paddingHorizontal: 4 },
  sheetTabBtn: { paddingHorizontal: 16, minHeight: 44, justifyContent: 'center', marginRight: 8 },
  sheetTabBtnText: { fontSize: 14, fontWeight: '700' },
  horizontalScroll: { flex: 1 },
  headerRow: { flexDirection: 'row' },
  dataRow: { flexDirection: 'row' },
  cell: {
    borderRightWidth: 1,
    borderBottomWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 10,
    height: ROW_H,
  },
  headerCell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  rowNumberCell: { alignItems: 'center' },
  headerText: { fontSize: 13, fontWeight: '700' },
  rowNumberText: { fontSize: 12, fontWeight: '600' },
  dataText: { fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalContent: { borderRadius: 16, borderWidth: 1, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  modalColName: { fontSize: 18, fontWeight: '800', marginBottom: 2 },
  modalRowName: { fontSize: 13, fontWeight: '600' },
  formulaBox: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 12 },
  formulaText: { fontSize: 13 },
  formulaWarn: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  modalLabel: { fontSize: 12, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase' },
  modalTextInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    minHeight: 100,
    maxHeight: 220,
    fontSize: 15,
    textAlignVertical: 'top',
    marginBottom: 20,
  },
  modalActions: { flexDirection: 'row', gap: 12 },
  modalBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 48,
    borderRadius: 10,
  },
  modalBtnText: { fontSize: 14, fontWeight: '700' },
});
