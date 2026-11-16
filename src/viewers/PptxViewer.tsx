import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  useWindowDimensions,
  Image,
  FlatList,
  Modal,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import JSZip from 'jszip';
import Svg, { Ellipse, Line, Rect } from 'react-native-svg';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { limitSlideOffset, pinchOffset, shouldApplyPinchUpdate } from './slideGestureMath';
import * as FileSystem from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import { FileInfo, AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import { t } from '../i18n';

interface PptxViewerProps {
  file: FileInfo;
  appTheme?: AppThemeMode;
}

// @@PURE-START
// ---------------------------------------------------------------------------
// Saf mantık (React Native'e bağımlı değil). Node testi bu bloğu dosyadan çıkarıp çalıştırır.
// ---------------------------------------------------------------------------

export interface XNode {
  n: string;
  a: Record<string, string>;
  c: XNode[];
  t: string;
}

const NAMED_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    }
    const v = NAMED_ENTITIES[body];
    return v !== undefined ? v : whole;
  });
}

const TAG_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR_RE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Küçük, toleranslı XML ayrıştırıcı (öznitelik sırasından bağımsız, entity çözer). */
export function parseXml(src: string): XNode {
  const root: XNode = { n: '#root', a: {}, c: [], t: '' };
  const stack: XNode[] = [root];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(src)) !== null) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.t += m[1];
    } else if (m[2] !== undefined) {
      // kapanış: eşleşen açılışa kadar çık (bozuk XML'e tolerans)
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].n === m[2]) {
          stack.length = i;
          break;
        }
      }
    } else if (m[3] !== undefined) {
      const node: XNode = { n: m[3], a: {}, c: [], t: '' };
      if (m[4]) {
        ATTR_RE.lastIndex = 0;
        let am: RegExpExecArray | null;
        while ((am = ATTR_RE.exec(m[4])) !== null) node.a[am[1]] = decodeEntities(am[2] !== undefined ? am[2] : am[3]);
      }
      top.c.push(node);
      if (m[5] !== '/') stack.push(node);
    } else if (m[6] !== undefined) {
      top.t += decodeEntities(m[6]);
    }
  }
  return root;
}

const kids = (n: XNode | undefined, name: string): XNode[] => (n ? n.c.filter((x) => x.n === name) : []);
const first = (n: XNode | undefined, name: string): XNode | undefined => (n ? n.c.find((x) => x.n === name) : undefined);
function descend(n: XNode | undefined, ...path: string[]): XNode | undefined {
  let cur = n;
  for (const p of path) {
    cur = first(cur, p);
    if (!cur) return undefined;
  }
  return cur;
}

