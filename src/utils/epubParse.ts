import type JSZip from 'jszip';
import { sanitizeDocumentHtml } from './sanitizeHtml';
import { t as tr } from '../i18n';

/**
 * EPUB ayrıştırma yardımcıları (saf mantık; React Native bağımlılığı yok, Node'da test edilebilir).
 * Regex tabanlıdır ama etiketleri tek tek ayrıştırıp öznitelik sözlüğü çıkarır:
 * öznitelik sırası, tek/çift tırnak ve ad alanı önekleri sonucu etkilemez.
 */

export interface EpubChapter {
  id: string;
  /** Zip içindeki normalize edilmiş yol. */
  path: string;
  title: string;
}

export interface TocEntry {
  title: string;
  chapterIdx: number;
  depth: number;
  fragment: string;
}

export interface EpubBook {
  title: string;
  chapters: EpubChapter[];
  toc: TocEntry[];
}

export const CHAPTER_LINK_SCHEME = 'tdeskepub://';
export const MAX_SINGLE_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_CHAPTER_IMAGE_BYTES = 8 * 1024 * 1024;

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

export class EpubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EpubError';
  }
}

// ---------- küçük yardımcılar ----------

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos|nbsp);/g, (_m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      try { return String.fromCodePoint(code); } catch { return ''; }
    }
    switch (e) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: return ' ';
    }
  });
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    try { return decodeURI(s); } catch { return s; }
  }
}

