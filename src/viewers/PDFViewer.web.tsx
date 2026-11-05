import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { FileInfo, AppThemeMode } from '../types';
import { Colors } from '../theme/colors';

interface PDFViewerProps { file: FileInfo; appTheme?: AppThemeMode; }

export const PDFViewer = ({ file, appTheme = 'emerald' }: PDFViewerProps) => {
  const c = Colors[appTheme] || Colors.emerald;
  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      {React.createElement('iframe', { title: file.name, src: file.uri, style: styles.frame, allow: 'fullscreen' })}
      <View style={[styles.bar, { backgroundColor: c.card, borderTopColor: c.border }]}>
        <Text style={[styles.text, { color: c.textSecondary }]}>PDF tarayıcı görüntüleyicisinde açıldı.</Text>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: c.primary }]}
          onPress={() => { Linking.openURL(file.uri).catch(() => undefined); }}
          accessibilityRole="link"
          accessibilityLabel="PDF'i yeni sekmede aç"
        >
          <Text style={styles.btnText}>Yeni sekmede aç</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  frame: { flex: 1, width: '100%', borderWidth: 0, backgroundColor: '#ffffff' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1 },
  text: { flex: 1, fontSize: 13 },
  btn: { minHeight: 44, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#0B0F19', fontSize: 13, fontWeight: '700' },
});
