import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Linking, Alert, Pressable } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import { CrashRecord, RELEASES_REPO, buildIssueUrl, formatReportText } from '../utils/crashReport';
import { t } from '../i18n';

interface Props {
  record: CrashRecord | null;
  appTheme: AppThemeMode;
  /** Kullanıcı kendisi başlattıysa başlık "Rapor önizleme" olur. */
  manual?: boolean;
  onClose: () => void;
}

/** Önceki oturumdaki (veya elle başlatılan) hata raporunun önizlemesi; gönderme yalnız kullanıcı onayıyla. */
export const CrashReportSheet: React.FC<Props> = ({ record, appTheme, manual, onClose }) => {
  const c = Colors[appTheme] || Colors.dark;
  const text = useMemo(() => (record ? formatReportText(record) : ''), [record]);

  const send = async () => {
    if (!record) return;
    try {
      await Linking.openURL(buildIssueUrl(record));
      onClose();
    } catch {
      Alert.alert(t('about.openFailTitle'), t('crash.openFailBody', { repo: RELEASES_REPO }));
    }
  };
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert(t('crash.copy'), t('crash.copied'));
    } catch {
      /* pano kullanılamıyorsa sessizce geç */
    }
  };

  return (
    <Modal visible={record !== null} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('crash.dismiss')} />
        <View style={[styles.sheet, { backgroundColor: c.card, borderColor: c.border }]} accessibilityViewIsModal>
          <View style={[styles.grab, { backgroundColor: c.border }]} />
          <Text style={[styles.title, { color: c.text }]} accessibilityRole="header">
            {manual ? t('crash.preview') : t('crash.sheetTitle')}
          </Text>
          <Text style={[styles.desc, { color: c.textSecondary }]}>{t('crash.sheetDesc')}</Text>
          <Text style={[styles.label, { color: c.textMuted }]}>{t('crash.preview')}</Text>
          <ScrollView style={[styles.preview, { backgroundColor: c.surface, borderColor: c.border }]} nestedScrollEnabled>
            <Text style={[styles.mono, { color: c.text }]} selectable>{text}</Text>
          </ScrollView>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btnPrimary, { backgroundColor: c.primary }]}
              onPress={send}
              accessibilityRole="button"
              accessibilityLabel={t('crash.sendA11y')}
            >
              <Text style={[styles.btnPrimaryText, { color: c.onPrimary }]}>{t('crash.send')}</Text>
            </TouchableOpacity>
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.btn, { borderColor: c.border, backgroundColor: c.surface }]}
                onPress={copy}
                accessibilityRole="button"
              >
                <Text style={[styles.btnText, { color: c.text }]}>{t('crash.copy')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { borderColor: c.border, backgroundColor: c.surface }]}
                onPress={onClose}
                accessibilityRole="button"
              >
                <Text style={[styles.btnText, { color: c.text }]}>{t('crash.dismiss')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  desc: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.8, marginTop: 4 },
  preview: { maxHeight: 260, borderRadius: 8, borderWidth: 1, padding: 12 },
  mono: { fontSize: 11, lineHeight: 15, fontFamily: 'monospace' },
  actions: { gap: 8, marginTop: 8 },
  row: { flexDirection: 'row', gap: 8 },
  btnPrimary: { minHeight: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  btnPrimaryText: { fontSize: 14, fontWeight: '700' },
  btn: { flex: 1, minHeight: 48, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 14, fontWeight: '600' },
});