/** `<tag a="1" b='2'>` metninden öznitelik değeri (tırnaklı); yoksa undefined. */
export function getAttr(tagText: string, name: string): string | undefined {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[\\s"'/<])${esc}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = re.exec(tagText);
  if (!m) return undefined;
  return decodeEntities(m[1] !== undefined ? m[1] : m[2]);
}

function collectTags(xml: string, tagName: string): string[] {
  const re = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tagName}\\b[^>]*>`, 'gi');
  return xml.match(re) || [];
}

/** Dizin + göreli yol → normalize edilmiş zip yolu. `..`/`.` çözülür, sorgu/çapa atılır, kök dışına taşma yok. */
export function resolvePath(baseDir: string, rel: string): string {
  let r = rel.split('#')[0].split('?')[0];
  r = safeDecode(r).replace(/\\/g, '/');
  const parts: string[] = r.startsWith('/') ? [] : baseDir.split('/').filter(Boolean);
  for (const seg of r.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i + 1) : '';
}

interface ZipIndex {
  zip: JSZip;
  byLower: Map<string, string>;
}

function buildIndex(zip: JSZip): ZipIndex {
  const byLower = new Map<string, string>();
  for (const name of Object.keys(zip.files)) {
    if (!zip.files[name].dir) byLower.set(name.toLowerCase(), name);
  }
  return { zip, byLower };
}

function findEntry(idx: ZipIndex, path: string): JSZip.JSZipObject | null {
  const direct = idx.zip.file(path);
  if (direct) return direct;
  const real = idx.byLower.get(path.toLowerCase());
  return real ? idx.zip.file(real) : null;
}

// ---------- OPF / spine / TOC ----------

interface ManifestItem { id: string; href: string; mediaType: string; properties: string }

export function parseOpf(opfXml: string, opfPath: string): {
  title: string;
  manifest: Map<string, ManifestItem>;
  spine: string[];
  tocId: string;
} {
  const xml = opfXml.replace(/<!--[\s\S]*?-->/g, '');
  const opfDir = dirOf(opfPath);

  const manifest = new Map<string, ManifestItem>();
  for (const tag of collectTags(xml, 'item')) {
    const id = getAttr(tag, 'id');
    const href = getAttr(tag, 'href');
    if (!id || href === undefined) continue;
    manifest.set(id, {
      id,
      href: resolvePath(opfDir, href),
      mediaType: (getAttr(tag, 'media-type') || '').toLowerCase(),
      properties: (getAttr(tag, 'properties') || '').toLowerCase(),
    });
  }

  const spineOpen = /<(?:[A-Za-z_][\w.-]*:)?spine\b[^>]*>/i.exec(xml);
  const tocId = spineOpen ? getAttr(spineOpen[0], 'toc') || '' : '';
  const spineBlockMatch = /<(?:[A-Za-z_][\w.-]*:)?spine\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?spine>/i.exec(xml);
  const spineXml = spineBlockMatch ? spineBlockMatch[1] : '';
  const linear: string[] = [];
  const all: string[] = [];
  for (const tag of collectTags(spineXml, 'itemref')) {
    const idref = getAttr(tag, 'idref');
    if (!idref) continue;
    all.push(idref);
    if ((getAttr(tag, 'linear') || 'yes').toLowerCase() !== 'no') linear.push(idref);
  }
  let spine = linear.length > 0 ? linear : all;

  if (spine.length === 0) {
    // Spine yoksa: manifest'teki xhtml/html öğeleri (sırayla).
    spine = [...manifest.values()].filter((it) => /x?html/.test(it.mediaType)).map((it) => it.id);
  }

  const titleMatch = /<(?:[A-Za-z_][\w.-]*:)?title\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?title>/i.exec(xml);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';
  return { title, manifest, spine, tocId };
}

function parseNavToc(navXml: string, navPath: string): { title: string; path: string; fragment: string; depth: number }[] {
  const out: { title: string; path: string; fragment: string; depth: number }[] = [];
  const navDir = dirOf(navPath);
  // Önce epub:type="toc" nav; yoksa ilk nav.
  const navBlocks = navXml.match(/<nav\b[\s\S]*?<\/nav>/gi) || [];
  let block = navBlocks.find((b) => /epub:type\s*=\s*["'][^"']*\btoc\b/i.test(b) || /\btype\s*=\s*["'][^"']*\btoc\b/i.test(b)) || navBlocks[0];
  if (!block) block = navXml;
  const re = /<(\/?)(?:ol|ul)\b[^>]*>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    if (m[2] === undefined && m[3] === undefined) {
      depth += m[1] ? -1 : 1;
      if (depth < 0) depth = 0;
      continue;
    }
    const href = getAttr(`<a ${m[2]}>`, 'href');
    if (!href) continue;
    const hash = href.indexOf('#');
    const fragment = hash >= 0 ? safeDecode(href.slice(hash + 1)) : '';
    const path = href.startsWith('#') ? '' : resolvePath(navDir, href);
    out.push({ title: stripTags(m[3]), path, fragment, depth: Math.max(0, depth - 1) });
  }
  return out;
}

function parseNcxToc(ncxXml: string, ncxPath: string): { title: string; path: string; fragment: string; depth: number }[] {
  const out: { title: string; path: string; fragment: string; depth: number }[] = [];
  const ncxDir = dirOf(ncxPath);
  const re = /<(\/?)navPoint\b[^>]*>|<navLabel\b[^>]*>[\s\S]*?<text\b[^>]*>([\s\S]*?)<\/text>[\s\S]*?<\/navLabel>|<content\b([^>]*)>/gi;
  let depth = 0;
  const pendingTitle: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(ncxXml)) !== null) {
    if (m[2] === undefined && m[3] === undefined) {
      if (m[1]) { depth = Math.max(0, depth - 1); pendingTitle.pop(); } else { depth++; pendingTitle.push(''); }
      continue;
    }
    if (m[2] !== undefined) {
      if (pendingTitle.length > 0) pendingTitle[pendingTitle.length - 1] = stripTags(m[2]);
      continue;
    }
    const src = getAttr(`<content ${m[3]}>`, 'src');
    if (!src) continue;
    const hash = src.indexOf('#');
    const fragment = hash >= 0 ? safeDecode(src.slice(hash + 1)) : '';
    out.push({
      title: pendingTitle[pendingTitle.length - 1] || '',
      path: resolvePath(ncxDir, src),
      fragment,
      depth: Math.max(0, depth - 1),
    });
  }
  return out;
}

function isDrm(encryptionXml: string): boolean {
  const algs = encryptionXml.match(/Algorithm\s*=\s*["']([^"']+)["']/gi) || [];
  return algs.some((a) => {
    const v = (/["']([^"']+)["']/.exec(a) || [])[1] || '';
    // Yazı tipi gizleme (DRM değil): IDPF ve Adobe yöntemleri.
    return !(v.startsWith('http://www.idpf.org/2008/embedding') || v.startsWith('http://ns.adobe.com/pdf/enc#RC'));
  });
}

/** Zip'ten kitap yapısını (başlık, bölüm listesi, içindekiler) okur. Bölüm içerikleri tembel okunur. */
export async function readEpub(zip: JSZip, isCancelled: () => boolean = () => false): Promise<EpubBook> {
  const idx = buildIndex(zip);

  const enc = findEntry(idx, 'META-INF/encryption.xml');
  if (enc) {
    const encXml = await enc.async('string');
    if (isDrm(encXml)) throw new EpubError(tr('epub.drm'));
  }

  // 1) container.xml → OPF yolu
  let opfPath = '';
  const container = findEntry(idx, 'META-INF/container.xml');
  if (container) {
    const cx = await container.async('string');
    const roots = collectTags(cx, 'rootfile');
    const preferred = roots.find((t) => /oebps-package/i.test(getAttr(t, 'media-type') || '')) || roots[0];
    const fp = preferred ? getAttr(preferred, 'full-path') : undefined;
    if (fp) opfPath = resolvePath('', fp);
  }
  let opfEntry = opfPath ? findEntry(idx, opfPath) : null;
  if (!opfEntry) {
    const guess = [...idx.byLower.values()].find((n) => n.toLowerCase().endsWith('.opf'));
    if (guess) { opfPath = guess; opfEntry = idx.zip.file(guess); }
  }
  if (!opfEntry) throw new EpubError(tr('epub.noOpf'));

  const opf = parseOpf(await opfEntry.async('string'), opfPath);
  if (isCancelled()) throw new EpubError('iptal');

  // 2) Spine → bölümler
  const chapters: EpubChapter[] = [];
  const chapterByPath = new Map<string, number>();
  for (const id of opf.spine) {
    const item = opf.manifest.get(id);
    if (!item) continue;
    if (item.mediaType && !/x?html|xml/.test(item.mediaType)) continue;
    const entry = findEntry(idx, item.href);
    if (!entry) continue;
    const key = entry.name.toLowerCase();
    if (chapterByPath.has(key)) continue;
    chapterByPath.set(key, chapters.length);
    chapters.push({ id, path: entry.name, title: '' });
  }
  if (chapters.length === 0) throw new EpubError(tr('epub.noChapters'));

  // 3) İçindekiler: önce EPUB3 nav, sonra NCX
  let rawToc: { title: string; path: string; fragment: string; depth: number }[] = [];
  try {
    const navItem = [...opf.manifest.values()].find((it) => /(^|\s)nav(\s|$)/.test(it.properties));
    if (navItem) {
      const e = findEntry(idx, navItem.href);
      if (e) rawToc = parseNavToc(await e.async('string'), e.name).map((t) => (t.path ? t : { ...t, path: e.name }));
    }
    if (rawToc.length === 0) {
      const ncxItem = (opf.tocId && opf.manifest.get(opf.tocId))
        || [...opf.manifest.values()].find((it) => it.mediaType === 'application/x-dtbncx+xml')
        || [...opf.manifest.values()].find((it) => it.href.toLowerCase().endsWith('.ncx'));
      if (ncxItem) {
        const e = findEntry(idx, ncxItem.href);
        if (e) rawToc = parseNcxToc(await e.async('string'), e.name);
      }
    }
  } catch {
    rawToc = [];
  }

  const toc: TocEntry[] = [];
  for (const t of rawToc) {
    const entry = findEntry(idx, t.path);
    const ci = entry ? chapterByPath.get(entry.name.toLowerCase()) : undefined;
    if (ci === undefined) continue;
    const title = t.title || tr('epub.chapterN', { n: ci + 1 });
    const prev = toc[toc.length - 1];
    if (prev && prev.chapterIdx === ci && prev.title === title && prev.fragment === t.fragment) continue;
    toc.push({ title, chapterIdx: ci, depth: Math.min(t.depth, 4), fragment: t.fragment });
  }

  // 4) Bölüm başlıkları: TOC'tan (çapasız girdi öncelikli), yoksa ilk başlık etiketi
  for (const pass of [false, true]) {
    for (const t of toc) {
      if (Boolean(t.fragment) !== pass) continue;
      const ch = chapters[t.chapterIdx];
      if (!ch.title) ch.title = t.title;
    }
  }
  if (toc.length === 0) {
    const limit = Math.min(chapters.length, 400);
    for (let i = 0; i < limit; i++) {
      if (isCancelled()) throw new EpubError('iptal');
      try {
        const e = findEntry(idx, chapters[i].path);
        if (!e) continue;
        const html = await e.async('string');
        const h = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html) || /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
        const t = h ? stripTags(h[1]) : '';
        if (t && t.length < 80) chapters[i].title = t;
      } catch { /* başlıksız devam */ }
    }
  }
  for (let i = 0; i < chapters.length; i++) {
    if (!chapters[i].title) chapters[i].title = tr('epub.chapterN', { n: i + 1 });
  }
  const finalToc = toc.length > 0
    ? toc
    : chapters.map((c, i) => ({ title: c.title, chapterIdx: i, depth: 0, fragment: '' }));

  return { title: opf.title, chapters, toc: finalToc };
}

// ---------- bölüm içeriği ----------

/** `<div/>` gibi XHTML kendi kendini kapatan (void olmayan) etiketleri HTML için açıp kapatır. */
export function expandSelfClosing(html: string): string {
  return html.replace(/<([A-Za-z][\w:-]*)((?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?)\/>/g, (m: string, name: string, attrs: string) => {
    if (VOID_TAGS.has(name.toLowerCase())) return `<${name}${attrs}>`;
    return `<${name}${attrs}></${name}>`;
  });
}

function extractBody(html: string): string {
  const m = /<body\b[^>]*>([\s\S]*?)(?:<\/body>|$)/i.exec(html);
  return m ? m[1] : html;
}

/** SVG içine sarılmış kapak/çizimleri (<svg><image href=..>) <img>'e çevirir (svg sanitize ile atılacağı için). */
function svgImagesToImg(html: string): string {
  return html.replace(/<svg\b[\s\S]*?<\/svg>/gi, (block: string) => {
    const im = /<image\b[^>]*>/i.exec(block);
    if (!im) return '';
    const href = getAttr(im[0], 'xlink:href') ?? getAttr(im[0], 'href');
    if (!href) return '';
    return `<img src="${href.replace(/"/g, '&quot;')}" alt="">`;
  });
}

