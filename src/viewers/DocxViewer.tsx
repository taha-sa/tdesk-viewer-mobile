import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import JSZip from 'jszip';
import * as FileSystem from 'expo-file-system';
import { FileInfo, AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import { FileService, base64ToBytes } from '../services/fileService';

interface DocxViewerProps {
  file: FileInfo;
  appTheme?: AppThemeMode;
}

const MAX_DOCX_BYTES = 40 * 1024 * 1024; // dosyanın kendisi
const MAX_XML_BYTES = 30 * 1024 * 1024; // tek XML parçası (açılmış)
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // tek görsel
const MAX_IMAGES_TOTAL = 15 * 1024 * 1024; // toplam görsel
const MAX_IMAGE_COUNT = 80;
const MAX_TEXT_CHARS = 3000000; // üretilecek metin (görsel hariç)

// @@PURE-START (React/RN/JSZip bağımlılığı olmayan saf mantık; node testi bu bölümü çıkarıp çalıştırır)
interface XNode {
  n: string;
  a: Record<string, string>;
  c: Array<XNode | string>;
}

const ENTITY_MAP: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m: string, g: string) => {
    if (g.charAt(0) === '#') {
      const cp = g.charAt(1) === 'x' || g.charAt(1) === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      if (!isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '';
      if (cp < 32 && cp !== 9 && cp !== 10 && cp !== 13) return '';
      return String.fromCodePoint(cp);
    }
    return ENTITY_MAP[g] !== undefined ? ENTITY_MAP[g] : m;
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function parseAttrs(str: string): Record<string, string> {
  const a: Record<string, string> = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    a[m[1]] = decodeEntities(m[2] !== undefined ? m[2] : m[3]);
  }
  return a;
}

/** Küçük, DOM'suz XML ayrıştırıcı. Yorum/PI/DOCTYPE atlanır, CDATA metne eklenir, varlıklar çözülür. */
function parseXml(xml: string): XNode {
  const root: XNode = { n: '#root', a: {}, c: [] };
  const stack: XNode[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/)?([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m.index > last) {
      const t = xml.slice(last, m.index);
      if (t.length > 0) stack[stack.length - 1].c.push(decodeEntities(t));
    }
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      stack[stack.length - 1].c.push(m[1]);
    } else if (m[2] === '/') {
      const name = m[3];
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].n === name) {
          stack.length = k;
          break;
        }
      }
    } else if (m[3] !== undefined) {
      const node: XNode = { n: m[3], a: m[4] ? parseAttrs(m[4]) : {}, c: [] };
      stack[stack.length - 1].c.push(node);
      if (m[5] !== '/' && stack.length < 400) stack.push(node);
    }
  }
  return root;
}

function kids(n: XNode | undefined | null, name: string): XNode[] {
  const out: XNode[] = [];
  if (!n) return out;
  for (const ch of n.c) if (typeof ch !== 'string' && ch.n === name) out.push(ch);
  return out;
}
function kid(n: XNode | undefined | null, name: string): XNode | undefined {
  if (!n) return undefined;
  for (const ch of n.c) if (typeof ch !== 'string' && ch.n === name) return ch;
  return undefined;
}
function val(n: XNode | undefined | null, attr = 'w:val'): string | undefined {
  return n ? n.a[attr] : undefined;
}
function descendant(n: XNode | undefined | null, name: string, depth = 0): XNode | undefined {
  if (!n || depth > 60) return undefined;
  for (const ch of n.c) {
    if (typeof ch === 'string') continue;
    if (ch.n === name) return ch;
    const d = descendant(ch, name, depth + 1);
    if (d) return d;
  }
  return undefined;
}
function directText(n: XNode): string {
  let s = '';
  for (const ch of n.c) if (typeof ch === 'string') s += ch;
  return s;
}
function isOn(el: XNode | undefined): boolean {
  if (!el) return false;
  const v = (el.a['w:val'] || '').toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
}
function toInt(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = parseInt(s, 10);
  return isFinite(n) ? n : undefined;
}

