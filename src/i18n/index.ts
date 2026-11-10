// Hafif yerelleştirme (TR/EN/DE): bağımlılıksız, yalnız JS. t(anahtar, { param }) ve çoğul için t(anahtar, { count }).
// Çoğul anahtarlar sözlükte `anahtar_one` / `anahtar_other` olarak tutulur; çağrıda yalnız `anahtar` yazılır.
import tr from './tr.json';
import en from './en.json';
import de from './de.json';

export type Lang = 'tr' | 'en' | 'de';
export type LanguagePref = 'system' | Lang;
export const LANGUAGES: readonly Lang[] = ['tr', 'en', 'de'];
export const DEFAULT_LANGUAGE_PREF: LanguagePref = 'system';

type Dict = typeof tr;
type Flat<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Flat<T[K], `${P}${K}.`>;
}[keyof T & string];
type StripPlural<K extends string> = K extends `${infer B}_one` ? B : K extends `${infer B}_other` ? B : K;
export type TKey = StripPlural<Flat<Dict>>;
export type TParams = Record<string, string | number>;

// en/de, tr ile aynı şekle sahip olmak zorundadır (derleme zamanı denetimi).
const DICTS: Record<Lang, Dict> = { tr, en, de };

export function isLanguagePref(x: unknown): x is LanguagePref {
  return x === 'system' || x === 'tr' || x === 'en' || x === 'de';
}

/** Cihaz yerel ayarı: tr → TR, de → DE, diğerleri EN. */
export function detectDeviceLanguage(): Lang {
  let loc = '';
  try {
    loc = Intl.DateTimeFormat().resolvedOptions().locale || '';
  } catch {
    loc = '';
  }
  if (!loc) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { I18nManager } = require('react-native');
      loc = (I18nManager && I18nManager.getConstants && I18nManager.getConstants().localeIdentifier) || '';
    } catch {
      loc = '';
    }
  }
  const l = loc.toLowerCase();
  if (l.startsWith('tr')) return 'tr';
  if (l.startsWith('de')) return 'de';
  return 'en';
}

export function resolveLanguage(pref: LanguagePref): Lang {
  return pref === 'system' ? detectDeviceLanguage() : pref;
}

let activeLang: Lang = detectDeviceLanguage();

export function getLanguage(): Lang {
  return activeLang;
}

export function setActiveLanguage(lang: Lang): void {
  activeLang = lang;
}

function lookup(dict: unknown, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === 'string' ? cur : undefined;
}

function pluralCategory(lang: Lang, n: number): 'one' | 'other' {
  try {
    return new Intl.PluralRules(lang).select(n) === 'one' ? 'one' : 'other';
  } catch {
    return n === 1 ? 'one' : 'other';
  }
}

export function t(key: TKey, params?: TParams): string {
  let raw: string | undefined;
  if (params && typeof params.count === 'number') {
    const cat = pluralCategory(activeLang, params.count);
    raw = lookup(DICTS[activeLang], `${key}_${cat}`) ?? lookup(DICTS.tr, `${key}_${cat}`);
  }
  if (raw === undefined) raw = lookup(DICTS[activeLang], key) ?? lookup(DICTS.tr, key) ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

// ---- Yerele göre sayı / boyut / tarih biçimleri ----

const NBSP = ' ';

/** Ondalık ayraç: TR/DE virgül, EN nokta. */
export function formatDecimal(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return activeLang === 'en' ? s : s.replace('.', ',');
}

/** Binlik ayraç: TR/DE nokta, EN virgül. */
export function formatInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, activeLang === 'en' ? ',' : '.');
}

/** Değer ile birim arasında bölünmez boşluk (örn. "1,5 MB"). */
export function formatSize(n: number): string {
  if (!isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)}${NBSP}B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb < 10 ? formatDecimal(kb, 1) : formatInt(kb)}${NBSP}KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? formatDecimal(mb, 1) : formatInt(mb)}${NBSP}MB`;
}

const pad2 = (n: number) => (n < 10 ? '0' + n : String(n));

/** TR/DE: GG.AA.YYYY; EN: YYYY-AA-GG. */
export function formatDateParts(d: Date): string {
  if (!isFinite(d.getTime())) return '';
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return getLanguage() === 'en' ? `${y}-${m}-${day}` : `${day}.${m}.${y}`;
}

export function formatTimeParts(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "1.5" gibi nokta ondalıklı metni yerele çevirir (TR/DE virgül). */
export function localizeDecimal(s: string): string {
  return getLanguage() === 'en' ? s : s.replace('.', ',');
}

// ---- Kalıcı kayıtlarda dil bağımsız metin: "i18n:anahtar|a=b" ----
// Kayıtta yerelleştirilmiş metin saklamak dil değişince eski dilde kalır; bunun yerine başvuru saklanır, gösterimde çözülür.
export function makeRef(key: TKey, params?: TParams): string {
  const p = params ? Object.keys(params).map((k) => `${k}=${encodeURIComponent(String(params[k]))}`).join('&') : '';
  return `i18n:${key}${p ? '|' + p : ''}`;
}

/** makeRef ile üretilmişse çevirir; aksi halde (eski kayıtlar) metni olduğu gibi döndürür. */
export function resolveRef(s: string | undefined | null): string {
  if (!s) return '';
  if (!s.startsWith('i18n:')) return s;
  const body = s.slice(5);
  const bar = body.indexOf('|');
  const key = (bar < 0 ? body : body.slice(0, bar)) as TKey;
  const params: TParams = {};
  if (bar >= 0) {
    for (const pair of body.slice(bar + 1).split('&')) {
      const eq = pair.indexOf('=');
      if (eq > 0) params[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
    }
  }
  return t(key, params);
}
