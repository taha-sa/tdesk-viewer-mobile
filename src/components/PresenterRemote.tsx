import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, PanResponder, ActivityIndicator, BackHandler } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import { onBridgeResult, sendPresentKey, PresentKey, PresentState } from '../services/bridgeService';

interface PresenterRemoteProps {
  appTheme: AppThemeMode;
  fileName: string;
  /** Dosya PC'ye gönderilirken true (ilk açılış). */
  starting: boolean;
  /** Başlatma hatası (varsa boş durum yerine hata kartı gösterilir). */
  startError: string | null;
  onRetry: () => void;
  onClose: () => void;
}

const SWIPE_MIN = 48;
/** Bu sürede durum olayı gelmezse (eski T-Bridge) sunum açık varsayılır. */
const STATE_TIMEOUT_MS = 20000;

/**
 * Sunum kumandası: PC'de açılan sunumu Önceki / Sonraki düğmeleri ve kaydırma ile yönetir; "Sunumu bitir" Esc gönderir.
 * Tuşlar T-Bridge üzerinden PC'ye gider (ok tuşları / Esc).
 */
export const PresenterRemote: React.FC<PresenterRemoteProps> = ({ appTheme, fileName, starting, startError, onRetry, onClose }) => {
  const c = Colors[appTheme] || Colors.dark;
  const [status, setStatus] = useState<string>('');
  const [bad, setBad] = useState(false);
  const [pressed, setPressed] = useState<PresentKey | null>(null);
  const alive = useRef(true);
  // Sunum durumu: null = henüz olay yok; 'opened' eski T-Bridge için zaman aşımıyla da atanır.
  const [phase, setPhase] = useState<PresentState | null>(null);
  const [failMsg, setFailMsg] = useState<string | null>(null);

  // Yeni başlatma (veya yeniden deneme): durumu sıfırla.
  useEffect(() => {
    if (starting) { setPhase(null); setFailMsg(null); }
  }, [starting]);

  // Dosya gönderildi ama T-Bridge durum bildirmedi: 20 sn sonra eski davranışa düş.
  useEffect(() => {
    if (starting || startError || phase === 'opened' || phase === 'failed') return;
    const t = setTimeout(() => { if (alive.current) setPhase('opened'); }, STATE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [starting, startError, phase]);

  useEffect(() => {
    alive.current = true;
    const sub = onBridgeResult((r) => {
      if (!alive.current) return;
      if (r.state) {
        setPhase(r.state);
        if (r.state === 'failed') setFailMsg(r.message || 'Sunum bilgisayarda açılamadı.');
        else if (r.message) setStatus(r.message);
        return;
      }
      if (r.message) setStatus(r.message);
      setBad(!r.ok);
    });
    return () => { alive.current = false; sub.remove(); };
  }, []);

  const press = useCallback(async (key: PresentKey) => {
    setPressed(key);
    setTimeout(() => { if (alive.current) setPressed(null); }, 150);
    const err = await sendPresentKey(key);
    if (!alive.current) return;
    if (err) { setStatus(err); setBad(true); }
    else if (bad) { setStatus(''); setBad(false); }
  }, [bad]);

  // Sunum bitti/başlamadı mı? Unmount'ta tekrar 'end' gitmesin (idempotent).
  const endSent = useRef(false);
  const stateRef = useRef({ startError, failMsg });
  stateRef.current = { startError, failMsg };
  useEffect(() => () => {
    const st = stateRef.current;
    if (endSent.current || st.startError || st.failMsg) return;
    endSent.current = true;
    void sendPresentKey('end');
  }, []);

  const finish = useCallback(async () => {
    if (startError || failMsg) { onClose(); return; }
    if (!endSent.current) { endSent.current = true; await sendPresentKey('end'); }
    onClose();
  }, [onClose, startError, failMsg]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { void finish(); return true; });
    return () => sub.remove();
  }, [finish]);

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderRelease: (_e, g) => {
      if (g.dx <= -SWIPE_MIN) void pressRef.current('next');
      else if (g.dx >= SWIPE_MIN) void pressRef.current('prev');
    },
  })).current;
  const pressRef = useRef(press);
  pressRef.current = press;

  const errText = startError ?? failMsg;
  const transferring = starting || phase === 'transferring';
  const waiting = !transferring && phase === null;
  if (errText) {
    return (
      <View style={[styles.root, { backgroundColor: c.background }]}>
        <Ionicons name="alert-circle-outline" size={44} color={c.danger} />
        <Text style={[styles.title, { color: c.text }]}>Sunum başlatılamadı</Text>
        <Text style={[styles.body, { color: c.textSecondary }]}>{errText}</Text>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.smallBtn, { backgroundColor: c.primary }]} onPress={onRetry} accessibilityRole="button">
            <Text style={[styles.smallBtnText, { color: c.onPrimary }]}>Yeniden dene</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.smallBtn, { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1 }]} onPress={onClose} accessibilityRole="button">
            <Text style={[styles.smallBtnText, { color: c.text }]}>Vazgeç</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: c.background }]} {...pan.panHandlers}>
      <View style={styles.head}>
        <Ionicons name="easel-outline" size={22} color={c.primary} />
        <Text style={[styles.fileName, { color: c.text }]} numberOfLines={1}>{fileName}</Text>
      </View>

      <View style={[styles.statusPill, { backgroundColor: bad ? c.danger + '24' : c.primaryGlow }]} accessibilityLiveRegion="polite">
        {(transferring || waiting) ? <ActivityIndicator size="small" color={c.primary} /> : <Ionicons name={bad ? 'warning-outline' : 'desktop-outline'} size={16} color={bad ? c.danger : c.primary} />}
        <Text style={[styles.statusText, { color: bad ? c.danger : c.textSecondary }]} numberOfLines={2}>
          {transferring ? 'Dosya aktarılıyor…' : waiting ? 'Bilgisayarın yanıtı bekleniyor…' : (status || 'Bilgisayarda sunum açık. Kaydırarak veya düğmelerle ilerleyin.')}
        </Text>
      </View>

      <View style={styles.pad}>
        <TouchableOpacity
          style={[styles.bigBtn, { backgroundColor: c.surface, borderColor: pressed === 'prev' ? c.primary : c.border }]}
          onPress={() => void press('prev')}
          disabled={transferring}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Önceki slayt"
        >
          <Ionicons name="chevron-back" size={44} color={c.text} />
          <Text style={[styles.bigLabel, { color: c.text }]}>Önceki</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.bigBtn, { backgroundColor: c.primary, borderColor: c.primary, opacity: pressed === 'next' ? 0.85 : 1 }]}
          onPress={() => void press('next')}
          disabled={transferring}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Sonraki slayt"
        >
          <Ionicons name="chevron-forward" size={44} color={c.onPrimary} />
          <Text style={[styles.bigLabel, { color: c.onPrimary }]}>Sonraki</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.hint, { color: c.textMuted }]}>Sola kaydır: sonraki · Sağa kaydır: önceki</Text>

      <TouchableOpacity
        style={[styles.endBtn, { borderColor: c.danger }]}
        onPress={() => void finish()}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Sunumu bitir"
      >
        <Ionicons name="stop-circle-outline" size={20} color={c.danger} />
        <Text style={[styles.endText, { color: c.danger }]}>Sunumu bitir</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, justifyContent: 'center', alignItems: 'stretch', gap: 18 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' },
  fileName: { fontSize: 16, fontWeight: '800', flexShrink: 1 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  statusText: { flex: 1, fontSize: 13, fontWeight: '600' },
  pad: { flexDirection: 'row', gap: 14, flex: 1, maxHeight: 280, minHeight: 160 },
  bigBtn: { flex: 1, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center', gap: 6 },
  bigLabel: { fontSize: 18, fontWeight: '800' },
  hint: { textAlign: 'center', fontSize: 12 },
  endBtn: { minHeight: 50, borderRadius: 14, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  endText: { fontSize: 15, fontWeight: '800' },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  body: { textAlign: 'center', lineHeight: 20, alignSelf: 'center', maxWidth: 340 },
  row: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  smallBtn: { minHeight: 46, paddingHorizontal: 18, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  smallBtnText: { fontSize: 14, fontWeight: '800' },
});