export function resolvePath(baseDir: string, target: string): string {
  const raw = target.charAt(0) === '/' ? target.slice(1) : baseDir + target;
  const out: string[] = [];
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

export interface Rel {
  id: string;
  type: string;
  target: string; // çözülmüş zip yolu
  external: boolean;
}

export function parseRels(xml: string, baseDir: string): Record<string, Rel> {
  const map: Record<string, Rel> = {};
  const root = parseXml(xml);
  const rels = first(root, 'Relationships');
  for (const r of kids(rels, 'Relationship')) {
    const id = r.a.Id;
    const target = r.a.Target;
    if (!id || !target) continue;
    const external = (r.a.TargetMode || '').toLowerCase() === 'external';
    map[id] = { id, type: r.a.Type || '', target: external ? target : resolvePath(baseDir, target), external };
  }
  return map;
}

/** presentation.xml sldIdLst + rels sırasıyla slayt yolları; yoksa sayısal ada göre. */
export function orderSlidePaths(presXml: string | undefined, presRelsXml: string | undefined, allPaths: string[]): string[] {
  const exists = new Set(allPaths);
  const out: string[] = [];
  if (presXml && presRelsXml) {
    const rels = parseRels(presRelsXml, 'ppt/');
    const pres = first(parseXml(presXml), 'p:presentation');
    const ids = kids(descend(pres, 'p:sldIdLst'), 'p:sldId');
    for (const s of ids) {
      const rel = rels[s.a['r:id']];
      if (rel && !rel.external && exists.has(rel.target) && out.indexOf(rel.target) < 0) out.push(rel.target);
    }
  }
  if (out.length === 0) {
    const nums = allPaths
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((x, y) => parseInt(x.replace(/\D/g, ''), 10) - parseInt(y.replace(/\D/g, ''), 10));
    return nums;
  }
  return out;
}

export function mimeForPath(path: string): string | null {
  const ext = (path.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    default:
      return null; // svg/emf/wmf/tif/video/audio: RN Image çizemez veya medya
  }
}

function lum(hex: string): number {
  const v = parseInt(hex.replace('#', ''), 16);
  const ch = (x: number) => {
    const c = x / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch((v >> 16) & 255) + 0.7152 * ch((v >> 8) & 255) + 0.0722 * ch(v & 255);
}
export function contrastRatio(a: string, b: string): number {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  size?: number;
}
export interface Para {
  runs: Run[];
  align: 'left' | 'center' | 'right' | 'justify';
  level: number;
  bullet?: string;
  size: number; // pt
  text: string; // düz metin (madde işaretsiz)
}
export interface Box {
  l: number;
  t: number;
  w: number;
  h: number;
  rot?: number;
  flipH?: boolean;
}
export interface SlideEl {
  id: string;
  kind: 'text' | 'image' | 'table' | 'shape' | 'unsupported';
  shape?: { geometry: string; fill?: string; stroke?: string; strokeWidth?: number };
  textBackground?: string;
  box?: Box; // yoksa akış yerleşimi
  paras?: Para[];
  anchor?: 't' | 'ctr' | 'b';
  isTitle?: boolean;
  fontScale?: number;
  imagePath?: string;
  crop?: { l: number; t: number; r: number; b: number };
  rows?: string[][];
  label?: string;
}
export interface SlideData {
  key: string;
  number: number;
  hidden: boolean;
  elements: SlideEl[];
  text: string;
  title: string;
  notes: string;
  bg?: string;
}

interface Tf {
  sx: number;
  ox: number;
  sy: number;
  oy: number;
}
interface EmuBox {
  x: number;
  y: number;
  cx: number;
  cy: number;
}
export interface PhMap {
  [key: string]: EmuBox;
}

export interface SlideCtx {
  slideW: number;
  slideH: number;
  rels: Record<string, Rel>;
  layoutPh: PhMap;
  masterPh: PhMap;
}

function num(v: string | undefined, d = 0): number {
  const n = v === undefined ? NaN : parseInt(v, 10);
  return isFinite(n) ? n : d;
}

function readXfrm(x: XNode | undefined) {
  if (!x) return null;
  const off = first(x, 'a:off');
  const ext = first(x, 'a:ext');
  if (!off || !ext) return null;
  const chOff = first(x, 'a:chOff');
  const chExt = first(x, 'a:chExt');
  return {
    x: num(off.a.x),
    y: num(off.a.y),
    cx: num(ext.a.cx),
    cy: num(ext.a.cy),
    chX: chOff ? num(chOff.a.x) : undefined,
    chY: chOff ? num(chOff.a.y) : undefined,
    chCx: chExt ? num(chExt.a.cx) : undefined,
    chCy: chExt ? num(chExt.a.cy) : undefined,
    rot: num(x.a.rot) / 60000,
    flipH: x.a.flipH === '1' || x.a.flipH === 'true',
  };
}

function toBox(e: EmuBox, T: Tf, ctx: SlideCtx, rot?: number, flipH?: boolean): Box {
  const x = T.sx * e.x + T.ox;
  const y = T.sy * e.y + T.oy;
  const w = e.cx * T.sx;
  const h = e.cy * T.sy;
  return {
    l: (x / ctx.slideW) * 100,
    t: (y / ctx.slideH) * 100,
    w: (w / ctx.slideW) * 100,
    h: (h / ctx.slideH) * 100,
    rot: rot ? rot : undefined,
    flipH: flipH ? true : undefined,
  };
}

const IDENT: Tf = { sx: 1, ox: 0, sy: 1, oy: 0 };

function runColor(rPr: XNode | undefined): string | undefined {
  const c = descend(rPr, 'a:solidFill', 'a:srgbClr');
  const v = c && c.a.val;
  return v && /^[0-9a-fA-F]{6}$/.test(v) ? '#' + v.toUpperCase() : undefined;
}

/** DrawingML'deki doğrudan RGB dolguları; tema renkleri ayrıca çözülmelidir. */
function directColor(node: XNode | undefined): string | undefined {
  const color = descend(node, 'a:solidFill', 'a:srgbClr');
  const value = color && color.a.val;
  return value && /^[0-9a-fA-F]{6}$/.test(value) ? '#' + value.toUpperCase() : undefined;
}

function parseShape(spPr: XNode | undefined): SlideEl['shape'] | undefined {
  if (!spPr) return undefined;
  const geometry = first(spPr, 'a:prstGeom')?.a.prst || 'rect';
  if (!['rect', 'roundRect', 'ellipse', 'line'].includes(geometry)) return undefined;
  const line = first(spPr, 'a:ln');
  const fill = directColor(spPr);
  const stroke = directColor(line);
  if (!fill && !stroke) return undefined;
  return { geometry, fill, stroke, strokeWidth: line?.a.w ? num(line.a.w) / 12700 : 1 };
}

function defaultSize(phType: string | undefined): number {
  if (phType === 'title' || phType === 'ctrTitle') return 40;
  if (phType === 'subTitle') return 24;
  if (phType === 'body' || phType === 'obj') return 20;
  return 18;
}

export function parseParas(txBody: XNode | undefined, phType: string | undefined, defaultBullet: boolean): Para[] {
  const out: Para[] = [];
  if (!txBody) return out;
  const dSize = defaultSize(phType);
  let autoNum = 0;
  for (const p of kids(txBody, 'a:p')) {
    const pPr = first(p, 'a:pPr');
    const lvl = Math.max(0, Math.min(8, num(pPr && pPr.a.lvl)));
    const algnRaw = pPr && pPr.a.algn;
    const align = algnRaw === 'ctr' ? 'center' : algnRaw === 'r' ? 'right' : algnRaw === 'just' ? 'justify' : 'left';
    const runs: Run[] = [];
    let firstSize: number | undefined;
    for (const ch of p.c) {
      if (ch.n === 'a:r' || ch.n === 'a:fld') {
        const rPr = first(ch, 'a:rPr');
        const t = first(ch, 'a:t');
        const text = t ? t.t : '';
        if (text === '') continue;
        const sz = rPr && rPr.a.sz ? num(rPr.a.sz) / 100 : undefined;
        if (firstSize === undefined && sz) firstSize = sz;
        runs.push({
          text,
          bold: rPr && rPr.a.b === '1' ? true : undefined,
          italic: rPr && rPr.a.i === '1' ? true : undefined,
          underline: rPr && rPr.a.u && rPr.a.u !== 'none' ? true : undefined,
          color: runColor(rPr),
          size: sz,
        });
      } else if (ch.n === 'a:br') {
        runs.push({ text: '\n' });
      }
    }
    const endPr = first(p, 'a:endParaRPr');
    const size = firstSize || (endPr && endPr.a.sz ? num(endPr.a.sz) / 100 : 0) || dSize;
    const text = runs.map((r) => r.text).join('');
    let bullet: string | undefined;
    if (first(pPr, 'a:buNone')) {
      bullet = undefined;
      autoNum = 0;
    } else if (first(pPr, 'a:buChar')) {
      bullet = (first(pPr, 'a:buChar') as XNode).a.char || '•';
      autoNum = 0;
    } else if (first(pPr, 'a:buAutoNum')) {
      autoNum++;
      bullet = autoNum + '.';
    } else {
      autoNum = 0;
      if (defaultBullet && text.trim() !== '') bullet = '•';
    }
    out.push({ runs, align, level: lvl, bullet, size, text });
  }
  while (out.length > 0 && out[out.length - 1].text.trim() === '') out.pop();
  return out;
}

export function parasToText(paras: Para[]): string {
  return paras.map((p) => (p.bullet ? '  '.repeat(p.level) + p.bullet + ' ' : '') + p.text).join('\n');
}

function phOf(sp: XNode): { type?: string; idx?: string } | null {
  const ph = descend(sp, 'p:nvSpPr', 'p:nvPr', 'p:ph');
  if (!ph) return null;
  return { type: ph.a.type, idx: ph.a.idx };
}

/** Düzen/ana slayttaki yer tutucu konumları. */
export function parsePlaceholders(xml: string): PhMap {
  const map: PhMap = {};
  const sld = parseXml(xml).c[0];
  const tree = descend(sld, 'p:cSld', 'p:spTree');
  for (const sp of kids(tree, 'p:sp')) {
    const ph = phOf(sp);
    const xf = readXfrm(descend(sp, 'p:spPr', 'a:xfrm'));
    if (!ph || !xf) continue;
    const box = { x: xf.x, y: xf.y, cx: xf.cx, cy: xf.cy };
    if (ph.idx !== undefined) map['idx:' + ph.idx] = box;
    if (ph.type) map['type:' + ph.type] = box;
    else if (map['type:body'] === undefined) map['type:body'] = box;
  }
  return map;
}

function lookupPh(ph: { type?: string; idx?: string }, ctx: SlideCtx): EmuBox | undefined {
  const t = ph.type;
  const norm = t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' || !t ? 'body' : t;
  return (
    (ph.idx !== undefined ? ctx.layoutPh['idx:' + ph.idx] : undefined) ||
    (t ? ctx.layoutPh['type:' + t] : undefined) ||
    ctx.layoutPh['type:' + norm] ||
    ctx.masterPh['type:' + norm]
  );
}

function tableRows(tbl: XNode): string[][] {
  const rows: string[][] = [];
  for (const tr of kids(tbl, 'a:tr').slice(0, 100)) {
    const row: string[] = [];
    for (const tc of kids(tr, 'a:tc').slice(0, 30)) {
      row.push(parasToText(parseParas(first(tc, 'a:txBody'), undefined, false)));
    }
    rows.push(row);
  }
  return rows;
}

function walkTree(children: XNode[], T: Tf, ctx: SlideCtx, out: SlideEl[], counter: { n: number }, depth: number): void {
  if (depth > 12) return;
  for (const ch of children) {
    switch (ch.n) {
      case 'p:sp': {
        const txBody = first(ch, 'p:txBody');
        const spPr = first(ch, 'p:spPr');
        const shape = parseShape(spPr);
        const shapeXf = readXfrm(first(spPr, 'a:xfrm'));
        if (shape && shapeXf) {
          counter.n++;
          out.push({ id: 'e' + counter.n, kind: 'shape', box: toBox(shapeXf, T, ctx, shapeXf.rot, shapeXf.flipH), shape });
        }
        if (!txBody) break;
        const ph = phOf(ch);
        const phType = ph ? ph.type : undefined;
        const isTitle = phType === 'title' || phType === 'ctrTitle';
        const bodyPr = first(txBody, 'a:bodyPr');
        const defaultBullet = !!ph && !isTitle && phType !== 'subTitle' && (phType === 'body' || phType === 'obj' || !phType);
        const paras = parseParas(txBody, phType, defaultBullet);
        if (paras.length === 0) break;
        const xf = readXfrm(descend(ch, 'p:spPr', 'a:xfrm'));
        let box: Box | undefined;
        if (xf) box = toBox(xf, T, ctx, xf.rot, xf.flipH);
        else if (ph) {
          const e = lookupPh(ph, ctx);
          if (e) box = toBox(e, T, ctx);
        }
        const fs = descend(bodyPr, 'a:normAutofit');
        const fontScale = fs && fs.a.fontScale ? Math.max(0.2, Math.min(1, num(fs.a.fontScale) / 100000)) : undefined;
        const anchorRaw = bodyPr && bodyPr.a.anchor;
        const anchor: 't' | 'ctr' | 'b' = anchorRaw === 'ctr' ? 'ctr' : anchorRaw === 'b' ? 'b' : anchorRaw === 't' ? 't' : isTitle ? 'ctr' : 't';
        counter.n++;
        out.push({ id: 'e' + counter.n, kind: 'text', box, paras, anchor, isTitle, fontScale, textBackground: shape?.fill });
        break;
      }
      case 'p:cxnSp': {
        const spPr = first(ch, 'p:spPr');
        const xf = readXfrm(first(spPr, 'a:xfrm'));
        const shape = parseShape(spPr);
        if (xf && shape) {
          counter.n++;
          out.push({ id: 'e' + counter.n, kind: 'shape', box: toBox(xf, T, ctx, xf.rot, xf.flipH), shape: { ...shape, geometry: 'line' } });
        }
        break;
      }
      case 'p:pic': {
        const blipFill = first(ch, 'p:blipFill');
        const blip = first(blipFill, 'a:blip');
        const rid = blip && blip.a['r:embed'];
        const rel = rid ? ctx.rels[rid] : undefined;
        if (!rel || rel.external) break;
        const xf = readXfrm(descend(ch, 'p:spPr', 'a:xfrm'));
        const box = xf ? toBox(xf, T, ctx, xf.rot, xf.flipH) : undefined;
        const sr = first(blipFill, 'a:srcRect');
        const crop = sr
          ? { l: num(sr.a.l) / 100000, t: num(sr.a.t) / 100000, r: num(sr.a.r) / 100000, b: num(sr.a.b) / 100000 }
          : undefined;
        counter.n++;
        if (mimeForPath(rel.target)) out.push({ id: 'e' + counter.n, kind: 'image', box, imagePath: rel.target, crop });
        else out.push({ id: 'e' + counter.n, kind: 'unsupported', box, label: t('pptx.imageUnsupported') });
        break;
      }
      case 'p:graphicFrame': {
        const xf = readXfrm(first(ch, 'p:xfrm'));
        const box = xf ? toBox(xf, T, ctx) : undefined;
        const gd = descend(ch, 'a:graphic', 'a:graphicData');
        const tbl = first(gd, 'a:tbl');
        counter.n++;
        if (tbl) {
          out.push({ id: 'e' + counter.n, kind: 'table', box, rows: tableRows(tbl) });
        } else {
          const uri = (gd && gd.a.uri) || '';
          out.push({
            id: 'e' + counter.n,
            kind: 'unsupported',
            box,
            label: uri.indexOf('chart') >= 0 ? t('pptx.chartNA') : uri.indexOf('diagram') >= 0 ? t('pptx.diagramNA') : t('pptx.objectNA'),
          });
        }
        break;
      }
      case 'p:grpSp': {
        const xf = readXfrm(descend(ch, 'p:grpSpPr', 'a:xfrm'));
        let T2 = T;
        if (xf) {
          const cw = xf.chCx && xf.chCx > 0 ? xf.chCx : xf.cx || 1;
          const chh = xf.chCy && xf.chCy > 0 ? xf.chCy : xf.cy || 1;
          const gsx = xf.cx / cw;
          const gsy = xf.cy / chh;
          const gox = xf.x - gsx * (xf.chX !== undefined ? xf.chX : xf.x);
          const goy = xf.y - gsy * (xf.chY !== undefined ? xf.chY : xf.y);
          // toplam = T(g(x)) = T.sx*(gsx*x+gox)+T.ox
          T2 = { sx: T.sx * gsx, ox: T.sx * gox + T.ox, sy: T.sy * gsy, oy: T.sy * goy + T.oy };
        }
        walkTree(ch.c, T2, ctx, out, counter, depth + 1);
        break;
      }
      case 'mc:AlternateContent': {
        const choice = first(ch, 'mc:Choice') || first(ch, 'mc:Fallback');
        if (choice) walkTree(choice.c, T, ctx, out, counter, depth + 1);
        break;
      }
      default:
        break;
    }
  }
}

export function parseSlide(xml: string, key: string, number: number, ctx: SlideCtx): SlideData {
  const sld = parseXml(xml).c[0];
  const cSld = first(sld, 'p:cSld');
  const tree = first(cSld, 'p:spTree');
  const elements: SlideEl[] = [];
  walkTree(tree ? tree.c : [], IDENT, ctx, elements, { n: 0 }, 0);
  const bgClr = descend(cSld, 'p:bg', 'p:bgPr', 'a:solidFill', 'a:srgbClr');
  const bg = bgClr && /^[0-9a-fA-F]{6}$/.test(bgClr.a.val || '') ? '#' + bgClr.a.val.toUpperCase() : undefined;
  const chunks: string[] = [];
  let title = '';
  for (const el of elements) {
    if (el.kind === 'text' && el.paras) {
      const t = parasToText(el.paras);
      chunks.push(t);
      if (!title && el.isTitle) title = el.paras.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim();
    } else if (el.kind === 'table' && el.rows) {
      chunks.push(el.rows.map((r) => r.map((c) => c.replace(/\n/g, ' ')).join(' | ')).join('\n'));
    }
  }
  if (!title && chunks.length > 0) title = chunks[0].split('\n')[0].trim();
  if (title.length > 80) title = title.slice(0, 77) + '...';
  return {
    key,
    number,
    hidden: !!sld && sld.a.show === '0',
    elements,
    text: chunks.join('\n\n'),
    title,
    notes: '',
    bg,
  };
}

/** notesSlide.xml -> konuşmacı notu metni (yalnız gövde yer tutucusu). */
export function parseNotes(xml: string): string {
  const sld = parseXml(xml).c[0];
  const tree = descend(sld, 'p:cSld', 'p:spTree');
  const parts: string[] = [];
  for (const sp of kids(tree, 'p:sp')) {
    const ph = phOf(sp);
    if (!ph || ph.type !== 'body') continue;
    const paras = parseParas(first(sp, 'p:txBody'), undefined, false);
    const t = paras.map((p) => p.text).join('\n').trim();
    if (t) parts.push(t);
  }
  return parts.join('\n');
}
// @@PURE-END

const MAX_SLIDES = 500;
const MAX_XML_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const IMAGE_CACHE_MAX = 10;

type ThemeColors = (typeof Colors)[keyof typeof Colors];
type ZipEntry = JSZip.JSZipObject & { _data?: { uncompressedSize?: number } };

function readableOn(bg: string): string {
  return contrastRatio(bg, '#111827') >= contrastRatio(bg, '#FFFFFF') ? '#111827' : '#FFFFFF';
}

const delay = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

function entrySize(f: JSZip.JSZipObject | null): number {
  const s = f ? (f as ZipEntry)._data?.uncompressedSize : undefined;
  return typeof s === 'number' ? s : 0;
}

// ---------------------------------------------------------------- görsel parçası

interface SlideImageProps {
  path: string;
  load: (path: string) => Promise<string | null>;
  crop?: { l: number; t: number; r: number; b: number };
  flipH?: boolean;
  placeholderColor: string;
  iconColor: string;
}

const SlideImage = React.memo(function SlideImage({ path, load, crop, flipH, placeholderColor, iconColor }: SlideImageProps) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setUri(null);
    setFailed(false);
    load(path)
      .then((u) => {
        if (!alive) return;
        if (u) setUri(u);
        else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [path, load]);

  if (!uri) {
    return (
      <View style={[styles.imgPlaceholder, { backgroundColor: placeholderColor }]}>
        {failed ? <Ionicons name="image-outline" size={20} color={iconColor} /> : <ActivityIndicator size="small" color={iconColor} />}
      </View>
    );
  }
  const cl = crop ? crop.l : 0;
  const ct = crop ? crop.t : 0;
  const fw = Math.max(0.05, 1 - cl - (crop ? crop.r : 0));
  const fh = Math.max(0.05, 1 - ct - (crop ? crop.b : 0));
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <Image
        source={{ uri }}
        resizeMode="stretch"
        accessible={false}
        style={{
          position: 'absolute',
          left: `${(-cl / fw) * 100}%`,
          top: `${(-ct / fh) * 100}%`,
          width: `${100 / fw}%`,
          height: `${100 / fh}%`,
          transform: flipH ? [{ scaleX: -1 }] : undefined,
        }}
      />
    </View>
  );
});

// ---------------------------------------------------------------- slayt sayfası

interface SlidePageProps {
  slide: SlideData;
  pageW: number;
  canvasW: number;
  canvasH: number;
  slideWpt: number;
  load: (path: string) => Promise<string | null>;
  colors: ThemeColors;
}

const SlidePage = React.memo(function SlidePage({ slide, pageW, canvasW, canvasH, slideWpt, load, colors }: SlidePageProps) {
  const bg = slide.bg || '#FFFFFF';
  const textDefault = readableOn(bg);
  const ptScale = canvasW / slideWpt;

  const renderText = (el: SlideEl, flow: boolean) => {
    const fsc = el.fontScale || 1;
    const textBg = el.textBackground || bg;
    const content = (el.paras || []).map((p, i) => {
      const fontSize = Math.max(5, p.size * fsc * ptScale);
      return (
        <Text
          key={i}
          style={{
            fontSize,
            lineHeight: fontSize * 1.2,
            textAlign: p.align,
            color: readableOn(textBg),
            marginLeft: p.level * fontSize * 1.2,
            marginBottom: fontSize * 0.25,
            fontWeight: el.isTitle ? '700' : '400',
          }}
        >
          {p.bullet ? p.bullet + ' ' : ''}
          {p.runs.map((r, j) => {
            const col = r.color && contrastRatio(r.color, textBg) >= 2.5 ? r.color : undefined;
            return (
              <Text
                key={j}
                style={{
                  fontWeight: r.bold ? '700' : undefined,
                  fontStyle: r.italic ? 'italic' : undefined,
                  textDecorationLine: r.underline ? 'underline' : undefined,
                  color: col,
                  fontSize: r.size ? Math.max(5, r.size * fsc * ptScale) : undefined,
                }}
              >
                {r.text}
              </Text>
            );
          })}
        </Text>
      );
    });
    if (flow) return <View key={el.id}>{content}</View>;
    const b = el.box as Box;
    return (
      <View
        key={el.id}
        style={[
          styles.abs,
          {
            left: `${b.l}%`,
            top: `${b.t}%`,
            width: `${b.w}%`,
            height: `${b.h}%`,
            justifyContent: el.anchor === 'ctr' ? 'center' : el.anchor === 'b' ? 'flex-end' : 'flex-start',
            padding: 2,
            transform: b.rot ? [{ rotate: `${b.rot}deg` }] : undefined,
          },
        ]}
      >
        {content}
      </View>
    );
  };

  const renderOther = (el: SlideEl) => {
    const b = el.box;
    const posStyle = b
      ? { left: `${b.l}%`, top: `${b.t}%`, width: `${b.w}%`, height: `${b.h}%` }
      : { left: '5%', top: '30%', width: '90%', height: '40%' };
    const boxStyle = [styles.abs, posStyle as object, b && b.rot ? { transform: [{ rotate: `${b.rot}deg` }] } : null];
    if (el.kind === 'shape' && el.shape && b) {
      const w = Math.max(1, b.w * canvasW / 100), h = Math.max(1, b.h * canvasH / 100);
      const fill = el.shape.fill || 'none', stroke = el.shape.stroke || 'none';
      const sw = Math.max(0.5, (el.shape.strokeWidth || 1) * ptScale);
      return (
        <View key={el.id} style={[boxStyle, el.shape.geometry === 'line' && { minWidth: 1, minHeight: 1 }]} pointerEvents="none">
          <Svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
            {el.shape.geometry === 'ellipse' ? <Ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, (w - sw) / 2)} ry={Math.max(0, (h - sw) / 2)} fill={fill} stroke={stroke} strokeWidth={sw} />
              : el.shape.geometry === 'line' ? <Line x1={b.flipH ? w : 0} y1={0} x2={b.flipH ? 0 : w} y2={h} stroke={stroke} strokeWidth={sw} />
              : <Rect x={sw / 2} y={sw / 2} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} rx={el.shape.geometry === 'roundRect' ? Math.min(w, h) * 0.15 : 0} fill={fill} stroke={stroke} strokeWidth={sw} />}
          </Svg>
        </View>
      );
    }
    if (el.kind === 'image' && el.imagePath) {
      return (
        <View key={el.id} style={boxStyle}>
          <SlideImage path={el.imagePath} load={load} crop={el.crop} flipH={b?.flipH} placeholderColor="#E5E7EB" iconColor="#6B7280" />
        </View>
      );
    }
    if (el.kind === 'table' && el.rows) {
      const fs = Math.max(5, 14 * ptScale);
      return (
        <View key={el.id} style={[boxStyle, { borderWidth: StyleSheet.hairlineWidth, borderColor: '#9CA3AF' }]}>
          {el.rows.map((row, ri) => (
            <View key={ri} style={{ flex: 1, flexDirection: 'row' }}>
              {row.map((cell, ci) => (
                <View
                  key={ci}
                  style={{ flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: '#9CA3AF', padding: 2, overflow: 'hidden', justifyContent: 'center' }}
                >
                  <Text style={{ fontSize: fs, color: textDefault, fontWeight: ri === 0 ? '700' : '400' }} numberOfLines={4}>
                    {cell}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    }
    return (
      <View key={el.id} style={[boxStyle, styles.unsupportedBox, { borderColor: '#9CA3AF' }]}>
        <Text style={{ fontSize: Math.max(8, 11 * ptScale * 1.5), color: '#6B7280', textAlign: 'center' }}>{el.label || 'Desteklenmiyor'}</Text>
      </View>
    );
  };

  const flowEls = slide.elements.filter((e) => e.kind === 'text' && !e.box);
  const flowRendered = flowEls.length > 0;

  return (
    <View pointerEvents="none" style={[styles.slidePageWrapper, { width: pageW }]}>
      <View
        style={[styles.slideCanvas, { width: canvasW, height: canvasH, backgroundColor: bg, borderColor: colors.cardBorder }]}
        accessible
        accessibilityLabel={t('pptx.slideA11y', { n: slide.number, title: slide.title || t('pptx.untitled') })}
      >
        {slide.elements.map((el) => {
          if (el.kind === 'text') return el.box ? renderText(el, false) : null;
          return renderOther(el);
        })}
        {flowRendered && (
          <View style={[StyleSheet.absoluteFill, { padding: canvasW * 0.05, justifyContent: 'center' }]} pointerEvents="none">
            {flowEls.map((el) => renderText(el, true))}
          </View>
        )}
        {slide.elements.length === 0 && (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: '#6B7280', fontSize: 13 }}>{t('pptx.noElements')}</Text>
          </View>
        )}
      </View>
    </View>
  );
});

// ---------------------------------------------------------------- ana bileşen

interface Loaded {
  slides: SlideData[];
  slideWpt: number;
  aspect: number;
}

export const PptxViewer: React.FC<PptxViewerProps> = ({ file, appTheme = 'emerald' }) => {
  const colors = Colors[appTheme] || Colors.emerald;
  const { width: winW } = useWindowDimensions();

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [data, setData] = useState<Loaded>({ slides: [], slideWpt: 960, aspect: 16 / 9 });
  const [index, setIndex] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const [gotoOpen, setGotoOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [areaH, setAreaH] = useState(0);
  const [areaW, setAreaW] = useState(0);

  const zipRef = useRef<JSZip | null>(null);
  const imgCache = useRef<Map<string, string>>(new Map());
  const indexRef = useRef(0);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { slides, slideWpt, aspect } = data;

  // ---- yükleme ----
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErrorMsg('');
    setProgress(null);
    setIndex(0);
    indexRef.current = 0;
    zipRef.current = null;
    imgCache.current.clear();

    (async () => {
      await delay(50);
      if (cancelled) return;
      try {
        if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) {
          throw new Error(t('pptx.tooLarge'));
        }
        let b64: string | undefined;
        if (!file.uri.includes('#')) { // yalnız 'zip#girdi' sanal adresleri diskten okunamaz; arşivden çıkarılan kopyalar normal dosyadır
          try {
            b64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
          } catch {
            b64 = undefined;
          }
        }
        if (!b64) b64 = file.base64;
        if (!b64) throw new Error(t('sheet.readFail'));
        if (cancelled) return;

        let zip: JSZip;
        try {
          zip = await JSZip.loadAsync(b64, { base64: true });
        } catch {
          throw new Error(t('pptx.openFail'));
        }
        b64 = undefined;
        if (cancelled) return;
        zipRef.current = zip;

        const readXml = async (path: string): Promise<string | undefined> => {
          const f = zip.file(path);
          if (!f) return undefined;
          if (entrySize(f) > MAX_XML_BYTES) return undefined;
          return f.async('string');
        };

        const presXml = await readXml('ppt/presentation.xml');
        if (!presXml) throw new Error(t('pptx.invalid'));
        const presRels = await readXml('ppt/_rels/presentation.xml.rels');

        let slideW = 12192000;
        let slideH = 6858000;
        const sz = descend(first(parseXml(presXml), 'p:presentation'), 'p:sldSz');
        if (sz) {
          slideW = num(sz.a.cx, slideW) || slideW;
          slideH = num(sz.a.cy, slideH) || slideH;
        }

        const allPaths = Object.keys(zip.files);
        const paths = orderSlidePaths(presXml, presRels, allPaths).slice(0, MAX_SLIDES);
        if (paths.length === 0) throw new Error(t('pptx.noSlides'));

        const phCache = new Map<string, PhMap>();
        const getPh = async (path: string | undefined): Promise<PhMap> => {
          if (!path) return {};
          const hit = phCache.get(path);
          if (hit) return hit;
          let m: PhMap = {};
          try {
            const x = await readXml(path);
            if (x) m = parsePlaceholders(x);
          } catch {
            m = {};
          }
          phCache.set(path, m);
          return m;
        };
        const relsCache = new Map<string, Record<string, Rel>>();
        const relsOf = async (partPath: string): Promise<Record<string, Rel>> => {
          const cached = relsCache.get(partPath);
          if (cached) return cached;
          const i = partPath.lastIndexOf('/');
          const dir = partPath.slice(0, i + 1);
          const relPath = dir + '_rels/' + partPath.slice(i + 1) + '.rels';
          try {
            const xml = await readXml(relPath);
            const rels = xml ? parseRels(xml, dir) : {};
            relsCache.set(partPath, rels);
            return rels;
          } catch {
            return {};
          }
        };

        const parsed: SlideData[] = [];
        for (let i = 0; i < paths.length; i++) {
          if (cancelled) return;
          if (i % 4 === 3) {
            setProgress({ done: i, total: paths.length });
            await delay(0);
            if (cancelled) return;
          }
          const path = paths[i];
          try {
            const xml = await readXml(path);
            if (!xml) continue;
            const rels = await relsOf(path);
            let layoutPath: string | undefined;
            let notesPath: string | undefined;
            for (const id of Object.keys(rels)) {
              const r = rels[id];
              if (r.external) continue;
              if (/\/slideLayout$/.test(r.type)) layoutPath = r.target;
              else if (/\/notesSlide$/.test(r.type)) notesPath = r.target;
            }
            let layoutPh: PhMap = {};
            let masterPh: PhMap = {};
            if (layoutPath) {
              layoutPh = await getPh(layoutPath);
              const lrels = await relsOf(layoutPath);
              for (const id of Object.keys(lrels)) {
                if (/\/slideMaster$/.test(lrels[id].type) && !lrels[id].external) {
                  masterPh = await getPh(lrels[id].target);
                  break;
                }
              }
            }
            const slide = parseSlide(xml, path, parsed.length + 1, { slideW, slideH, rels, layoutPh, masterPh });
            if (notesPath) {
              try {
                const nx = await readXml(notesPath);
                if (nx) slide.notes = parseNotes(nx);
              } catch {
                /* not okunamadı: yok say */
              }
            }
            parsed.push(slide);
          } catch {
            // tek slayt bozuksa diğerleri açılsın
          }
        }
        if (cancelled) return;
        if (parsed.length === 0) throw new Error(t('pptx.slidesReadFail'));
        setData({ slides: parsed, slideWpt: slideW / 12700, aspect: slideW / slideH });
        setProgress(null);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : t('pptx.openFailShort'));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.uri, file.id, file.virtual]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    []
  );

  // ---- görsel yükleyici (lazy, önbellekli, boyut sınırlı) ----
  const loadImage = useCallback(async (path: string): Promise<string | null> => {
    const cache = imgCache.current;
    const hit = cache.get(path);
    if (hit) {
      cache.delete(path);
      cache.set(path, hit);
      return hit;
    }
    const zip = zipRef.current;
    const mime = mimeForPath(path);
    if (!zip || !mime) return null;
    const f = zip.file(path);
    if (!f) return null;
    const size = entrySize(f);
    if (size > MAX_IMAGE_BYTES) return null;
    const b = await f.async('base64');
    if (b.length > MAX_IMAGE_BYTES * 1.4) return null;
    const uri = `data:${mime};base64,${b}`;
    cache.set(path, uri);
    if (cache.size > IMAGE_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return uri;
  }, []);

  // ---- gezinme ----
  const clamp = useCallback((i: number) => Math.max(0, Math.min(slides.length - 1, i)), [slides.length]);

  const goTo = useCallback((i: number) => {
    if (slides.length === 0) return;
    const next = clamp(i);
    indexRef.current = next;
    setIndex(next);
  }, [clamp, slides.length]);

  const copyText = async () => {
    const s = slides[index];
    if (!s) return;
    try {
      await Clipboard.setStringAsync(s.notes ? `${s.text}\n\n[Notlar]\n${s.notes}` : s.text);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      /* pano kullanılamadı */
    }
  };

  // ---- ölçüler ----
  const pageW = Math.max(1, areaW || Math.round(winW));
  const canvasW = useMemo(() => {
    const byW = pageW - 24;
    if (areaH <= 0) return byW;
    const byH = (areaH - 56) * aspect;
    return Math.max(120, Math.min(byW, byH));
  }, [pageW, areaH, aspect]);
  const canvasH = canvasW / aspect;

  // Dokunma hesapları UI iş parçacığında çalışır; JS yükü hareketi durdurmaz.
  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startFocalX = useSharedValue(0);
  const startFocalY = useSharedValue(0);
  const pinchStartReady = useSharedValue(false);
  const twoFingersDown = useSharedValue(false);
  const initialGestureScale = useSharedValue(1);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const pinching = useSharedValue(false);
  const panBlocked = useSharedValue(false);
  useEffect(() => {
    scale.value = 1; x.value = 0; y.value = 0;
  }, [index, file.uri, scale, x, y]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));
  const gesture = useMemo(() => {
    const limitX = (value: number, s: number) => {
      'worklet';
      return limitSlideOffset(value, canvasW, pageW, s);
    };
    const limitY = (value: number, s: number) => {
      'worklet';
      return limitSlideOffset(value, canvasH, areaH, s);
    };
    const pinch = Gesture.Pinch()
      .onTouchesDown((e) => {
        if (e.allTouches.length === 2) {
          twoFingersDown.value = true;
          pinchStartReady.value = false;
        }
      })
      .onTouchesUp(() => {
        // Android emits another pinch update with the lifted finger still in pointerCount,
        // but its focal point has already moved to the remaining finger. Ignore it.
        twoFingersDown.value = false;
        pinchStartReady.value = false;
      })
      .onTouchesCancelled(() => { twoFingersDown.value = false; })
      .onStart(() => {
        pinching.value = true; panBlocked.value = true;
        // Android may report the previous focal point in its activation event.
        // The first update has a matching focal point and scale, so use that as the baseline.
        pinchStartReady.value = false;
      })
      .onUpdate((e) => {
        if (!shouldApplyPinchUpdate(twoFingersDown.value, e.numberOfPointers)) return;
        if (!pinchStartReady.value) {
          startScale.value = scale.value; startX.value = x.value; startY.value = y.value;
          startFocalX.value = e.focalX - pageW / 2;
          startFocalY.value = e.focalY - areaH / 2;
          initialGestureScale.value = e.scale > 0 ? e.scale : 1;
          pinchStartReady.value = true;
          return;
        }
        const next = Math.max(1, Math.min(4, startScale.value * e.scale / initialGestureScale.value));
        scale.value = next;
        x.value = limitX(pinchOffset(startFocalX.value, e.focalX - pageW / 2, startX.value, startScale.value, next), next);
        y.value = limitY(pinchOffset(startFocalY.value, e.focalY - areaH / 2, startY.value, startScale.value, next), next);
      })
      .onFinalize(() => { pinching.value = false; });
    const pan = Gesture.Pan().maxPointers(1).minDistance(3)
      .onStart(() => {
        panBlocked.value = pinching.value;
        panStartX.value = x.value; panStartY.value = y.value;
      })
      .onUpdate((e) => {
        if (pinching.value || panBlocked.value) return;
        x.value = limitX(panStartX.value + e.translationX, scale.value);
        y.value = limitY(panStartY.value + e.translationY, scale.value);
      });
    const doubleTap = Gesture.Tap().numberOfTaps(2).maxDistance(8).maxDuration(300).maxDelay(300)
      .onTouchesDown((e, state) => { if (e.allTouches.length > 1) state.fail(); })
      .onEnd((e, success) => {
      if (!success) return;
      const next = scale.value > 1.01 ? 1 : 2;
      scale.value = next;
      x.value = limitX(next === 1 ? 0 : -(e.x - pageW / 2), next);
      y.value = limitY(next === 1 ? 0 : -(e.y - areaH / 2), next);
    });
    return Gesture.Simultaneous(pinch, pan, doubleTap);
  }, [canvasW, canvasH, pageW, areaH, scale, x, y, startScale, startX, startY, startFocalX, startFocalY, panStartX, panStartY, pinching, panBlocked, pinchStartReady, initialGestureScale, twoFingersDown]);

  // ---- durumlar ----
  if (status === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textMuted }]}>
          {progress ? t('pptx.readingSlides', { done: progress.done, total: progress.total }) : t('pptx.preparing')}
        </Text>
      </View>
    );
  }
  if (status === 'error' || slides.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.danger} />
        <Text style={[styles.errorText, { color: colors.textSecondary, marginTop: 12 }]}>{errorMsg || t('pptx.noDisplayable')}</Text>
      </View>
    );
  }

  const cur = slides[Math.min(index, slides.length - 1)];
  const atStart = index <= 0;
  const atEnd = index >= slides.length - 1;
  const iconBtn = (name: React.ComponentProps<typeof Ionicons>['name'], label: string, onPress: () => void, active?: boolean, disabled?: boolean) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={[styles.iconBtn, active && { backgroundColor: colors.primaryGlow, borderColor: colors.primary }, disabled && { opacity: 0.4 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
    >
      <Ionicons name={name} size={20} color={active ? colors.primary : colors.text} />
    </Pressable>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Üst çubuk */}
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.counterText, { color: colors.primary }]} accessibilityLiveRegion="polite">
              SLAYT {index + 1} / {slides.length}
              {cur?.hidden ? '  ·  ' + t('pptx.hiddenCaps') : ''}
            </Text>
            {!!cur?.title && (
              <Text style={[styles.titleText, { color: colors.textSecondary }]} numberOfLines={1}>
                {cur.title}
              </Text>
            )}
          </View>
          <View style={styles.iconGroup}>
            {iconBtn('list-outline', t('pptx.goTo'), () => setGotoOpen(true))}
            {iconBtn(copied ? 'checkmark' : 'copy-outline', copied ? t('details.copied') : t('pptx.copyText'), copyText)}
            {iconBtn('document-text-outline', notesOpen ? t('pptx.hideNotes') : t('pptx.showNotes'), () => setNotesOpen((v) => !v), notesOpen)}
          </View>
        </View>
      </View>

      {/* Slayt alanı */}
      <View style={styles.visualContainer} onLayout={(e) => {
        setAreaW(Math.round(e.nativeEvent.layout.width));
        setAreaH(Math.round(e.nativeEvent.layout.height));
      }}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <GestureDetector gesture={gesture}>
            <Animated.View style={{ flex: 1, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
              <Animated.View style={[{ width: pageW, height: areaH }, animatedStyle]}>
                <SlidePage slide={slides[index]} pageW={pageW} canvasW={canvasW} canvasH={canvasH} slideWpt={slideWpt} load={loadImage} colors={colors} />
              </Animated.View>
            </Animated.View>
          </GestureDetector>
        </GestureHandlerRootView>
      </View>

      {/* Konuşmacı notları paneli */}
      {notesOpen && (
        <View style={[styles.notesPanel, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <Text style={[styles.notesLabel, { color: colors.textMuted }]}>{t('pptx.notesCapsSlide', { n: index + 1 })}</Text>
          <ScrollView style={{ maxHeight: 140 }} nestedScrollEnabled>
            <Text style={[styles.textCardBody, { color: cur?.notes ? colors.text : colors.textMuted }]} selectable>
              {cur?.notes || t('pptx.noNotes')}
            </Text>
          </ScrollView>
        </View>
      )}

      {/* Alt gezinme */}
      <View style={[styles.bottomBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <Pressable
          style={[styles.navBtn, atStart && styles.navBtnDisabled]}
          onPress={() => goTo(index - 1)}
          disabled={atStart}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t('presenter.prevSlide')}
          accessibilityState={{ disabled: atStart }}
        >
          <Ionicons name="chevron-back" size={20} color={atStart ? colors.textMuted : colors.text} />
          <Text style={[styles.navBtnText, { color: atStart ? colors.textMuted : colors.text }]}>{t('common.prev')}</Text>
        </Pressable>

        <Pressable
          onPress={() => setGotoOpen(true)}
          hitSlop={6}
          style={styles.pageBtn}
          accessibilityRole="button"
          accessibilityLabel={`Slayt ${index + 1} / ${slides.length}. Slayta git`}
        >
          <Text style={[styles.bottomPageText, { color: colors.textSecondary }]}>
            {index + 1} / {slides.length}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.navBtn, atEnd && styles.navBtnDisabled]}
          onPress={() => goTo(index + 1)}
          disabled={atEnd}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t('presenter.nextSlide')}
          accessibilityState={{ disabled: atEnd }}
        >
          <Text style={[styles.navBtnText, { color: atEnd ? colors.textMuted : colors.text }]}>{t('common.next')}</Text>
          <Ionicons name="chevron-forward" size={20} color={atEnd ? colors.textMuted : colors.text} />
        </Pressable>
      </View>

      {/* Slayta git */}
      <Modal visible={gotoOpen} transparent animationType="fade" onRequestClose={() => setGotoOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setGotoOpen(false)} accessibilityRole="button" accessibilityLabel="Kapat" />
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{t('pptx.goTo')}</Text>
              <Pressable onPress={() => setGotoOpen(false)} hitSlop={10} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Pencereyi kapat">
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <FlatList
              data={slides}
              keyExtractor={(s) => s.key}
              initialNumToRender={14}
              style={{ maxHeight: 420 }}
              renderItem={({ item, index: i }) => (
                <Pressable
                  style={[styles.gotoRow, { borderBottomColor: colors.border }, i === index && { backgroundColor: colors.primaryGlow }]}
                  onPress={() => {
                    setGotoOpen(false);
                    goTo(i);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('pptx.listItemA11y', { n: i + 1, title: item.title || t('pptx.untitled'), hidden: item.hidden ? t('pptx.hiddenSuffixA11y') : '' })}
                >
                  <Text style={[styles.gotoNum, { color: colors.primary }]}>{i + 1}</Text>
                  <Text style={[styles.gotoTitle, { color: colors.text }]} numberOfLines={2}>
                    {item.title || t('pptx.untitledSlide')}
                  </Text>
                  {item.hidden && <Text style={[styles.gotoBadge, { color: colors.textMuted }]}>gizli</Text>}
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingText: { marginTop: 16, fontSize: 14 },
  errorText: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  topBar: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, gap: 6 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  counterText: { fontSize: 12.5, fontWeight: '800', letterSpacing: 0.5 },
  titleText: { fontSize: 12, marginTop: 1 },
  iconGroup: { flexDirection: 'row', gap: 4 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewToggleGroup: { flexDirection: 'row', gap: 8 },
  toggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  toggleBtnText: { fontSize: 12.5, fontWeight: '600' },
  visualContainer: { flex: 1, justifyContent: 'center' },
  slidePageWrapper: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  slideCanvas: {
    borderRadius: 6,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  abs: { position: 'absolute' },
  imgPlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  unsupportedBox: { borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  textContainer: { flex: 1 },
  textContent: { padding: 16, paddingBottom: 40 },
  textSlideCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  textCardTitle: { fontSize: 12.5, fontWeight: '800', marginBottom: 6, textTransform: 'uppercase' },
  textCardHeading: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  textCardBody: { fontSize: 14.5, lineHeight: 22 },
  notesInline: { marginTop: 12, paddingTop: 10, borderTopWidth: 1 },
  notesLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginBottom: 4 },
  notesPanel: { paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1 },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
  },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, minHeight: 44, borderRadius: 8 },
  navBtnDisabled: { opacity: 0.4 },
  navBtnText: { fontSize: 13.5, fontWeight: '700' },
  pageBtn: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  bottomPageText: { fontSize: 13.5, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalContent: { borderRadius: 16, borderWidth: 1, padding: 16 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalTitle: { fontSize: 17, fontWeight: '800' },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  gotoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  gotoNum: { width: 32, fontSize: 14, fontWeight: '800', textAlign: 'right' },
  gotoTitle: { flex: 1, fontSize: 14 },
  gotoBadge: { fontSize: 11, fontWeight: '700' },
});