// ----- renk yardımcıları
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function luminance(rgb: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ----- stiller
interface RunProps {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  sz?: number;
  color?: string;
  sup?: boolean;
  sub?: boolean;
  hl?: boolean;
  vanish?: boolean;
  caps?: boolean;
}

function parseRunProps(rPr: XNode | undefined): RunProps {
  const r: RunProps = {};
  if (!rPr) return r;
  const b = kid(rPr, 'w:b');
  if (b) r.b = isOn(b);
  const i = kid(rPr, 'w:i');
  if (i) r.i = isOn(i);
  const u = kid(rPr, 'w:u');
  if (u) r.u = isOn(u);
  const st = kid(rPr, 'w:strike') || kid(rPr, 'w:dstrike');
  if (st) r.s = isOn(st);
  const sz = toInt(val(kid(rPr, 'w:sz')));
  if (sz !== undefined && sz > 0) r.sz = sz;
  const col = val(kid(rPr, 'w:color'));
  if (col && /^[0-9A-Fa-f]{6}$/.test(col)) r.color = col.toUpperCase();
  const va = val(kid(rPr, 'w:vertAlign'));
  if (va === 'superscript') {
    r.sup = true;
    r.sub = false;
  } else if (va === 'subscript') {
    r.sub = true;
    r.sup = false;
  } else if (va === 'baseline') {
    r.sup = false;
    r.sub = false;
  }
  const hl = val(kid(rPr, 'w:highlight'));
  if (hl !== undefined) r.hl = hl !== 'none';
  const vn = kid(rPr, 'w:vanish');
  if (vn) r.vanish = isOn(vn);
  const caps = kid(rPr, 'w:caps') || kid(rPr, 'w:smallCaps');
  if (caps) r.caps = isOn(caps);
  return r;
}

function mergeRun(...list: RunProps[]): RunProps {
  const out: RunProps = {};
  const keys: Array<keyof RunProps> = ['b', 'i', 'u', 's', 'sz', 'color', 'sup', 'sub', 'hl', 'vanish', 'caps'];
  for (const p of list) {
    for (const k of keys) {
      if (p[k] !== undefined) (out as Record<string, unknown>)[k] = p[k];
    }
  }
  return out;
}

interface StyleDef {
  id: string;
  type: string;
  name: string;
  basedOn?: string;
  outline?: number;
  numId?: string;
  ilvl?: string;
  jc?: string;
  run: RunProps;
  bordered: boolean;
}
interface StylesInfo {
  defs: Map<string, StyleDef>;
  defaultSz: number;
  cache: Map<string, ResolvedStyle>;
}
interface ResolvedStyle {
  name: string;
  outline?: number;
  numId?: string;
  ilvl?: string;
  jc?: string;
  run: RunProps;
  bordered: boolean;
}

function bordersNonNone(b: XNode | undefined): boolean {
  if (!b) return false;
  for (const ch of b.c) {
    if (typeof ch === 'string') continue;
    const v = (ch.a['w:val'] || '').toLowerCase();
    if (v && v !== 'nil' && v !== 'none') return true;
  }
  return false;
}

function parseStyles(xml: string | undefined): StylesInfo {
  const info: StylesInfo = { defs: new Map(), defaultSz: 22, cache: new Map() };
  if (!xml) return info;
  const root = parseXml(xml);
  const styles = kid(root, 'w:styles');
  if (!styles) return info;
  const dsz = toInt(val(kid(kid(kid(kid(styles, 'w:docDefaults'), 'w:rPrDefault'), 'w:rPr'), 'w:sz')));
  if (dsz && dsz > 0) info.defaultSz = dsz;
  for (const st of kids(styles, 'w:style')) {
    const id = st.a['w:styleId'];
    if (!id) continue;
    const pPr = kid(st, 'w:pPr');
    const numPr = kid(pPr, 'w:numPr');
    const def: StyleDef = {
      id,
      type: st.a['w:type'] || 'paragraph',
      name: (val(kid(st, 'w:name')) || '').trim(),
      basedOn: val(kid(st, 'w:basedOn')),
      outline: toInt(val(kid(pPr, 'w:outlineLvl'))),
      numId: val(kid(numPr, 'w:numId')),
      ilvl: val(kid(numPr, 'w:ilvl')),
      jc: val(kid(pPr, 'w:jc')),
      run: parseRunProps(kid(st, 'w:rPr')),
      bordered: bordersNonNone(kid(kid(st, 'w:tblPr'), 'w:tblBorders')),
    };
    info.defs.set(id, def);
  }
  return info;
}

function resolveStyle(info: StylesInfo, id: string | undefined): ResolvedStyle {
  const empty: ResolvedStyle = { name: '', run: {}, bordered: false };
  if (!id) return empty;
  const cached = info.cache.get(id);
  if (cached) return cached;
  const chain: StyleDef[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = id;
  while (cur && !seen.has(cur) && chain.length < 12) {
    seen.add(cur);
    const d = info.defs.get(cur);
    if (!d) break;
    chain.push(d);
    cur = d.basedOn;
  }
  const res: ResolvedStyle = { name: chain.length ? chain[0].name : '', run: {}, bordered: false };
  for (let k = chain.length - 1; k >= 0; k--) {
    const d = chain[k];
    res.run = mergeRun(res.run, d.run);
    if (d.outline !== undefined) res.outline = d.outline;
    if (d.numId !== undefined) res.numId = d.numId;
    if (d.ilvl !== undefined) res.ilvl = d.ilvl;
    if (d.jc !== undefined) res.jc = d.jc;
    if (d.bordered) res.bordered = true;
  }
  info.cache.set(id, res);
  return res;
}

/** 1-6 arası başlık düzeyi; başlık değilse 0. 'title' stili için 1 döner. */
function headingLevel(name: string, outline: number | undefined): number {
  const nm = name.toLowerCase();
  const m = /^(heading|başlık|baslik|überschrift|uberschrift|titre|título|titulo|titolo)\s*([1-9])$/.exec(nm);
  if (m) return Math.min(6, parseInt(m[2], 10));
  if (nm === 'title' || nm === 'konu başlığı' || nm === 'konu basligi' || nm === 'titel') return 1;
  if (outline !== undefined && outline >= 0 && outline <= 8) return Math.min(6, outline + 1);
  return 0;
}

// ----- numaralandırma
interface NumLevel {
  fmt: string;
  start: number;
}
interface NumberingInfo {
  abs: Map<string, Map<number, NumLevel>>;
  nums: Map<string, string>;
}

function parseNumbering(xml: string | undefined): NumberingInfo {
  const info: NumberingInfo = { abs: new Map(), nums: new Map() };
  if (!xml) return info;
  const root = parseXml(xml);
  const numbering = kid(root, 'w:numbering');
  if (!numbering) return info;
  for (const an of kids(numbering, 'w:abstractNum')) {
    const id = an.a['w:abstractNumId'];
    if (id === undefined) continue;
    const levels = new Map<number, NumLevel>();
    for (const lvl of kids(an, 'w:lvl')) {
      const il = toInt(lvl.a['w:ilvl']);
      if (il === undefined) continue;
      levels.set(il, {
        fmt: val(kid(lvl, 'w:numFmt')) || 'decimal',
        start: toInt(val(kid(lvl, 'w:start'))) ?? 1,
      });
    }
    info.abs.set(id, levels);
  }
  for (const num of kids(numbering, 'w:num')) {
    const id = num.a['w:numId'];
    const abs = val(kid(num, 'w:abstractNumId'));
    if (id !== undefined && abs !== undefined) info.nums.set(id, abs);
  }
  return info;
}

function numLevel(info: NumberingInfo, numId: string, ilvl: number): NumLevel {
  const abs = info.nums.get(numId);
  const levels = abs !== undefined ? info.abs.get(abs) : undefined;
  const l = levels ? levels.get(ilvl) : undefined;
  return l || { fmt: 'bullet', start: 1 };
}

function olType(fmt: string): string {
  switch (fmt) {
    case 'lowerLetter':
      return 'a';
    case 'upperLetter':
      return 'A';
    case 'lowerRoman':
      return 'i';
    case 'upperRoman':
      return 'I';
    default:
      return '1';
  }
}

function numToLetters(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(97 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s || 'a';
}

// ----- ilişkiler
interface Rel {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

function parseRels(xml: string | undefined): Record<string, Rel> {
  const out: Record<string, Rel> = {};
  if (!xml) return out;
  const re = /<Relationship\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const a = parseAttrs(m[1]);
    if (!a.Id) continue;
    out[a.Id] = { id: a.Id, type: a.Type || '', target: a.Target || '', external: (a.TargetMode || '').toLowerCase() === 'external' };
  }
  return out;
}

/** Bağıl hedefi (../ dahil) zip içi mutlak yola çevirir. */
function resolvePartPath(baseDir: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : baseDir + target).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

function safeHref(url: string | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f]/.test(u)) return null;
  if (!/^(https?:|mailto:|tel:)/i.test(u)) return null;
  return u;
}

function parseHyperlinkInstr(instr: string): string | null {
  const m = /^\s*HYPERLINK\s+(?:"([^"]*)"|(\S+))/i.exec(instr);
  if (!m) return null;
  return safeHref(m[1] !== undefined ? m[1] : m[2]);
}

