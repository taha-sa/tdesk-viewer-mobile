import xss, { friendlyAttrValue } from 'xss';
import { t } from '../i18n';

/**
 * Belge HTML'i (Markdown, DOCX, EPUB) için beyaz liste temelli temizleyici.
 *
 * Tasarım ilkeleri:
 *  - Betik, stil, olay öznitelikleri, gömülü nesneler, formlar, svg/math ve <head>/<title> GÖVDESİYLE atılır.
 *  - Öznitelik değerleri xss'in kaçış-çözme adımından geçtikten sonra KENDİ kurallarımızla doğrulanır
 *    ve her zaman çift tırnaklı, kaçışlı olarak yeniden yazılır.
 *  - <input> yalnız `type=checkbox` ise (görev listesi) kabul edilir; çıktı tamamen bizim ürettiğimiz sabit metindir.
 *  - Resimler yalnız `http(s)` (allowImages=true) veya yalnız raster `data:image/(png|jpeg|gif|webp)` (allowImages='data').
 *    `data:image/svg+xml` hiçbir kipte geçmez.
 */

export interface SanitizeOptions {
  /** true: http(s) + raster data URI (önceki davranış); 'data': yalnız raster data URI; false: hiç görsel yok. */
  allowImages?: boolean | 'data';
  /** Tüm `id` değerlerinin ve `#çapa` bağlantılarının önüne eklenir (DOM clobbering'e karşı). */
  idPrefix?: string;
  /** Şemasız (göreli) bağlantı değerlerini korur (EPUB iç bağlantıları için; sonradan yeniden yazılır). */
  allowRelativeLinks?: boolean;
}

