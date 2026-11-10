import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Animated, LayoutChangeEvent } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import { Image as ExpoImage } from 'expo-image';
import { SvgAst, parse } from 'react-native-svg';
import * as FileSystem from 'expo-file-system';
import { FileInfo, AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import { FileService } from '../services/fileService';
import { sanitizeSvgMarkup } from '../utils/sanitizeHtml';
import { t, resolveRef } from '../i18n';

interface ImageViewerProps {
  file: FileInfo;
  appTheme?: AppThemeMode;
}

const MAX_SVG_BYTES = 10 * 1024 * 1024;
const MIN_SCALE = 1;
const MAX_SCALE = 8;
const MIN_LIVE_SCALE = 0.7; // pinch sırasında bırakılırsa 1'e döner
const DOUBLE_TAP_SCALE = 2.5;
const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

// @@PURE-START (React/RN bağımlılığı olmayan saf geometri/SVG mantığı; node testi bu bölümü çıkarıp çalıştırır)
interface Size {
  w: number;
  h: number;
}

interface SvgSizeInfo extends Size {
  hasViewBox: boolean;
}

/** SVG kök etiketinden doğal boyut: önce viewBox, yoksa (yüzdesiz) width/height. */
function parseSvgSize(xml: string): SvgSizeInfo | null {
  const tagMatch = /<svg\b[^>]*>/i.exec(xml);
  if (!tagMatch) return null;
  const tag = tagMatch[0];
  const num = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
  const vb = new RegExp(`\\sviewBox\\s*=\\s*["']\\s*(${num})[\\s,]+(${num})[\\s,]+(${num})[\\s,]+(${num})\\s*["']`, 'i').exec(tag);
  if (vb) {
    const w = parseFloat(vb[3]);
    const h = parseFloat(vb[4]);
    if (w > 0 && h > 0) return { w, h, hasViewBox: true };
  }
  const wm = new RegExp(`\\swidth\\s*=\\s*["']\\s*(${num})\\s*([a-z%]*)\\s*["']`, 'i').exec(tag);
  const hm = new RegExp(`\\sheight\\s*=\\s*["']\\s*(${num})\\s*([a-z%]*)\\s*["']`, 'i').exec(tag);
  if (wm && hm && wm[2] !== '%' && hm[2] !== '%') {
    const w = parseFloat(wm[1]);
    const h = parseFloat(hm[1]);
    if (w > 0 && h > 0) return { w, h, hasViewBox: false };
  }
  return null;
}

/** viewBox'ı olmayan SVG'ye width/height'tan viewBox ekler (kapsayıcıya ölçeklenebilsin). */
function injectViewBox(xml: string, info: SvgSizeInfo | null): string {
  if (!info || info.hasViewBox) return xml;
  return xml.replace(/<svg\b/i, `<svg viewBox="0 0 ${info.w} ${info.h}"`);
}

interface FitLayout {
  /** Görsel elemanın (döndürülmemiş) boyutu */
  imgW: number;
  imgH: number;
  /** Döndürme sonrası ekranda kaplanan boyut */
  visW: number;
  visH: number;
}

/** 90° katlarında en/boy takasıyla kapsayıcıya sığdırma. maxUpscale: doğal boyutun kaç katına kadar büyütülebilir. */
function computeFit(cw: number, ch: number, nat: Size | null, rotation: number, maxUpscale: number): FitLayout | null {
  if (!nat || !(cw > 0) || !(ch > 0) || !(nat.w > 0) || !(nat.h > 0)) return null;
  const swap = Math.abs(rotation % 180) === 90;
  const ew = swap ? nat.h : nat.w;
  const eh = swap ? nat.w : nat.h;
  const fit = Math.min(cw / ew, ch / eh, maxUpscale);
  return { imgW: nat.w * fit, imgH: nat.h * fit, visW: ew * fit, visH: eh * fit };
}

/** Bir eksendeki kaydırmayı, görselin kapsayıcıdan taşan yarım miktarıyla sınırla. */
function clampPan(t: number, scale: number, vis: number, cont: number): number {
  const max = Math.max(0, (vis * scale - cont) / 2);
  return Math.min(max, Math.max(-max, t));
}

/** Odak noktası (kapsayıcı merkezine göre) sabit kalacak şekilde yeni öteleme. */
function focalTranslate(focal: number, t0: number, s0: number, s1: number): number {
  return focal - (focal - t0) * (s1 / s0);
}
// @@PURE-END

type SvgAstType = ReturnType<typeof parse>;

interface SvgParsed {
  ast: SvgAstType | null;
  size: SvgSizeInfo | null;
  error: string;
}

function parseSvgSafe(content: string): SvgParsed {
  if (!content) return { ast: null, size: null, error: '' };
  const clean = sanitizeSvgMarkup(content);
  if (!/<svg[\s>]/i.test(clean)) {
    return { ast: null, size: null, error: t('image.svgInvalid') };
  }
  try {
    const size = parseSvgSize(clean);
    const ast = parse(injectViewBox(clean, size));
    if (!ast) return { ast: null, size, error: t('image.svgParseFail') };
    return { ast, size, error: '' };
  } catch {
    return { ast: null, size: null, error: t('image.svgCorrupt') };
  }
}

export const ImageViewer: React.FC<ImageViewerProps> = ({ file, appTheme = 'emerald' }) => {
  const [rotation, setRotation] = useState<number>(0);
  const [zoomPct, setZoomPct] = useState<number>(100);
  const [showMetadata, setShowMetadata] = useState<boolean>(false);
  const [svgContent, setSvgContent] = useState<string>(file.content || '');
  const [svgLoadError, setSvgLoadError] = useState<string>('');
  const [container, setContainer] = useState<Size>({ w: 0, h: 0 });
  const [natural, setNatural] = useState<Size | null>(null);
  const [rasterLoading, setRasterLoading] = useState<boolean>(true);
  const [rasterError, setRasterError] = useState<boolean>(false);
  const [retryKey, setRetryKey] = useState<number>(0);

  const currentColors = Colors[appTheme] || Colors.emerald;
  const ext = (file.extension || '').toLowerCase();
  const isSvg = ext === 'svg' || file.name.toLowerCase().endsWith('.svg');

  // ----- dönüşüm durumu (Animated + ref'ler; gesture callback'leri bayat state görmesin)
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const sRef = useRef<number>(1);
  const txRef = useRef<number>(0);
  const tyRef = useRef<number>(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const contRef = useRef<Size>({ w: 0, h: 0 });
  const visRef = useRef<Size>({ w: 0, h: 0 });

  // SVG: kaynağı oku
  useEffect(() => {
    let isMounted = true;
    if (!isSvg) return undefined;
    setSvgLoadError('');
    if (file.content) {
      setSvgContent(file.content);
      return () => {
        isMounted = false;
      };
    }
    setSvgContent('');
    if (file.size > MAX_SVG_BYTES) {
      setSvgLoadError(t('image.svgTooLarge'));
      return () => {
        isMounted = false;
      };
    }
    FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.UTF8 })
      .then((content) => {
        if (!isMounted) return;
        if (content.length > MAX_SVG_BYTES) setSvgLoadError(t('image.svgTooLarge'));
        else setSvgContent(content);
      })
      .catch(() => {
        if (isMounted) setSvgLoadError(t('image.svgReadFail'));
      });
    return () => {
      isMounted = false;
    };
  }, [file.uri, file.content, file.size, isSvg, retryKey]);

  // Dosya değişirse her şeyi sıfırla
  useEffect(() => {
    setNatural(null);
    setRasterLoading(true);
    setRasterError(false);
    setRotation(0);
    resetTransformNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.uri]);

  useEffect(
    () => () => {
      if (animRef.current) animRef.current.stop();
    },
    []
  );

  const svg = useMemo(() => (isSvg ? parseSvgSafe(svgContent) : null), [isSvg, svgContent]);

  const nat: Size | null = isSvg
    ? svg && svg.ast
      ? svg.size || (container.w > 0 ? { w: container.w, h: container.h } : null)
      : null
    : natural;
  const layout = useMemo(
    () => computeFit(container.w, container.h, nat, rotation, isSvg ? Infinity : 4),
    [container.w, container.h, nat ? nat.w : 0, nat ? nat.h : 0, rotation, isSvg] // eslint-disable-line react-hooks/exhaustive-deps
  );
  visRef.current = layout ? { w: layout.visW, h: layout.visH } : { w: 0, h: 0 };
  contRef.current = container;

  function applyTransform(s: number, x: number, y: number) {
    sRef.current = s;
    txRef.current = x;
    tyRef.current = y;
    scale.setValue(s);
    tx.setValue(x);
    ty.setValue(y);
  }

  function resetTransformNow() {
    if (animRef.current) animRef.current.stop();
    animRef.current = null;
    applyTransform(1, 0, 0);
    setZoomPct(100);
  }

  const clampXY = (s: number, x: number, y: number): [number, number] => {
    const c = contRef.current;
    const v = visRef.current;
    return [clampPan(x, s, v.w, c.w), clampPan(y, s, v.h, c.h)];
  };

  const animateTo = (s: number, x: number, y: number) => {
    if (animRef.current) animRef.current.stop();
    const [cx, cy] = s <= 1 ? [0, 0] : clampXY(s, x, y);
    sRef.current = s;
    txRef.current = cx;
    tyRef.current = cy;
    setZoomPct(Math.round(s * 100));
    const anim = Animated.parallel([
      Animated.timing(scale, { toValue: s, duration: 180, useNativeDriver: true }),
      Animated.timing(tx, { toValue: cx, duration: 180, useNativeDriver: true }),
      Animated.timing(ty, { toValue: cy, duration: 180, useNativeDriver: true }),
    ]);
    animRef.current = anim;
    anim.start();
  };

  // ----- hareketler (yalnız ref'lere dayanır; runOnJS: reanimated worklet'e dönüşmesin)
  const gesture = useMemo(() => {
    const stopAnim = () => {
      if (animRef.current) {
        animRef.current.stop();
        animRef.current = null;
      }
    };
    let s0 = 1;
    let tx0 = 0;
    let ty0 = 0;
    let fx0 = 0;
    let fy0 = 0;
    let px0 = 0;
    let py0 = 0;

    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart((e) => {
        stopAnim();
        s0 = sRef.current;
        tx0 = txRef.current;
        ty0 = tyRef.current;
        fx0 = e.focalX - contRef.current.w / 2;
        fy0 = e.focalY - contRef.current.h / 2;
      })
      .onUpdate((e) => {
        const ns = Math.min(MAX_SCALE, Math.max(MIN_LIVE_SCALE, s0 * e.scale));
        const fx = e.focalX - contRef.current.w / 2;
        const fy = e.focalY - contRef.current.h / 2;
        // Başlangıçta odaktaki görsel noktası şimdiki odak noktasının altında kalsın.
        const nx = focalTranslate(fx0, tx0, s0, ns) + (fx - fx0);
        const ny = focalTranslate(fy0, ty0, s0, ns) + (fy - fy0);
        const [cx, cy] = ns <= 1 ? [0, 0] : clampXY(ns, nx, ny);
        applyTransform(ns, cx, cy);
      })
      .onEnd(() => {
        const s = sRef.current;
        if (s < MIN_SCALE + 0.02) animateTo(1, 0, 0);
        else setZoomPct(Math.round(s * 100));
      });

    const pan = Gesture.Pan()
      .runOnJS(true)
      .maxPointers(1)
      .minDistance(3)
      .onStart(() => {
        stopAnim();
        px0 = txRef.current;
        py0 = tyRef.current;
      })
      .onUpdate((e) => {
        if (sRef.current <= 1.001) return;
        const [cx, cy] = clampXY(sRef.current, px0 + e.translationX, py0 + e.translationY);
        applyTransform(sRef.current, cx, cy);
      });

    const doubleTap = Gesture.Tap()
      .runOnJS(true)
      .numberOfTaps(2)
      .maxDuration(300)
      .onEnd((e, success) => {
        if (!success) return;
        if (sRef.current > 1.05) {
          animateTo(1, 0, 0);
          return;
        }
        const fx = e.x - contRef.current.w / 2;
        const fy = e.y - contRef.current.h / 2;
        animateTo(DOUBLE_TAP_SCALE, focalTranslate(fx, txRef.current, sRef.current, DOUBLE_TAP_SCALE), focalTranslate(fy, tyRef.current, sRef.current, DOUBLE_TAP_SCALE));
      });

    return Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainer((prev) => (Math.abs(prev.w - width) < 0.5 && Math.abs(prev.h - height) < 0.5 ? prev : { w: width, h: height }));
  }, []);

  const handleRotate = () => {
    resetTransformNow();
    setRotation((r) => (r + 90) % 360);
  };

  const stepZoom = (factor: number) => {
    const s = sRef.current;
    const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor));
    if (ns === s) return;
    if (ns <= 1) {
      animateTo(1, 0, 0);
      return;
    }
    const k = ns / s;
    animateTo(ns, txRef.current * k, tyRef.current * k);
  };

  const handleRetry = () => {
    setRasterError(false);
    setRasterLoading(true);
    setNatural(null);
    setRetryKey((k) => k + 1);
  };

  // ----- içerik
  const hasError = isSvg ? !!svgLoadError || !!(svg && svg.error) : rasterError;
  const errorText = isSvg
    ? svgLoadError || (svg ? svg.error : '')
    : t('image.decodeFail');
  const isLoading = !hasError && (isSvg ? (!svgContent && !svgLoadError) : rasterLoading);
  const atMin = zoomPct <= 100;
  const atMax = zoomPct >= MAX_SCALE * 100;

  const imgStyle = layout
    ? { width: layout.imgW, height: layout.imgH }
    : { width: container.w, height: container.h };
  const boxLeft = layout ? (container.w - layout.imgW) / 2 : 0;
  const boxTop = layout ? (container.h - layout.imgH) / 2 : 0;

  const resolution = nat ? `${Math.round(nat.w)} × ${Math.round(nat.h)} px` : '—';
  const megapixels = !isSvg && nat ? `${((nat.w * nat.h) / 1000000).toFixed(1).replace('.', ',')} MP` : '';

  return (
    <View style={[styles.container, { backgroundColor: currentColors.background }]}>
      {/* Araç çubuğu */}
      <View style={[styles.toolbar, { backgroundColor: currentColors.surface, borderBottomColor: currentColors.border }]}>
        <Text
          style={[styles.zoomText, { color: currentColors.textSecondary }]}
          numberOfLines={1}
          accessibilityLabel={t('image.zoomA11y', { zoom: zoomPct, rotation })}
        >
          {zoomPct}% • {rotation}°
        </Text>

        <View style={styles.toolbarRight}>
          <TouchableOpacity
            style={[styles.toolBtn, atMin && styles.toolBtnDisabled]}
            onPress={() => stepZoom(1 / 1.5)}
            disabled={atMin || hasError}
            hitSlop={HIT}
            accessibilityRole="button"
            accessibilityLabel={t('image.zoomOut')}
            accessibilityState={{ disabled: atMin || hasError }}
          >
            <Ionicons name="remove-circle-outline" size={24} color={currentColors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toolBtn, atMax && styles.toolBtnDisabled]}
            onPress={() => stepZoom(1.5)}
            disabled={atMax || hasError}
            hitSlop={HIT}
            accessibilityRole="button"
            accessibilityLabel={t('image.zoomIn')}
            accessibilityState={{ disabled: atMax || hasError }}
          >
            <Ionicons name="add-circle-outline" size={24} color={currentColors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toolBtn, atMin && rotation === 0 && styles.toolBtnDisabled]}
            onPress={() => {
              animateTo(1, 0, 0);
              setRotation(0);
            }}
            disabled={(atMin && rotation === 0) || hasError}
            hitSlop={HIT}
            accessibilityRole="button"
            accessibilityLabel={t('image.fitReset')}
            accessibilityState={{ disabled: (atMin && rotation === 0) || hasError }}
          >
            <MaterialCommunityIcons name="fit-to-screen-outline" size={24} color={currentColors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.toolBtn}
            onPress={handleRotate}
            disabled={hasError}
            hitSlop={HIT}
            accessibilityRole="button"
            accessibilityLabel={t('image.rotate')}
            accessibilityState={{ disabled: hasError }}
          >
            <MaterialCommunityIcons name="rotate-right" size={24} color={hasError ? currentColors.textMuted : currentColors.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.toolBtn}
            onPress={() => setShowMetadata((v) => !v)}
            hitSlop={HIT}
            accessibilityRole="button"
            accessibilityLabel={showMetadata ? t('image.hideInfo') : t('image.showInfo')}
            accessibilityState={{ expanded: showMetadata }}
          >
            <Ionicons
              name={showMetadata ? 'information-circle' : 'information-circle-outline'}
              size={24}
              color={showMetadata ? currentColors.primary : currentColors.text}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Görsel alanı */}
      <GestureHandlerRootView style={styles.imageArea}>
        <GestureDetector gesture={gesture}>
          <View style={styles.imageArea} onLayout={handleLayout} collapsable={false}>
            {!hasError && (isSvg ? !!(svg && svg.ast) : true) ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.box,
                  {
                    left: boxLeft,
                    top: boxTop,
                    width: imgStyle.width,
                    height: imgStyle.height,
                    opacity: layout || isSvg ? 1 : 0.01,
                    transform: [{ translateX: tx }, { translateY: ty }, { scale }],
                  },
                ]}
              >
                <View style={{ width: imgStyle.width, height: imgStyle.height, transform: [{ rotate: `${rotation}deg` }] }}>
                  {isSvg && svg && svg.ast ? (
                    <SvgAst ast={svg.ast} override={{ width: imgStyle.width, height: imgStyle.height }} />
                  ) : null}
                  {!isSvg ? (
                    <ExpoImage
                      key={retryKey}
                      source={{ uri: file.uri }}
                      style={imgStyle}
                      contentFit={layout ? 'fill' : 'contain'}
                      transition={0}
                      onLoadStart={() => setRasterLoading(true)}
                      onLoad={(e) => {
                        const w = e.source.width;
                        const h = e.source.height;
                        if (w > 0 && h > 0) setNatural({ w, h });
                        setRasterLoading(false);
                      }}
                      onError={() => {
                        setRasterLoading(false);
                        setRasterError(true);
                      }}
                      accessible
                      accessibilityLabel={t('image.a11y', { name: file.name })}
                    />
                  ) : null}
                </View>
              </Animated.View>
            ) : null}

            {isLoading ? (
              <View style={styles.overlayCenter} pointerEvents="none">
                <ActivityIndicator size="large" color={currentColors.primary} />
              </View>
            ) : null}

            {hasError ? (
              <View style={styles.overlayCenter}>
                <Ionicons name="image-outline" size={44} color={currentColors.textMuted} />
                <Text style={[styles.errorText, { color: currentColors.textSecondary }]} accessibilityRole="alert">
                  {errorText}
                </Text>
                <TouchableOpacity
                  style={[styles.retryBtn, { borderColor: currentColors.border }]}
                  onPress={handleRetry}
                  hitSlop={HIT}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.retry')}
                >
                  <Ionicons name="refresh" size={16} color={currentColors.primary} />
                  <Text style={[styles.retryText, { color: currentColors.primary }]}>{t('common.retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </GestureDetector>
      </GestureHandlerRootView>

      {/* Bilgi paneli */}
      {showMetadata ? (
        <View style={[styles.metaPanel, { backgroundColor: currentColors.card, borderTopColor: currentColors.border }]}>
          <Text style={[styles.metaTitle, { color: currentColors.text }]}>{t('image.infoTitle')}</Text>
          <View style={styles.metaRow}>
            <Text style={[styles.metaLabel, { color: currentColors.textMuted }]}>{t('image.format')}</Text>
            <Text style={[styles.metaVal, { color: currentColors.primary }]}>{(ext || t('image.unknown')).toUpperCase()}</Text>
            <Text style={[styles.metaLabel, { color: currentColors.textMuted, marginLeft: 16 }]}>{t('image.size')}</Text>
            <Text style={[styles.metaVal, { color: currentColors.text }]}>{file.size > 0 ? FileService.formatFileSize(file.size) : '—'}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={[styles.metaLabel, { color: currentColors.textMuted }]}>{isSvg ? t('image.canvas') : t('image.resolution')}</Text>
            <Text style={[styles.metaVal, { color: currentColors.text }]}>
              {resolution}
              {megapixels ? ` (${megapixels})` : ''}
            </Text>
          </View>
          <Text style={[styles.metaDesc, { color: currentColors.textSecondary }]} numberOfLines={2}>
            {resolveRef(file.description) || t('image.hint')}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 2,
    borderBottomWidth: 1,
  },
  zoomText: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
    marginRight: 8,
  },
  toolbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBtnDisabled: {
    opacity: 0.4,
  },
  imageArea: {
    flex: 1,
    overflow: 'hidden',
  },
  box: {
    position: 'absolute',
  },
  overlayCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    marginTop: 12,
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
  metaPanel: {
    padding: 14,
    borderTopWidth: 1,
  },
  metaTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  metaLabel: {
    fontSize: 12,
  },
  metaVal: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 4,
  },
  metaDesc: {
    fontSize: 11.5,
    marginTop: 4,
  },
});