function imageMime(path: string): string | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  const ext = m ? m[1].toLowerCase() : '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'webp':
      return 'image/webp';
    default:
      return null;
  }
}

/** document.xml içinde başvurulan görsel ilişki kimlikleri (görünüş sırasıyla, yinelenmeden). */
function collectImageRIds(documentXml: string, rels: Record<string, Rel>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\br:(?:embed|id)\s*=\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(documentXml)) !== null) {
    const id = m[1];
    if (seen.has(id)) continue;
    const rel = rels[id];
    if (rel && !rel.external && /\/image$/.test(rel.type)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function findHeaderFooterRefs(documentXml: string): { header?: string; footer?: string } {
  const res: { header?: string; footer?: string } = {};
  const re = /<w:(header|footer)Reference\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(documentXml)) !== null) {
    const a = parseAttrs(m[2]);
    const id = a['r:id'];
    if (!id) continue;
    const t = a['w:type'] || 'default';
    const key = m[1] === 'header' ? 'header' : 'footer';
    if (t === 'default' && res[key] === undefined) res[key] = id;
  }
  return res;
}

// ----- üretici
interface DocxInput {
  documentXml: string;
  stylesXml?: string;
  numberingXml?: string;
  relsXml?: string;
  footnotesXml?: string;
  endnotesXml?: string;
  headerXml?: string;
  footerXml?: string;
  images: Record<string, string | null>;
  paperHex: string;
}

interface Ctx {
  styles: StylesInfo;
  numbering: NumberingInfo;
  rels: Record<string, Rel>;
  images: Record<string, string | null>;
  paper: [number, number, number];
  counters: Record<string, number[]>;
  fnOrder: string[];
  enOrder: string[];
  size: number;
  truncated: boolean;
  textOnly: boolean;
  depth: number;
  pending: string[];
  skippedImages: number;
  fields: Array<{ instr: string; link: boolean }>;
}

function newLink(href: string): string {
  return `<a href="${escapeHtml(href)}">`;
}

function refNumber(order: string[], id: string): number {
  let idx = order.indexOf(id);
  if (idx < 0) {
    order.push(id);
    idx = order.length - 1;
  }
  return idx + 1;
}

function renderDrawing(node: XNode, ctx: Ctx): string {
  if (ctx.textOnly || ctx.depth > 4) return '';
  let scope: XNode = node;
  if (node.n === 'mc:AlternateContent') {
    const choice = kid(node, 'mc:Choice') || kid(node, 'mc:Fallback');
    if (!choice) return '';
    scope = choice;
  }
  let html = '';
  const blip = descendant(scope, 'a:blip');
  const vimg = blip ? undefined : descendant(scope, 'v:imagedata');
  const rid = blip ? blip.a['r:embed'] : vimg ? vimg.a['r:id'] : undefined;
  if (rid) {
    const uri = ctx.images[rid];
    if (typeof uri === 'string') {
      const ext = descendant(scope, 'wp:extent');
      const cx = ext ? toInt(ext.a.cx) : undefined;
      const docPr = descendant(scope, 'wp:docPr');
      const alt = docPr && docPr.a.descr ? docPr.a.descr : 'Görsel';
      let style = 'max-width:100%;height:auto;';
      if (cx && cx > 0) {
        const px = Math.max(8, Math.min(2000, Math.round(cx / 9525)));
        style = `width:${px}px;` + style;
      }
      html += `<img src="${uri}" alt="${escapeHtml(alt)}" style="${style}">`;
    } else {
      ctx.skippedImages++;
      html += '<span class="ph">[Görsel]</span>';
    }
  }
  const tx = descendant(scope, 'w:txbxContent');
  if (tx) {
    const savedText = ctx.textOnly;
    ctx.textOnly = true;
    ctx.depth++;
    const inner = renderBlocks(tx.c, ctx);
    ctx.depth--;
    ctx.textOnly = savedText;
    if (inner) ctx.pending.push(`<div class="tx">${inner}</div>`);
  }
  return html;
}

