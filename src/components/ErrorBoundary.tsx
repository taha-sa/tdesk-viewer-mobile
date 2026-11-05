import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppThemeMode } from '../types';
import { Colors } from '../theme/colors';

interface Props {
  children: React.ReactNode;
  /** Değişince hata durumu sıfırlanır (örn. başka dosya/sekme). */
  resetKey?: string;
  appTheme?: AppThemeMode;
  /** Verilirse "Geri dön" düğmesi gösterilir (iOS'ta donanım geri tuşu yoktur). */
  onBack?: () => void;
  backLabel?: string;
  title?: string;
  description?: string;
  logTag?: string;
}
interface State { hasError: boolean; message: string; }

const DEFAULT_TITLE = 'Bu ekran görüntülenemedi';
const DEFAULT_DESCRIPTION = 'Dosya bozuk, desteklenmiyor veya cihaz belleği yetersiz olabilir.';

/**
 * Hem uygulama kökünde hem görüntüleyici alanında kullanılan tek hata sınırı
 * (ViewerErrorBoundary yalnızca metinleri farklı ince bir sarmalayıcıdır).
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    const msg = error instanceof Error && error.message ? error.message : typeof error === 'string' ? error : '';
    return { hasError: true, message: msg || 'Bilinmeyen hata' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${this.props.logTag || 'T-DESK-ERROR'}]`, error, info.componentStack);
  }

  componentDidUpdate(previousProps: Props) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.reset();
    }
  }

  reset = () => this.setState({ hasError: false, message: '' });

  render() {
    if (!this.state.hasError) return this.props.children;
    const c = Colors[this.props.appTheme || 'emerald'] || Colors.emerald;
    const { onBack, backLabel, title, description } = this.props;
    return (
      <View style={[styles.container, { backgroundColor: c.background }]} accessibilityRole="alert">
        <Ionicons name="warning-outline" size={52} color={c.warning} />
        <Text style={[styles.title, { color: c.text }]}>{title || DEFAULT_TITLE}</Text>
        <Text style={[styles.description, { color: c.textSecondary }]}>{description || DEFAULT_DESCRIPTION}</Text>
        <Text style={[styles.technical, { color: c.textMuted }]} numberOfLines={4} selectable>
          {this.state.message}
        </Text>
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.secondary, { borderColor: c.border }]}
            onPress={this.reset}
            accessibilityRole="button"
            accessibilityLabel="Tekrar dene"
          >
            <Text style={[styles.secondaryText, { color: c.text }]}>Tekrar dene</Text>
          </TouchableOpacity>
          {onBack ? (
            <TouchableOpacity
              style={[styles.primary, { backgroundColor: c.primary }]}
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel={backLabel || 'Geri dön'}
            >
              <Text style={[styles.primaryText, { color: c.onPrimary }]}>{backLabel || 'Geri dön'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  title: { fontSize: 20, fontWeight: '800', marginTop: 18, textAlign: 'center' },
  description: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10, maxWidth: 340 },
  technical: { fontSize: 11, textAlign: 'center', marginTop: 14, maxWidth: 340 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 24 },
  primary: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 10 },
  primaryText: { fontWeight: '800' },
  secondary: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 10, borderWidth: 1 },
  secondaryText: { fontWeight: '700' },
});
