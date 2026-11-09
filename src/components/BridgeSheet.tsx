import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppThemeMode } from '../types';
import { Colors } from '../theme/colors';

interface BridgeSheetProps {
  visible: boolean;
  appTheme: AppThemeMode;
  fileName: string;
  /** pdf/pptx ise "Bilgisayarda sun" seçeneği gösterilir. */
  canPresent: boolean;
  onSend: () => void;
  onPresent: () => void;
  onClose: () => void;
}

/** "Bilgisayar" eylemleri: T-Bridge ile PC'ye gönder / PC'de sun. Yalnızca T-Bridge kuruluyken açılır. */
export const BridgeSheet: React.FC<BridgeSheetProps> = ({ visible, appTheme, fileName, canPresent, onSend, onPresent, onClose }) => {
  const c = Colors[appTheme] || Colors.dark;
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Kapat">
        <Pressable style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border, paddingBottom: 16 + insets.bottom }]} onPress={() => {}}>
          <View style={[styles.grip, { backgroundColor: c.border }]} />
          <Text style={[styles.title, { color: c.text }]}>Bilgisayar</Text>
          <Text style={[styles.sub, { color: c.textMuted }]} numberOfLines={1}>{fileName}</Text>

          <Row c={c} icon="paper-plane-outline" title="Bilgisayara gönder" desc="Dosyayı T-Bridge ile PC'ye aktarır." onPress={onSend} />
          {canPresent && (
            <Row c={c} icon="easel-outline" title="Bilgisayarda sun" desc="PC'de tam ekran açar; telefon kumanda olur." onPress={onPresent} />
          )}
          <TouchableOpacity style={styles.cancel} onPress={onClose} accessibilityRole="button">
            <Text style={[styles.cancelText, { color: c.textSecondary }]}>Vazgeç</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const Row: React.FC<{ c: ReturnType<typeof pick>; icon: React.ComponentProps<typeof Ionicons>['name']; title: string; desc: string; onPress: () => void }> = ({ c, icon, title, desc, onPress }) => (
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
    <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
  </TouchableOpacity>
);

const pick = (t: AppThemeMode) => Colors[t];

const styles = StyleSheet.create({
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