function wrapRun(text: string, props: RunProps, ctx: Ctx): string {
  if (!text) return '';
  let out = text;
  const styles: string[] = [];
  if (props.color) {
    const rgb = hexToRgb(props.color);
    if (rgb && contrastRatio(rgb, ctx.paper) >= 3) styles.push(`color:#${props.color}`);
  }
  if (props.sz && ctx.styles.defaultSz > 0) {
    const em = Math.round((props.sz / ctx.styles.defaultSz) * 20) / 20;
    if (Math.abs(em - 1) > 0.06) styles.push(`font-size:${Math.max(0.5, Math.min(4, em))}em`);
  }
  if (props.caps) styles.push('text-transform:uppercase');
  if (styles.length) out = `<span style="${styles.join(';')}">${out}</span>`;
  if (props.hl) out = `<mark>${out}</mark>`;
  if (props.sub) out = `<sub>${out}</sub>`;
  if (props.sup) out = `<sup>${out}</sup>`;
  if (props.s) out = `<s>${out}</s>`;
  if (props.u) out = `<u>${out}</u>`;
  if (props.i) out = `<em>${out}</em>`;
  if (props.b) out = `<strong>${out}</strong>`;
  return out;
}

function renderRun(node: XNode, ctx: Ctx, base: RunProps): string {
  const rPr = kid(node, 'w:rPr');
  const direct = parseRunProps(rPr);
  const cs = resolveStyle(ctx.styles, val(kid(rPr, 'w:rStyle'))).run;
  const props = mergeRun(base, cs, direct);
  let pre = '';
  let post = '';
  let body = '';
  for (const ch of node.c) {
    if (typeof ch === 'string') continue;
    switch (ch.n) {
      case 'w:t': {
        const t = directText(ch);
        ctx.size += t.length;
        body += escapeHtml(t);
        break;
      }
      case 'w:tab':
        body += '&emsp;';
        break;
      case 'w:br':
      case 'w:cr':
        body += ch.a['w:type'] === 'page' ? '<hr class="pb">' : '<br>';
        break;
      case 'w:noBreakHyphen':
        body += '&#8209;';
        break;
      case 'w:footnoteReference': {
        const id = ch.a['w:id'];
        if (id !== undefined && !ctx.textOnly) body += `<sup class="fn">[${refNumber(ctx.fnOrder, id)}]</sup>`;
        break;
      }
      case 'w:endnoteReference': {
        const id = ch.a['w:id'];
        if (id !== undefined && !ctx.textOnly) body += `<sup class="fn">[${numToLetters(refNumber(ctx.enOrder, id))}]</sup>`;
        break;
      }
      case 'w:fldChar': {
        const t = ch.a['w:fldCharType'];
        if (t === 'begin') {
          ctx.fields.push({ instr: '', link: false });
        } else if (t === 'separate') {
          const f = ctx.fields[ctx.fields.length - 1];
          if (f && !f.link) {
            const href = parseHyperlinkInstr(f.instr);
            if (href) {
              f.link = true;
              post += newLink(href);
            }
          }
        } else if (t === 'end') {
          const f = ctx.fields.pop();
          if (f && f.link) pre += '</a>';
        }
        break;
      }
      case 'w:instrText': {
        const f = ctx.fields[ctx.fields.length - 1];
        if (f) f.instr += directText(ch);
        break;
      }
      case 'w:drawing':
      case 'w:pict':
      case 'mc:AlternateContent':
        body += renderDrawing(ch, ctx);
        break;
      default:
        break;
    }
  }
  if (props.vanish) return pre + post;
  return pre + wrapRun(body, props, ctx) + post;
}

function renderInline(nodes: Array<XNode | string>, ctx: Ctx, base: RunProps, depth = 0): string {
  if (depth > 40) return '';
  let out = '';
  for (const ch of nodes) {
    if (typeof ch === 'string') continue;
    switch (ch.n) {
      case 'w:r':
        out += renderRun(ch, ctx, base);
        break;
      case 'w:hyperlink': {
        const rid = ch.a['r:id'];
        const rel = rid ? ctx.rels[rid] : undefined;
        const href = rel && rel.external ? safeHref(rel.target) : null;
        const inner = renderInline(ch.c, ctx, base, depth + 1);
        out += href && inner ? `${newLink(href)}${inner}</a>` : inner;
        break;
      }
      case 'w:fldSimple': {
        const href = parseHyperlinkInstr(ch.a['w:instr'] || '');
        const inner = renderInline(ch.c, ctx, base, depth + 1);
        out += href && inner ? `${newLink(href)}${inner}</a>` : inner;
        break;
      }
      case 'w:sdt': {
        const content = kid(ch, 'w:sdtContent');
        if (content) out += renderInline(content.c, ctx, base, depth + 1);
        break;
      }
      case 'w:ins':
      case 'w:moveTo':
      case 'w:smartTag':
      case 'w:customXml':
      case 'w:sdtContent':
      case 'w:bdo':
      case 'w:dir':
        out += renderInline(ch.c, ctx, base, depth + 1);
        break;
      default:
        break;
    }
  }
  return out;
}

interface ListLevel {
  numId: string;
  ilvl: number;
  tag: string;
}

class ListState {
  stack: ListLevel[] = [];
  private ctx: Ctx;
  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }
  item(numId: string, ilvlRaw: number, inner: string): string {
    const L = Math.max(0, Math.min(8, ilvlRaw));
    const ctx = this.ctx;
    let out = '';
    while (this.stack.length > 0 && this.stack[this.stack.length - 1].ilvl > L) {
      const t = this.stack.pop() as ListLevel;
      out += `</li></${t.tag}>`;
    }
    const lvl = numLevel(ctx.numbering, numId, L);
    const top = this.stack.length > 0 ? this.stack[this.stack.length - 1] : undefined;
    const counters = ctx.counters[numId] || (ctx.counters[numId] = []);
    if (top && top.ilvl === L && top.numId === numId) {
      out += '</li><li>';
    } else {
      if (top && top.ilvl === L) {
        this.stack.pop();
        out += `</li></${top.tag}>`;
      }
      const tag = lvl.fmt === 'bullet' || lvl.fmt === 'none' ? 'ul' : 'ol';
      if (tag === 'ol') {
        const cur = counters[L] !== undefined ? counters[L] : lvl.start - 1;
        const startAttr = cur + 1 !== 1 ? ` start="${cur + 1}"` : '';
        out += `<ol type="${olType(lvl.fmt)}"${startAttr}><li>`;
      } else {
        out += `<ul${lvl.fmt === 'none' ? ' style="list-style:none"' : ''}><li>`;
      }
      this.stack.push({ numId, ilvl: L, tag });
    }
    counters[L] = (counters[L] !== undefined ? counters[L] : lvl.start - 1) + 1;
    counters.length = L + 1;
    return out + inner;
  }
  closeAll(): string {
    let out = '';
    while (this.stack.length > 0) {
      const t = this.stack.pop() as ListLevel;
      out += `</li></${t.tag}>`;
    }
    return out;
  }
}

