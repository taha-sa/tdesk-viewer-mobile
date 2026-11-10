import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import { authenticate } from '../services/appLock';
import { t } from '../i18n';

interface Props {
  appTheme: AppThemeMode;
  /** Uygulama ön planda mı; ön plana dönünce (kilitliyse) doğrulama penceresi otomatik açılır. */
  active: boolean;
  onUnlock: () => void;
  /** Cihazda doğrulama yöntemi kalmadıysa kullanıcıyı kilitte bırakmamak için kilidi kapatır. */
  onDisableLock: () => void;
}

export const LockScreen: React.FC<Props> = ({ appTheme, active, onUnlock, onDisableLock }) => {
  const c = Colors[appTheme] || Colors.emerald;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [unrecoverable, setUnrecoverable] = useState(false);
  const mounted = useRef(true);
  const running = useRef(false);
  const finishedAt = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage('');
    const r = await authenticate(t('lock.authPrompt'));
    running.current = false;
    finishedAt.current = Date.now();
    if (!mounted.current) {
      if (r.ok) onUnlock();
      return;
    }
    setBusy(false);
    if (r.ok) {
      onUnlock();
    } else {
      setMessage(r.message || t('lock.authFailed'));
      setUnrecoverable(r.unrecoverable);
    }
  }, [onUnlock]);

  useEffect(() => {
    // iOS'ta Face ID penceresi uygulamayı kısa süre 'inactive' yapar; iptal sonrası dönüşte pencere yeniden açılıp döngüye girmesin.
    if (active && Date.now() - finishedAt.current > 1500) void run();
  }, [active, run]);

  return (
    <View style={[styles.container, { backgroundColor: c.background }]} accessibilityViewIsModal>
      <View style={[styles.iconWrap, { backgroundColor: c.primaryGlow, borderColor: c.primary }]}>
        <Ionicons name="lock-closed" size={36} color={c.primary} />
      </View>
      <Text style={[styles.title, { color: c.text }]} accessibilityRole="header">{t('lock.title')}</Text>
      <Text style={[styles.desc, { color: c.textSecondary }]}>
        {t('lock.desc')}
      </Text>
      {message ? (
        <Text style={[styles.msg, { color: c.warning }]} accessibilityLiveRegion="polite">{message}</Text>
      ) : null}
      {busy ? (
        <ActivityIndicator style={styles.spinner} color={c.primary} />
      ) : (
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: c.primary }]}
          onPress={() => void run()}
          accessibilityRole="button"
          accessibilityLabel={t('lock.unlock')}
        >
          <Ionicons name="finger-print" size={20} color={c.onPrimary} />
          <Text style={[styles.btnText, { color: c.onPrimary }]}>{message ? t('common.retry') : t('lock.unlock')}</Text>
        </TouchableOpacity>
      )}
      {unrecoverable && !busy ? (
        <TouchableOpacity
          style={[styles.link, { borderColor: c.border }]}
          onPress={onDisableLock}
          accessibilityRole="button"
          accessibilityLabel={t('lock.turnOff')}
        >
          <Text style={[styles.linkText, { color: c.text }]}>{t('lock.turnOff')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  iconWrap: { width: 84, height: 84, borderRadius: 42, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '800', marginTop: 20 },
  desc: { fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20, maxWidth: 300 },
  msg: { fontSize: 13, textAlign: 'center', marginTop: 14, maxWidth: 300 },
  spinner: { marginTop: 28, height: 48 },
  btn: { marginTop: 28, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24, borderRadius: 12 },
  btnText: { fontSize: 15, fontWeight: '800' },
  link: { marginTop: 16, minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10, borderWidth: 1 },
  linkText: { fontSize: 13, fontWeight: '700' },
});
