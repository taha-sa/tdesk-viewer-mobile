// Dosya listesi için saf (React Native'den bağımsız) yardımcılar: Türkçe duyarlı arama, sıralama, sayaçlar, tarih biçimi.
import type { FileInfo, FileType } from '../types';
import { t, formatDateParts } from '../i18n';

/** Kategori adları dile göre okunur (getter): modül düzeyinde kopyalanırsa dil değişimini kaçırır. */
export const CATEGORY_LABELS: Record<FileType, string> = {
  get pdf() { return 'PDF'; },
  get pptx() { return t('category.pptx'); },
  get epub() { return t('category.epub'); },
  get code() { return t('category.code'); },
  get spreadsheet() { return t('category.spreadsheet'); },
  get markdown() { return 'Markdown'; },
  get docx() { return 'Word (DOCX)'; },
  get image() { return t('category.image'); },
  get archive() { return t('category.archive'); },
  get text() { return t('category.text'); },
  get unsupported() { return t('category.unsupported'); },
  get unknown() { return t('category.unknown'); },
};

export type SortKey = 'name' | 'date' | 'size';
export type SortDir = 'asc' | 'desc';

const ACCENT_MAP: Record<string, string> = {
  ş: 's', ç: 'c', ğ: 'g', ö: 'o', ü: 'u', â: 'a', î: 'i', û: 'u', ı: 'i',
};

/**
 * Arama için katlama: Türkçe büyük/küçük harf (İ→i, I→ı), sonra aksan temizliği (ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i).
 * Hermes'te toLocaleLowerCase('tr-TR') yerel ayarı yok sayabileceği için İ/I elle eşlenir.
 */
export function foldTr(input: string): string {
  let s = String(input ?? '');
  s = s.replace(/İ/g, 'i').replace(/I/g, 'ı');
  try {
    s = s.toLocaleLowerCase('tr-TR');
  } catch {
    s = s.toLowerCase();
  }
  try {
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch {
    /* normalize yoksa elle eşleme yeterli */
  }
  return s.replace(/[şçğöüâîûı]/g, (c) => ACCENT_MAP[c] ?? c);
}

/** Aranan metin yalnız ad + etiketlerde aranır (açıklamada DEĞİL). Boşlukla ayrılan her sözcük bulunmalı. */
export function matchesQuery(file: Pick<FileInfo, 'name' | 'tags'>, query: string): boolean {
  const q = foldTr(query).trim();
  if (!q) return true;
  const hay = foldTr(`${file.name} ${(file.tags ?? []).join(' ')}`);
  return q.split(/\s+/).every((tok) => hay.includes(tok));
}

export interface FilterOptions {
  category?: FileType | 'all';
  query?: string;
  favoritesOnly?: boolean;
}

export function filterFiles(files: readonly FileInfo[], opts: FilterOptions): FileInfo[] {
  const { category = 'all', query = '', favoritesOnly = false } = opts;
  return files.filter(
    (f) =>
      (category === 'all' || f.category === category) &&
      (!favoritesOnly || f.isFavorite === true) &&
      matchesQuery(f, query)
  );
}

/** Kategori sayaçları (kategori filtresi HARİÇ, arama + favori filtresi dahil). */
export function categoryCounts(
  files: readonly FileInfo[],
  opts: Omit<FilterOptions, 'category'> = {}
): Partial<Record<FileType | 'all', number>> {
  const base = filterFiles(files, { ...opts, category: 'all' });
  const out: Partial<Record<FileType | 'all', number>> = { all: base.length };
  for (const f of base) out[f.category] = (out[f.category] ?? 0) + 1;
  return out;
}

export function defaultSortDir(key: SortKey): SortDir {
  return key === 'name' ? 'asc' : 'desc';
}

export function sortFiles(files: readonly FileInfo[], key: SortKey, dir: SortDir): FileInfo[] {
  const sign = dir === 'asc' ? 1 : -1;
  const arr = files.map((f, i) => ({ f, i }));
  arr.sort((a, b) => {
    let c = 0;
    if (key === 'name') {
      const x = foldTr(a.f.name);
      const y = foldTr(b.f.name);
      c = x < y ? -1 : x > y ? 1 : 0;
    } else if (key === 'size') {
      c = (a.f.size || 0) - (b.f.size || 0);
    } else {
      c = (a.f.lastOpened || 0) - (b.f.lastOpened || 0);
    }
    return c !== 0 ? c * sign : a.i - b.i; // kararlı sıralama
  });
  return arr.map((x) => x.f);
}

/** Diskte bulunamayan (favori) kayıtları ayırır. */
export function splitMissing(files: readonly FileInfo[]): { present: FileInfo[]; missing: FileInfo[] } {
  const present: FileInfo[] = [];
  const missing: FileInfo[] = [];
  for (const f of files) (f.missing ? missing : present).push(f);
  return { present, missing };
}

const pad2 = (n: number) => (n < 10 ? '0' + n : String(n));

/** TR/DE "05.11.2026", EN "2026-11-05" (Hermes'te toLocaleDateString seçeneklerine güvenmeden). */
export function formatShortDate(ts: number): string {
  return formatDateParts(new Date(ts));
}

/** "05.11.2026 14:07" */
export function formatDateTime(ts: number | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (!isFinite(d.getTime())) return '—';
  return `${formatShortDate(ts)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