function renderParagraph(p: XNode, ctx: Ctx, lists: ListState, emptyState: { last: boolean }): string {
  const pPr = kid(p, 'w:pPr');
  const styleId = val(kid(pPr, 'w:pStyle'));
  const rs = resolveStyle(ctx.styles, styleId);
  const numPr = kid(pPr, 'w:numPr');
  let numId = val(kid(numPr, 'w:numId'));
  let ilvlStr = val(kid(numPr, 'w:ilvl'));
  if (numId === undefined && !numPr) {
    numId = rs.numId;
    ilvlStr = rs.ilvl;
  }
  const isList = numId !== undefined && numId !== '0';
  const outline = toInt(val(kid(pPr, 'w:outlineLvl'))) ?? rs.outline;
  const level = isList ? 0 : headingLevel(rs.name, outline);
  const jc = val(kid(pPr, 'w:jc')) || rs.jc;
  const baseRun: RunProps = { ...rs.run };
  if (level > 0) {
    delete baseRun.b;
    delete baseRun.sz;
    delete baseRun.color;
  }
  const inner = renderInline(p.c, ctx, baseRun);
  const pending = ctx.pending.length ? ctx.pending.join('') : '';
  ctx.pending = [];
  const hasPageBreak = isOn(kid(pPr, 'w:pageBreakBefore'));
  const pb = hasPageBreak ? '<hr class="pb">' : '';

  if (!inner && !pending) {
    if (isList) return '';
    const closedEmpty = lists.closeAll();
    if (emptyState.last) return closedEmpty + pb;
    emptyState.last = true;
    return closedEmpty + pb + '<p class="e">&nbsp;</p>';
  }
  emptyState.last = false;
  ctx.size += 40;

  if (isList) {
    const il = toInt(ilvlStr) ?? 0;
    return pb + lists.item(numId as string, il, inner + pending);
  }
  const closed = lists.closeAll();
  if (!inner) return closed + pb + pending;

  const styleParts: string[] = [];
  if (jc === 'center') styleParts.push('text-align:center');
  else if (jc === 'right' || jc === 'end') styleParts.push('text-align:right');
  else if (jc === 'both' || jc === 'distribute') styleParts.push('text-align:justify');
  const indL = toInt(kid(pPr, 'w:ind')?.a['w:left']) ?? toInt(kid(pPr, 'w:ind')?.a['w:start']);
  if (indL && indL > 0 && level === 0) styleParts.push(`margin-left:${Math.min(300, Math.round(indL / 15))}px`);
  const styleAttr = styleParts.length ? ` style="${styleParts.join(';')}"` : '';
  const dirAttr = isOn(kid(pPr, 'w:bidi')) ? ' dir="rtl"' : '';
  const tag = level > 0 ? `h${level}` : 'p';
  return closed + pb + `<${tag}${styleAttr}${dirAttr}>${inner}</${tag}>` + pending;
}

interface Cell {
  node: XNode;
  col: number;
  span: number;
  vm: 'restart' | 'cont' | null;
  skip: boolean;
  rowspan: number;
}

function renderTable(tbl: XNode, ctx: Ctx): string {
  if (ctx.depth > 5) return '<p class="ph">[İç içe tablo gösterilemiyor]</p>';
  const tblPr = kid(tbl, 'w:tblPr');
  const styleRes = resolveStyle(ctx.styles, val(kid(tblPr, 'w:tblStyle')));
  const rowsNodes = kids(tbl, 'w:tr');
  let anyCellBorder = false;
  const matrix: Array<{ cells: Cell[]; header: boolean }> = rowsNodes.map((tr) => {
    const cells: Cell[] = [];
    let col = 0;
    for (const tc of kids(tr, 'w:tc')) {
      const tcPr = kid(tc, 'w:tcPr');
      const span = Math.max(1, Math.min(64, toInt(val(kid(tcPr, 'w:gridSpan'))) ?? 1));
      const vmEl = kid(tcPr, 'w:vMerge');
      const vm: Cell['vm'] = vmEl ? (vmEl.a['w:val'] === 'restart' ? 'restart' : 'cont') : null;
      if (bordersNonNone(kid(tcPr, 'w:tcBorders'))) anyCellBorder = true;
      cells.push({ node: tc, col, span, vm, skip: false, rowspan: 1 });
      col += span;
    }
    return { cells, header: isOn(kid(kid(tr, 'w:trPr'), 'w:tblHeader')) };
  });
  for (let r = 0; r < matrix.length; r++) {
    for (const c of matrix[r].cells) {
      if (c.vm !== 'restart') continue;
      for (let rr = r + 1; rr < matrix.length; rr++) {
        const next = matrix[rr].cells.find((x) => x.col === c.col && x.vm === 'cont' && !x.skip);
        if (!next) break;
        next.skip = true;
        c.rowspan++;
      }
    }
  }
  const bordered = bordersNonNone(kid(tblPr, 'w:tblBorders')) || styleRes.bordered || anyCellBorder;
  let html = `<div class="tw"><table class="${bordered ? 'b' : 'n'}"><tbody>`;
  ctx.depth++;
  for (const row of matrix) {
    html += '<tr>';
    for (const c of row.cells) {
      if (c.skip) continue;
      const tcPr = kid(c.node, 'w:tcPr');
      const fill = val(kid(tcPr, 'w:shd'), 'w:fill');
      let style = '';
      if (fill && /^[0-9A-Fa-f]{6}$/.test(fill)) {
        const rgb = hexToRgb(fill) as [number, number, number];
        style = ` style="background-color:#${fill.toUpperCase()};color:${luminance(rgb) > 0.4 ? '#111111' : '#FFFFFF'}"`;
      }
      const tag = row.header ? 'th' : 'td';
      const attrs = (c.span > 1 ? ` colspan="${c.span}"` : '') + (c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : '');
      const inner = renderBlocks(c.node.c, ctx);
      html += `<${tag}${attrs}${style}>${inner || '&nbsp;'}</${tag}>`;
      ctx.size += 20;
    }
    html += '</tr>';
  }
  ctx.depth--;
  html += '</tbody></table></div>';
  return html;
}

