import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import { t } from '../i18n';
import { MIT_LICENSE_TEXT } from '../legal/license';
import licenses from '../data/licenses.json';

export type LegalKind = 'privacy' | 'disclaimer' | 'license' | 'oss';

interface Props {
  kind: LegalKind | null;
  appTheme: AppThemeMode;
  onClose: () => void;
}

interface LicenseItem { name: string; version: string; license: string }
const LICENSES = licenses as LicenseItem[];

/** Metindeki basit Markdown'ı (kalın, bağlantı, kod) düz metne çevirir. */
function inline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+$/, '');
}

type Block = { type: 'h' | 'p' | 'li'; text: string };

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('### ')) blocks.push({ type: 'h', text: inline(line.slice(4)) });
    else if (/^[*-]\s+/.test(line)) blocks.push({ type: 'li', text: inline(line.replace(/^[*-]\s+/, '')) });
    else if (/^\d+\.\s+/.test(line)) blocks.push({ type: 'li', text: inline(line) });
    else blocks.push({ type: 'p', text: inline(line) });
  }
  return blocks;
}

export const LegalModal: React.FC<Props> = ({ kind, appTheme, onClose }) => {
  const c = Colors[appTheme] || Colors.dark;
  const title =
    kind === 'privacy' ? t('legal.privacyTitle')
    : kind === 'disclaimer' ? t('legal.disclaimerTitle')
    : kind === 'license' ? t('legal.licenseTitle')
    : t('legal.ossTitle');

  const blocks = useMemo(
    () => (kind === 'privacy' ? parseBlocks(t('legal.privacy')) : kind === 'disclaimer' ? parseBlocks(t('legal.disclaimer')) : []),
    [kind],
  );

  return (
    <Modal visible={kind !== null} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text style={[styles.title, { color: c.text }]} accessibilityRole="header" numberOfLines={1}>{title}</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Ionicons name="close" size={24} color={c.text} />
          </TouchableOpacity>
        </View>

        {kind === 'oss' ? (
          <FlatList
            data={LICENSES}
            keyExtractor={(it) => it.name + '@' + it.version}
            contentContainerStyle={styles.body}
            ListHeaderComponent={
              <Text style={[styles.p, { color: c.textSecondary, marginBottom: 8 }]}>
                {LICENSES.length ? t('aboutApp.ossIntro', { count: LICENSES.length }) : t('aboutApp.ossEmpty')}
              </Text>
            }
            initialNumToRender={30}
            windowSize={9}
            renderItem={({ item, index }) => (
              <View
                style={[styles.ossRow, index > 0 && { borderTopWidth: 1, borderTopColor: c.border }]}
                accessible
                accessibilityLabel={t('aboutApp.ossRowA11y', { name: item.name, version: item.version, license: item.license })}
              >
                <Text style={[styles.ossName, { color: c.text }]} numberOfLines={1}>{item.name}</Text>
                <Text style={[styles.ossMeta, { color: c.textSecondary }]}>{item.version} · {item.license}</Text>
              </View>
            )}
          />
        ) : (
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator>
            {kind === 'license' ? (
              <Text style={[styles.mono, { color: c.text }]} selectable>{MIT_LICENSE_TEXT}</Text>
            ) : (
              blocks.map((b, i) =>
                b.type === 'h' ? (
                  <Text key={i} style={[styles.h, { color: c.primary }]} accessibilityRole="header">{b.text}</Text>
                ) : b.type === 'li' ? (
                  <View key={i} style={styles.liRow}>
                    <Text style={[styles.p, { color: c.textMuted }]}>•</Text>
                    <Text style={[styles.p, styles.liText, { color: c.textSecondary }]}>{b.text}</Text>
                  </View>
                ) : (
                  <Text key={i} style={[styles.p, { color: c.textSecondary }]}>{b.text}</Text>
                ),
              )
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 56, borderBottomWidth: 1, gap: 12 },
  title: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, gap: 12 },
  h: { fontSize: 14, lineHeight: 20, fontWeight: '700', marginTop: 8 },
  p: { fontSize: 13, lineHeight: 19 },
  liRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  liText: { flex: 1 },
  mono: { fontSize: 12, lineHeight: 18, fontFamily: 'monospace' },
  ossRow: { paddingVertical: 8 },
  ossName: { fontSize: 13, fontWeight: '600' },
  ossMeta: { fontSize: 11, marginTop: 2 },
});