const documentTags: Record<string, string[]> = {
  a: ['href', 'title', 'id'],
  abbr: ['title', 'id'],
  article: ['id'],
  aside: ['id'],
  b: ['id'],
  blockquote: ['id'],
  br: [],
  caption: ['id'],
  cite: ['id'],
  code: ['class', 'id'],
  col: [],
  colgroup: [],
  dd: ['id'],
  del: ['id'],
  details: ['id'],
  div: ['class', 'id', 'align'],
  dl: ['id'],
  dt: ['id'],
  em: ['id'],
  figcaption: ['id'],
  figure: ['id'],
  h1: ['id', 'align'],
  h2: ['id', 'align'],
  h3: ['id', 'align'],
  h4: ['id', 'align'],
  h5: ['id', 'align'],
  h6: ['id', 'align'],
  hr: [],
  i: ['id'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  input: [],
  kbd: ['id'],
  li: ['id'],
  mark: ['id'],
  ol: ['start', 'id'],
  p: ['id', 'align'],
  pre: ['class', 'id'],
  s: ['id'],
  samp: ['id'],
  section: ['id'],
  small: ['id'],
  span: ['class', 'id'],
  strike: ['id'],
  strong: ['id'],
  sub: ['id'],
  summary: ['id'],
  sup: ['id'],
  table: ['id', 'align'],
  tbody: [],
  td: ['colspan', 'rowspan', 'align'],
  tfoot: [],
  th: ['colspan', 'rowspan', 'align'],
  thead: [],
  tr: ['align'],
  u: ['id'],
  ul: ['id'],
};

/** Etiketin kendisi ve İÇERİĞİ birlikte atılır. */
const stripBodyTags = [
  'script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed', 'head', 'title', 'template',
  'svg', 'math', 'select', 'xmp', 'noembed', 'noframes', 'applet', 'audio', 'video', 'canvas', 'frameset',
];

const RASTER_DATA_URI = /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i;
const ID_RE = /^[A-Za-z0-9_\-:.À-ɏ]{1,120}$/;
const CLASS_TOKEN_RE = /^[A-Za-z0-9_\-:]{1,60}$/;
const ALIGN_VALUES = ['left', 'right', 'center', 'justify'];
// eslint-disable-next-line no-control-regex
const INVISIBLE_RE = /[\u0000-\u0020\u007f-\u009f\u00ad\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]/g;

/** Metin/öznitelik değeri için tam kaçış. */
export function escapeHtmlText(s: string): string {
  return s
    // Zaten geçerli bir varlık ise (&amp; &#39; ...) çift kaçış yapma.
    .replace(/&(?!(?:#\d{1,7}|#x[0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function attr(name: string, value: string): string {
  return `${name}="${escapeHtmlText(value)}"`;
}

/** Dış (http/https/mailto/tel) veya izinli bir bağlantı değerini döndürür; reddedilirse null. */
function checkLink(raw: string, opts: SanitizeOptions): string | null {
  const v = raw.trim();
  if (!v) return null;
  const probe = v.replace(INVISIBLE_RE, '');
  if (probe.startsWith('#')) {
    const frag = probe.slice(1);
    if (!frag) return '#';
    let decoded = frag;
    try { decoded = decodeURIComponent(frag); } catch { /* ham değerle devam */ }
    if (!ID_RE.test(decoded)) return null;
    return `#${opts.idPrefix || ''}${decoded}`;
  }
  if (/^(?:https?:\/\/|mailto:|tel:)/i.test(probe) && v.length <= 4096) return v;
  if (opts.allowRelativeLinks) {
    // Şemasız göreli yol: iki nokta üst üste yok (ilk '/', '?' veya '#' öncesinde), '//' ile başlamaz, ters eğik çizgi yok.
    if (!/^[a-z][a-z0-9+.\-]*:/i.test(probe) && !probe.startsWith('//') && !probe.includes('\\') && !probe.includes(':') && v.length <= 2048) {
      return v;
    }
  }
  return null;
}

function checkImageSrc(raw: string, allow: boolean | 'data'): string | null {
  if (!allow) return null;
  const v = raw.trim();
  const probe = v.replace(INVISIBLE_RE, '');
  if (/^data:/i.test(probe)) {
    // Boşluk/yeni satır base64 içinde olabilir; kaldırıp doğrula.
    const compact = v.replace(/\s+/g, '');
    return RASTER_DATA_URI.test(compact) ? compact : null;
  }
  if (allow === true && /^https?:\/\//i.test(probe) && v.length <= 4096) return v;
  return null;
}

function handleAttr(tag: string, name: string, rawValue: string, opts: SanitizeOptions): string {
  const value = friendlyAttrValue(rawValue);
  switch (name) {
    case 'href': {
      if (tag !== 'a') return '';
      const link = checkLink(value, opts);
      return link ? attr('href', link) : '';
    }
    case 'src': {
      if (tag !== 'img') return '';
      const src = checkImageSrc(value, opts.allowImages ?? true);
      return src ? attr('src', src) : '';
    }
    case 'id': {
      const v = value.trim();
      return ID_RE.test(v) ? attr('id', `${opts.idPrefix || ''}${v}`) : '';
    }
    case 'class': {
      const tokens = value.split(/\s+/).filter((t) => CLASS_TOKEN_RE.test(t)).slice(0, 10);
      return tokens.length ? attr('class', tokens.join(' ')) : '';
    }
    case 'align': {
      const v = value.trim().toLowerCase();
      return ALIGN_VALUES.includes(v) ? attr('align', v) : '';
    }
    case 'start': {
      const v = value.trim();
      return /^-?\d{1,6}$/.test(v) ? attr('start', v) : '';
    }
    case 'colspan':
    case 'rowspan': {
      const v = value.trim();
      return /^\d{1,3}$/.test(v) ? attr(name, v) : '';
    }
    case 'width':
    case 'height': {
      const v = value.trim();
      return /^\d{1,4}%?$/.test(v) ? attr(name, v) : '';
    }
    case 'alt':
    case 'title':
      return attr(name, value.slice(0, 500));
    default:
      return '';
  }
}

function handleInput(html: string): string {
  if (/^<\s*\//.test(html)) return '';
  if (!/[\s/]type\s*=\s*(?:"\s*checkbox\s*"|'\s*checkbox\s*'|checkbox(?=[\s/>]))/i.test(html)) return '';
  const checked = /[\s/"']checked(?=[\s=/>])/i.test(html);
  return `<input type="checkbox" disabled${checked ? ' checked' : ''}>`;
}

/** Önişlem: XML bildirimleri, DOCTYPE, CDATA, yorumlar. */
function preclean(html: string): string {
  let out = html;
  // Gövdesi atılacak etiketler: kapanışı yoksa metnin sonuna kadar silinir (xss "[removed]" artığı bırakmasın).
  for (const tag of stripBodyTags) {
    out = out.replace(new RegExp(String.raw`<${tag}\b[^>]*>[\s\S]*?(?:<\/${tag}\s*>|$)`, 'gi'), '');
  }
  return out
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, inner: string) => escapeHtmlText(inner))
    .replace(/<!DOCTYPE[^>]*>/gi, '');
}

/** Görseli kalmamış <img> etiketlerini okunur bir yer tutucuyla değiştirir (sanitize edilmiş çıktı üzerinde). */
function replaceSrcLessImages(html: string): string {
  return html.replace(/<img\b([^>]*)>/g, (m, attrs: string) => {
    if (/\ssrc="/.test(` ${attrs}`)) return m;
    const alt = /\balt="([^"]*)"/.exec(attrs);
    const label = alt && alt[1].trim() ? `[${t('docx.image')}: ${alt[1].trim()}]` : `[${t('docx.image')}]`;
    return `<span class="img-missing">${label}</span>`;
  });
}

/**
 * Yalnız statik belge işaretlemesine izin verir.
 * İkinci parametre geriye uyumludur: boolean (eski `allowImages`) veya SanitizeOptions.
 */
export function sanitizeDocumentHtml(html: string, options: boolean | SanitizeOptions = true): string {
  const opts: SanitizeOptions = typeof options === 'boolean' ? { allowImages: options } : { ...options };
  const whiteList: Record<string, string[]> = {};
  for (const [tag, attrs] of Object.entries(documentTags)) whiteList[tag] = [...attrs];
  if (!opts.allowImages) delete whiteList.img;

  const out = xss(preclean(String(html ?? '')), {
    whiteList,
    stripIgnoreTag: true,
    stripIgnoreTagBody: stripBodyTags,
    allowCommentTag: false,
    css: false,
    onTag: (tag: string, rawTag: string) => {
      if (tag === 'input') return handleInput(rawTag);
      return undefined;
    },
    onTagAttr: (tag: string, name: string, value: string, isWhiteAttr: boolean) => {
      if (!isWhiteAttr) return undefined;
      return handleAttr(tag, name, value, opts);
    },
  });
  const cleaned = out.replace(/\[\/?removed\]/g, '');
  return opts.allowImages ? replaceSrcLessImages(cleaned) : cleaned;
}

/** SVG is rendered as native vector nodes, never as executable WebView HTML. */
export function sanitizeSvgMarkup(svg: string): string {
  return svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(script|foreignObject|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|foreignObject|iframe|object|embed)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(?:xlink:)?href\s*=\s*("|')(?!#)[\s\S]*?\1/gi, '')
    .replace(/\s+(?:xlink:)?href\s*=\s*(?!["'])(?!#)[^\s>]+/gi, '');
}