function renderBlocks(nodes: Array<XNode | string>, ctx: Ctx): string {
  let out = '';
  const lists = new ListState(ctx);
  const emptyState = { last: false };
  for (const node of nodes) {
    if (typeof node === 'string') continue;
    if (ctx.size > MAX_TEXT_CHARS) {
      ctx.truncated = true;
      break;
    }
    switch (node.n) {
      case 'w:p':
        out += renderParagraph(node, ctx, lists, emptyState);
        break;
      case 'w:tbl':
        out += lists.closeAll() + renderTable(node, ctx);
        emptyState.last = false;
        break;
      case 'w:sdt':
      case 'w:customXml':
      case 'w:ins':
      case 'w:smartTag': {
        const content = node.n === 'w:sdt' ? kid(node, 'w:sdtContent') : node;
        if (content && ctx.depth < 8) {
          out += lists.closeAll();
          ctx.depth++;
          out += renderBlocks(content.c, ctx);
          ctx.depth--;
        }
        break;
      }
      default:
        break;
    }
  }
  return out + lists.closeAll();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function renderNotes(xml: string | undefined, rootName: string, itemName: string, order: string[], ctx: Ctx, ordered: 'decimal' | 'letter'): string {
  if (!xml || order.length === 0) return '';
  const root = kid(parseXml(xml), rootName);
  if (!root) return '';
  const byId = new Map<string, XNode>();
  for (const it of kids(root, itemName)) {
    const id = it.a['w:id'];
    if (id !== undefined) byId.set(id, it);
  }
  const saved = ctx.textOnly;
  ctx.textOnly = true;
  let items = '';
  for (const id of order) {
    const it = byId.get(id);
    const inner = it ? renderBlocks(it.c, ctx) : '';
    items += `<li>${inner || '&nbsp;'}</li>`;
  }
  ctx.textOnly = saved;
  return `<ol type="${ordered === 'letter' ? 'a' : '1'}" class="notes">${items}</ol>`;
}

function renderDocxHtml(inp: DocxInput): { html: string; notes: string[] } {
  const paper = hexToRgb(inp.paperHex) || ([255, 255, 255] as [number, number, number]);
  const ctx: Ctx = {
    styles: parseStyles(inp.stylesXml),
    numbering: parseNumbering(inp.numberingXml),
    rels: parseRels(inp.relsXml),
    images: inp.images,
    paper,
    counters: {},
    fnOrder: [],
    enOrder: [],
    size: 0,
    truncated: false,
    textOnly: false,
    depth: 0,
    pending: [],
    skippedImages: 0,
    fields: [],
  };
  const root = parseXml(inp.documentXml);
  const doc = kid(root, 'w:document');
  const body = kid(doc, 'w:body');
  if (!body) throw new Error('w:body bulunamadı');

  let main = renderBlocks(body.c, ctx);

  let header = '';
  if (inp.headerXml) {
    const hdr = kid(parseXml(inp.headerXml), 'w:hdr');
    if (hdr) {
      const saved = ctx.textOnly;
      ctx.textOnly = true;
      header = renderBlocks(hdr.c, ctx);
      ctx.textOnly = saved;
    }
  }
  let footer = '';
  if (inp.footerXml) {
    const ftr = kid(parseXml(inp.footerXml), 'w:ftr');
    if (ftr) {
      const saved = ctx.textOnly;
      ctx.textOnly = true;
      footer = renderBlocks(ftr.c, ctx);
      ctx.textOnly = saved;
    }
  }
  const fn = renderNotes(inp.footnotesXml, 'w:footnotes', 'w:footnote', ctx.fnOrder, ctx, 'decimal');
  const en = renderNotes(inp.endnotesXml, 'w:endnotes', 'w:endnote', ctx.enOrder, ctx, 'letter');

  if (stripTags(header)) main = `<div class="hf">${header}</div>` + main;
  if (fn) main += `<h4 class="nh">Dipnotlar</h4>${fn}`;
  if (en) main += `<h4 class="nh">Son notlar</h4>${en}`;
  if (stripTags(footer)) main += `<div class="hf">${footer}</div>`;

  const notes: string[] = [];
  if (ctx.truncated) notes.push('Belge çok uzun olduğu için yalnızca ilk bölümü gösteriliyor.');
  if (ctx.skippedImages > 0) notes.push(`${ctx.skippedImages} görsel boyut veya biçim nedeniyle gösterilemedi.`);
  const hasContent = stripTags(main).length > 0 || /<img\b/.test(main);
  if (!hasContent) main = '<p class="ph">Belge içeriği boş veya metin içermiyor.</p>';
  return { html: main, notes };
}
// @@PURE-END

// ---------------------------------------------------------------------------

class DocxError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DocxError';
    this.code = code;
  }
}

function zipEntrySize(zip: JSZip, path: string): number {
  const f = zip.file(path) as unknown as { _data?: { uncompressedSize?: number } } | null;
  const n = f && f._data && f._data.uncompressedSize;
  return typeof n === 'number' && isFinite(n) ? n : 0;
}

