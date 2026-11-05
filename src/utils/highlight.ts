// highlight.js (core + seçili diller) tabanlı, satır satır token üretici.
// - Çok satırlı token'lar (yorum, şablon string) satır sınırlarında kapatılıp yeniden açılır.
// - Kaçış çözümü tek geçişte yapılır (çift çözme yok; &#x27; / &#39; / sayısal dahil).
// - Büyük dosyada vurgulama kapalıdır (düz metin döner).
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import less from 'highlight.js/lib/languages/less';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import python from 'highlight.js/lib/languages/python';
import dart from 'highlight.js/lib/languages/dart';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import groovy from 'highlight.js/lib/languages/groovy';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import swift from 'highlight.js/lib/languages/swift';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import dos from 'highlight.js/lib/languages/dos';
import powershell from 'highlight.js/lib/languages/powershell';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import makefile from 'highlight.js/lib/languages/makefile';
import ini from 'highlight.js/lib/languages/ini';
import markdown from 'highlight.js/lib/languages/markdown';
import latex from 'highlight.js/lib/languages/latex';
import lua from 'highlight.js/lib/languages/lua';
import r from 'highlight.js/lib/languages/r';
import scala from 'highlight.js/lib/languages/scala';
import perl from 'highlight.js/lib/languages/perl';
import diff from 'highlight.js/lib/languages/diff';
import { LANGUAGE_MAP } from '../services/syntaxService';

export interface Token {
  type: string;
  content: string;
}

/** Bu sınırların üstünde vurgulama yapılmaz (donma koruması). */
export const MAX_HIGHLIGHT_LINES = 5000;
export const MAX_HIGHLIGHT_CHARS = 512 * 1024;

const LANGS: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  javascript, typescript, xml, css, scss, less, json, yaml, python, dart, java, kotlin, groovy,
  c, cpp, csharp, go, rust, php, ruby, swift, sql, bash, dos, powershell, dockerfile, makefile,
  ini, markdown, latex, lua, r, scala, perl, diff,
};
Object.keys(LANGS).forEach((name) => hljs.registerLanguage(name, LANGS[name]));

/** Uzantı ('.ts', 'ts'), dosya adı ('Dockerfile') veya hljs dil adından hljs dilini bulur; yoksa null. */
export function resolveLanguage(extOrLang: string, fileName?: string): string | null {
  const key = (extOrLang || '').toLowerCase().replace(/^\./, '');
  const direct = LANGUAGE_MAP[key] || (hljs.getLanguage(key) ? key : '');
  if (direct && direct !== 'plaintext' && hljs.getLanguage(direct)) return direct;
  if (fileName) {
    const base = (fileName.split(/[\\/]/).pop() || '').toLowerCase();
    if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
    if (base === 'makefile' || base === 'gnumakefile') return 'makefile';
    if (base === '.env' || base.startsWith('.env.') || base === '.gitconfig' || base === '.editorconfig') return 'ini';
    if (base === '.bashrc' || base === '.zshrc' || base === '.profile') return 'bash';
  }
  return null;
}

const ENTITY_RE = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Tek geçişli HTML kaçış çözümü (&amp;lt; -> &lt; olarak kalır, < olmaz). */
export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(ENTITY_RE, (m: string, hex?: string, dec?: string, name?: string) => {
    if (name) return NAMED[name];
    const cp = hex ? parseInt(hex, 16) : parseInt(dec || '', 10);
    if (!isFinite(cp) || cp <= 0 || cp > 0x10ffff) return m;
    try {
      return String.fromCodePoint(cp);
    } catch {
      return m;
    }
  });
}

function scopeToType(cls: string): string {
  const parts = cls.split(/\s+/).filter(Boolean);
  const first = (parts[0] || '').replace(/^hljs-/, '');
  if (first === 'title') {
    if (parts.indexOf('class_') >= 0) return 'type';
    if (parts.indexOf('function_') >= 0) return 'function';
  }
  return first || 'text';
}

function plainLines(code: string): Token[][] {
  return code.split('\n').map((l) => (l ? [{ type: 'text', content: l }] : []));
}

const SPAN_RE = /<span class="([^"]*)">|<\/span>|([^<]+)/g;

function htmlToLines(html: string): Token[][] {
  const lines: Token[][] = [[]];
  const stack: string[] = [];
  const re = new RegExp(SPAN_RE.source, 'g');
  let m: RegExpExecArray | null;
  const push = (type: string, text: string) => {
    const cur = lines[lines.length - 1];
    const last = cur[cur.length - 1];
    if (last && last.type === type) last.content += text;
    else cur.push({ type, content: text });
  };
  while ((m = re.exec(html)) !== null) {
    if (m[1] !== undefined) {
      stack.push(scopeToType(m[1]));
    } else if (m[2] === undefined) {
      stack.pop();
    } else {
      const type = stack.length ? stack[stack.length - 1] : 'text';
      const parts = decodeEntities(m[2]).split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) lines.push([]);
        if (parts[i]) push(type, parts[i]);
      }
    }
  }
  return lines;
}

function countLines(s: string): number {
  let n = 1;
  for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) n++;
  return n;
}

/**
 * Kodu satırlara ve token'lara böler. `language` bir uzantı ya da hljs dil adı olabilir.
 * Dil bilinmiyorsa veya dosya çok büyükse düz metin döner. Asla fırlatmaz.
 */
export function highlightLines(
  code: string,
  language: string = '',
  opts: { force?: boolean; fileName?: string } = {}
): Token[][] {
  const text = code.indexOf('\r') >= 0 ? code.replace(/\r\n?/g, '\n') : code;
  const lang = resolveLanguage(language, opts.fileName);
  if (!lang) return plainLines(text);
  if (!opts.force && (text.length > MAX_HIGHLIGHT_CHARS || countLines(text) > MAX_HIGHLIGHT_LINES)) {
    return plainLines(text);
  }
  try {
    const html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    const lines = htmlToLines(html);
    return lines.length === countLines(text) ? lines : plainLines(text);
  } catch {
    return plainLines(text);
  }
}

/** Eski imza: highlightCode(code, uzantı). */
export function highlightCode(code: string, language: string = 'javascript'): Token[][] {
  return highlightLines(code, language);
}

/** Vurgulama bu içerik için etkin olur mu? (arayüz bilgi bandı için) */
export function canHighlight(
  text: string,
  language: string,
  fileName?: string
): 'yes' | 'no-language' | 'too-large' {
  if (!resolveLanguage(language, fileName)) return 'no-language';
  if (text.length > MAX_HIGHLIGHT_CHARS || countLines(text) > MAX_HIGHLIGHT_LINES) return 'too-large';
  return 'yes';
}