function sniffMime(b64: string): string | null {
  if (b64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('R0lGOD')) return 'image/gif';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return null;
}

async function imageDataUri(idx: ZipIndex, path: string, budget: { left: number }): Promise<string> {
  const entry = findEntry(idx, path);
  if (!entry) return '';
  const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (typeof declared === 'number' && declared > MAX_SINGLE_IMAGE_BYTES) return '';
  if (budget.left <= 0) return '';
  const b64 = await entry.async('base64');
  const rawSize = Math.floor((b64.length * 3) / 4);
  if (rawSize > MAX_SINGLE_IMAGE_BYTES || rawSize > budget.left) return '';
  const mime = sniffMime(b64);
  if (!mime) return '';
  budget.left -= rawSize;
  return `data:${mime};base64,${b64}`;
}

/**
 * Bölümün güvenli HTML gövdesini üretir: görseller zip'ten data URI'ye gömülür (tek ≤2MB, bölüm başına ≤8MB),
 * içerik sanitize edilir, iç bağlantılar `tdeskepub://<bölüm>#çapa` biçimine, dış bağlantılar olduğu gibi bırakılır.
 */
export async function readChapterHtml(zip: JSZip, book: EpubBook, chapterIdx: number): Promise<string> {
  const idx = buildIndex(zip);
  const chapter = book.chapters[chapterIdx];
  if (!chapter) throw new EpubError(tr('epub.chapterMissing'));
  const entry = findEntry(idx, chapter.path);
  if (!entry) throw new EpubError(tr('epub.chapterFileMissing'));
  const chapterDir = dirOf(chapter.path);

  let html = expandSelfClosing(svgImagesToImg(extractBody(await entry.async('string'))));

  // Görselleri çöz
  const imgTags = html.match(/<img\b[^>]*>/gi) || [];
  const srcs = new Set<string>();
  for (const t of imgTags) {
    const s = getAttr(t, 'src');
    if (s && !/^(?:data:|https?:|\/\/)/i.test(s.trim())) srcs.add(s);
  }
  const resolved = new Map<string, string>();
  const budget = { left: MAX_CHAPTER_IMAGE_BYTES };
  for (const s of srcs) {
    resolved.set(s, await imageDataUri(idx, resolvePath(chapterDir, s), budget));
  }
  html = html.replace(/<img\b[^>]*>/gi, (tag: string) => {
    const s = getAttr(tag, 'src');
    let rest = tag.replace(/\s(?:src|srcset)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
    if (s === undefined) return rest;
    let uri = '';
    if (/^data:/i.test(s.trim())) uri = s.trim();
    else if (resolved.has(s)) uri = resolved.get(s) || '';
    if (!uri) return rest;
    rest = rest.replace(/^<img\b/i, `<img src="${uri}"`);
    return rest;
  });

  let safe = sanitizeDocumentHtml(html, { allowImages: 'data', allowRelativeLinks: true });

  // Bağlantıları yeniden yaz (sanitize çıktısı daima çift tırnaklı).
  safe = safe.replace(/<a\b([^>]*?)\shref="([^"]*)"/g, (m: string, before: string, hrefEsc: string) => {
    const href = hrefEsc.replace(/&amp;/g, '&');
    if (href.startsWith('#') || /^(?:https?:|mailto:|tel:)/i.test(href)) return m;
    const hash = href.indexOf('#');
    const fragment = hash >= 0 ? href.slice(hash + 1) : '';
    const pathPart = hash >= 0 ? href.slice(0, hash) : href;
    const target = pathPart ? resolvePath(chapterDir, pathPart) : chapter.path;
    const found = findEntry(idx, target);
    const ci = found ? book.chapters.findIndex((c) => c.path === found.name) : -1;
    if (ci < 0) return `<a${before}`;
    return `<a${before} href="${CHAPTER_LINK_SCHEME}${ci}#${encodeURIComponent(safeDecode(fragment))}"`;
  });
  return safe;
}

/** `tdeskepub://3#abc` → {chapterIdx: 3, fragment: 'abc'} */
export function parseChapterLink(url: string): { chapterIdx: number; fragment: string } | null {
  if (!url.startsWith(CHAPTER_LINK_SCHEME)) return null;
  const rest = url.slice(CHAPTER_LINK_SCHEME.length);
  const hash = rest.indexOf('#');
  const numPart = (hash >= 0 ? rest.slice(0, hash) : rest).replace(/\/+$/, '');
  if (!/^\d{1,6}$/.test(numPart)) return null;
  return { chapterIdx: parseInt(numPart, 10), fragment: hash >= 0 ? safeDecode(rest.slice(hash + 1)) : '' };
}