async function readXmlPart(zip: JSZip, path: string | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  const f = zip.file(path);
  if (!f) return undefined;
  if (zipEntrySize(zip, path) > MAX_XML_BYTES) {
    throw new DocxError('too_large', 'Belgenin içeriği çok büyük; güvenli şekilde açılamıyor.');
  }
  return f.async('string');
}

function relTarget(rels: Record<string, Rel>, typeSuffix: string): string | undefined {
  for (const id of Object.keys(rels)) {
    const r = rels[id];
    if (!r.external && r.type.endsWith(typeSuffix)) return r.target;
  }
  return undefined;
}

async function readDocxBase64(file: FileInfo): Promise<string> {
  if (file.size > MAX_DOCX_BYTES) {
    throw new DocxError('too_large', `Belge çok büyük (${FileService.formatFileSize(file.size)}). En fazla ${FileService.formatFileSize(MAX_DOCX_BYTES)} desteklenir.`);
  }
  if (file.base64) return file.base64;
  try {
    const info = await FileSystem.getInfoAsync(file.uri);
    if (info.exists && typeof info.size === 'number' && info.size > MAX_DOCX_BYTES) {
      throw new DocxError('too_large', `Belge çok büyük (${FileService.formatFileSize(info.size)}). En fazla ${FileService.formatFileSize(MAX_DOCX_BYTES)} desteklenir.`);
    }
    return await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
  } catch (e) {
    if (e instanceof DocxError) throw e;
    throw new DocxError('read_failed', 'Belge dosyası okunamadı. Dosya silinmiş veya erişilemiyor olabilir.');
  }
}

interface LoadedDocx {
  html: string;
  notes: string[];
}

async function loadDocx(file: FileInfo, paperHex: string): Promise<LoadedDocx> {
  const b64 = await readDocxBase64(file);
  const head = base64ToBytes(b64.slice(0, 64));
  if (head.length >= 4 && head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    throw new DocxError('legacy', 'Bu dosya parola ile korunuyor veya eski Word (.doc) biçiminde. Yalnızca parolasız .docx belgeleri görüntülenebilir.');
  }
  if (!(head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b)) {
    throw new DocxError('invalid', 'Bu dosya geçerli bir Word (.docx) belgesi değil.');
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(b64, { base64: true });
  } catch {
    throw new DocxError('corrupt', 'Belge bozuk görünüyor ve açılamadı.');
  }

  const rootRels = parseRels(await readXmlPart(zip, '_rels/.rels'));
  let docPath = 'word/document.xml';
  const officeTarget = relTarget(rootRels, '/officeDocument');
  if (officeTarget) docPath = resolvePartPath('', officeTarget);
  if (!zip.file(docPath)) {
    throw new DocxError('invalid', 'Word belgesi içeriği bulunamadı (word/document.xml yok). Dosya geçerli bir .docx değil.');
  }
  const slash = docPath.lastIndexOf('/');
  const dir = slash < 0 ? '' : docPath.slice(0, slash + 1);
  const docName = slash < 0 ? docPath : docPath.slice(slash + 1);

  const documentXml = (await readXmlPart(zip, docPath)) as string;
  const relsXml = await readXmlPart(zip, `${dir}_rels/${docName}.rels`);
  const rels = parseRels(relsXml);
  const partPath = (suffix: string, fallback: string): string => {
    const t = relTarget(rels, suffix);
    return t ? resolvePartPath(dir, t) : `${dir}${fallback}`;
  };

  const refs = findHeaderFooterRefs(documentXml);
  const headerRel = refs.header ? rels[refs.header] : undefined;
  const footerRel = refs.footer ? rels[refs.footer] : undefined;

  const [stylesXml, numberingXml, footnotesXml, endnotesXml, headerXml, footerXml] = await Promise.all([
    readXmlPart(zip, partPath('/styles', 'styles.xml')),
    readXmlPart(zip, partPath('/numbering', 'numbering.xml')),
    readXmlPart(zip, partPath('/footnotes', 'footnotes.xml')),
    readXmlPart(zip, partPath('/endnotes', 'endnotes.xml')),
    readXmlPart(zip, headerRel && !headerRel.external ? resolvePartPath(dir, headerRel.target) : undefined),
    readXmlPart(zip, footerRel && !footerRel.external ? resolvePartPath(dir, footerRel.target) : undefined),
  ]);

  // Görseller: boyut/adet/toplam sınırlı, yalnız raster, data URI.
  const images: Record<string, string | null> = {};
  let total = 0;
  let count = 0;
  for (const rid of collectImageRIds(documentXml, rels)) {
    const path = resolvePartPath(dir, rels[rid].target);
    const mime = imageMime(path);
    const f = zip.file(path);
    const size = f ? zipEntrySize(zip, path) : 0;
    if (!f || !mime || size > MAX_IMAGE_BYTES || total + size > MAX_IMAGES_TOTAL || count >= MAX_IMAGE_COUNT) {
      images[rid] = null;
      continue;
    }
    try {
      const data = await f.async('base64');
      total += size || Math.floor((data.length * 3) / 4);
      count++;
      images[rid] = `data:${mime};base64,${data}`;
    } catch {
      images[rid] = null;
    }
  }

  let result: { html: string; notes: string[] };
  try {
    result = renderDocxHtml({ documentXml, stylesXml, numberingXml, relsXml, footnotesXml, endnotesXml, headerXml, footerXml, images, paperHex });
  } catch {
    throw new DocxError('corrupt', 'Belge içeriği ayrıştırılamadı. Dosya bozuk olabilir.');
  }
  return result;
}

type DocxState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; html: string; notes: string[] };

