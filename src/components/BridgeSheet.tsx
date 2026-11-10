import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import { t } from '../i18n';

interface BridgeSheetProps {
  visible: boolean;
  appTheme: AppThemeMode;
  fileName: string;
  /** pdf/pptx ise t('bridge.presentTitle') seçeneği gösterilir. */
  canPresent: boolean;
  locked: boolean;
  onSend: () => void;
  onPresent: () => void;
  onClose: () => void;
}

/** t('bridge.sheetTitle') eylemleri: T-Bridge ile PC'ye gönder / PC'de sun. */
export const BridgeSheet: React.FC<BridgeSheetProps> = ({ visible, appTheme, fileName, canPresent, locked, onSend, onPresent, onClose }) => {
  const c = Colors[appTheme] || Colors.dark;
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')}>
        <Pressable style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border, paddingBottom: 16 + insets.bottom }]} onPress={() => {}}>
          <View style={[styles.grip, { backgroundColor: c.border }]} />
          <Text style={[styles.title, { color: c.text }]}>{t('bridge.sheetTitle')}</Text>
          <Text style={[styles.sub, { color: c.textMuted }]} numberOfLines={1}>{fileName}</Text>

          <Row c={c} icon="paper-plane-outline" title={t('bridge.sendTitle')} desc={t('bridge.sendDesc')} locked={locked} onPress={onSend} />
          {canPresent && (
            <Row c={c} icon="easel-outline" title={t('bridge.presentTitle')} desc={t('bridge.presentDesc')} locked={locked} onPress={onPresent} />
          )}
          <TouchableOpacity style={styles.cancel} onPress={onClose} accessibilityRole="button">
            <Text style={[styles.cancelText, { color: c.textSecondary }]}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const Row: React.FC<{ c: ReturnType<typeof pick>; icon: React.ComponentProps<typeof Ionicons>['name']; title: string; desc: string; locked: boolean; onPress: () => void }> = ({ c, icon, title, desc, locked, onPress }) => (
  <TouchableOpacity
    style={[styles.row, { backgroundColor: c.card, borderColor: c.cardBorder }]}
    onPress={onPress}
    activeOpacity={0.75}
    accessibilityRole="button"
    accessibilityLabel={title}
  >
    <View style={[styles.iconWrap, { backgroundColor: c.primaryGlow }]}>
      <Ionicons name={icon} size={22} color={c.primary} />
    </View>
    <View style={styles.rowText}>
      <Text style={[styles.rowTitle, { color: c.text }]}>{title}</Text>
      <Text style={[styles.rowDesc, { color: c.textSecondary }]}>{desc}</Text>
    </View>
    <Ionicons name={locked ? "lock-closed" : "chevron-forward"} size={18} color={c.textMuted} />
  </TouchableOpacity>
);

export const BridgeInvite: React.FC<{ kind: 'send' | 'present' | null; appTheme: AppThemeMode; onClose: () => void }> = ({ kind, appTheme, onClose }) => {
  const c = Colors[appTheme] || Colors.dark;
  return (
    <Modal visible={kind !== null} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.dialogBackdrop}>
        <View style={[styles.dialog, { backgroundColor: c.surface, borderColor: c.border }]} accessibilityViewIsModal>
          <TouchableOpacity style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={24} color={c.textSecondary} />
          </TouchableOpacity>
          <Text style={[styles.dialogTitle, { color: c.text }]}>{kind === 'present' ? t('bridge.invitePresentTitle') : t('bridge.inviteSendTitle')}</Text>
          <Text style={[styles.dialogBody, { color: c.textSecondary }]}>{kind === 'present' ? t('bridge.invitePresentBody') : t('bridge.inviteSendBody')}</Text>
          <TouchableOpacity style={[styles.primaryButton, { backgroundColor: c.primary }]} onPress={() => { void Linking.openURL('https://github.com/taha-sa/t-bridge-releases/releases/latest').catch(() => {}); }} accessibilityRole="button" accessibilityLabel={t('bridge.getApp')}>
            <Text style={[styles.primaryText, { color: c.onPrimary }]}>{t('bridge.getApp')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const pick = (t: AppThemeMode) => Colors[t];

const styles = StyleSheet.create({
  dialogBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  dialog: { borderRadius: 20, borderWidth: 1, padding: 20, gap: 14 },
  close: { alignSelf: 'flex-end', padding: 4 },
  dialogTitle: { fontSize: 18, fontWeight: '800' },
  dialogBody: { fontSize: 14, lineHeight: 21 },
  primaryButton: { borderRadius: 12, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 15, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderBottomWidth: 0, padding: 16, gap: 10 },
  grip: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginBottom: 6 },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 12, marginTop: -6, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1 },
  iconWrap: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowDesc: { fontSize: 12, marginTop: 2 },
  cancel: { alignItems: 'center', paddingVertical: 12 },
  cancelText: { fontSize: 14, fontWeight: '700' },
});