export const DocxViewer: React.FC<DocxViewerProps> = ({ file, appTheme = 'emerald' }) => {
  const [state, setState] = useState<DocxState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState<number>(0);
  const loadedOnce = useRef<boolean>(false);
  const currentColors = Colors[appTheme] || Colors.emerald;
  const paperHex = /^#[0-9a-fA-F]{6}$/.test(currentColors.card) ? currentColors.card : appTheme === 'light' ? '#FFFFFF' : '#121824';

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    loadedOnce.current = false;
    // Yükleniyor göstergesi çizilsin diye ağır ayrıştırma bir sonraki turda başlar.
    const timer = setTimeout(() => {
      loadDocx(file, paperHex)
        .then((res) => {
          if (!cancelled) setState({ status: 'ready', html: res.html, notes: res.notes });
        })
        .catch((err) => {
          if (cancelled) return;
          if (__DEV__) console.warn('DOCX ayrıştırma hatası:', err);
          const message = err instanceof DocxError ? err.message : 'Belge açılamadı. Dosya bozuk veya desteklenmeyen bir biçimde olabilir.';
          setState({ status: 'error', message });
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // paperHex tema ile değişir; renk kontrastı yeniden hesaplansın diye bağımlılıkta.
  }, [file.uri, file.base64, file.size, reloadKey, paperHex]);

  const pageHtml = useMemo(() => {
    if (state.status !== 'ready') return '';
    const c = currentColors;
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
html, body { margin: 0; padding: 0; }
body { background: ${c.background}; color: ${c.text}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 14px; line-height: 1.6; font-size: 16px; -webkit-text-size-adjust: 100%; }
.page { background: ${c.card}; border: 1px solid ${c.border}; padding: 20px; border-radius: 12px; overflow-wrap: anywhere; }
h1, h2, h3, h4, h5, h6 { color: ${c.text}; line-height: 1.3; margin: 1.1em 0 0.5em; }
h1 { font-size: 1.6em; color: ${c.primary}; }
h2 { font-size: 1.35em; }
h3 { font-size: 1.15em; }
h4, h5, h6 { font-size: 1em; }
.page > :first-child { margin-top: 0; }
p { margin: 0 0 0.8em; white-space: pre-wrap; }
p.e { margin: 0; line-height: 1; height: 0.8em; }
ul, ol { margin: 0 0 0.8em; padding-left: 1.6em; }
li > ul, li > ol { margin: 0; }
a { color: ${c.primary}; }
img { max-width: 100%; height: auto; }
mark { background: #FFE066; color: #111; }
hr.pb { border: 0; border-top: 1px dashed ${c.border}; margin: 1.2em 0; }
.tw { overflow-x: auto; margin: 0 0 0.9em; }
table { border-collapse: collapse; min-width: 100%; }
table.b td, table.b th { border: 1px solid ${c.textMuted}; }
td, th { padding: 6px 8px; vertical-align: top; text-align: left; }
th { background: ${c.surfaceLight}; }
td p:last-child, th p:last-child { margin-bottom: 0; }
.hf { color: ${c.textSecondary}; font-size: 0.85em; border-bottom: 1px solid ${c.border}; margin-bottom: 1em; padding-bottom: 0.4em; }
.hf:last-child { border-bottom: 0; border-top: 1px solid ${c.border}; margin: 1em 0 0; padding: 0.4em 0 0; }
.tx { border: 1px solid ${c.border}; border-radius: 6px; padding: 8px; margin: 0 0 0.8em; }
.ph { color: ${c.textSecondary}; font-style: italic; }
sup.fn { font-size: 0.75em; }
.nh { color: ${c.textSecondary}; font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.04em; }
ol.notes { font-size: 0.9em; color: ${c.textSecondary}; }
</style>
</head>
<body><div class="page">${state.html}</div></body>
</html>`;
  }, [state, currentColors]);

  const handleShouldStart = useCallback((req: ShouldStartLoadRequest): boolean => {
    const url = req.url || '';
    if (/^(https?:|mailto:|tel:)/i.test(url)) {
      Linking.openURL(url).catch(() => {
        Alert.alert('Bağlantı açılamadı', 'Bu bağlantıyı açabilecek bir uygulama bulunamadı.');
      });
      return false;
    }
    if (url === '' || url.startsWith('about:') || url.startsWith('data:')) {
      loadedOnce.current = true;
      return true;
    }
    if (!loadedOnce.current) {
      // Platforma özgü ilk belge yüklemesi (kendi HTML'imiz).
      loadedOnce.current = true;
      return true;
    }
    return false;
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: currentColors.background }]}>
      {state.status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={currentColors.primary} />
          <Text style={[styles.loadingText, { color: currentColors.textSecondary }]}>Word belgesi ayrıştırılıyor...</Text>
        </View>
      ) : state.status === 'error' ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={44} color={currentColors.warning} />
          <Text style={[styles.errorTitle, { color: currentColors.text }]}>Belge görüntülenemedi</Text>
          <Text style={[styles.errorText, { color: currentColors.textSecondary }]} accessibilityRole="alert">
            {state.message}
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { borderColor: currentColors.border }]}
            onPress={() => setReloadKey((k) => k + 1)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Yeniden dene"
          >
            <Ionicons name="refresh" size={16} color={currentColors.primary} />
            <Text style={[styles.retryText, { color: currentColors.primary }]}>Yeniden dene</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {state.notes.length > 0 ? (
            <View style={[styles.noteBar, { backgroundColor: currentColors.surface, borderBottomColor: currentColors.border }]}>
              <Ionicons name="information-circle-outline" size={16} color={currentColors.warning} />
              <Text style={[styles.noteText, { color: currentColors.textSecondary }]} numberOfLines={3}>
                {state.notes.join(' ')}
              </Text>
            </View>
          ) : null}
          <WebView
            originWhitelist={['*']}
            source={{ html: pageHtml }}
            style={styles.webview}
            javaScriptEnabled={false}
            domStorageEnabled={false}
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            allowsLinkPreview={false}
            mixedContentMode="never"
            cacheEnabled={false}
            geolocationEnabled={false}
            setSupportMultipleWindows={false}
            onShouldStartLoadWithRequest={handleShouldStart}
            accessibilityLabel={`Word belgesi: ${file.name}`}
          />
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  errorTitle: {
    marginTop: 14,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorText: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
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
  noteBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
