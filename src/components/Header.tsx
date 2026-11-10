import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { THEME_OPTIONS, getThemeName } from '../theme/themeOptions';
import { AppThemeMode } from '../types';
import { t } from '../i18n';

interface HeaderProps {
  subtitle?: string;
  theme?: AppThemeMode;
  onSearchPress?: () => void;
  onThemePress?: () => void;
  onInfoPress?: () => void;
}

const HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 };

export const Header: React.FC<HeaderProps> = ({
  subtitle = t('header.subtitle'),
  theme = 'emerald',
  onSearchPress,
  onThemePress,
  onInfoPress,
}) => {
  const currentColors = Colors[theme] || Colors.emerald;
  const themeName = getThemeName(theme);
  const themeIcon = (THEME_OPTIONS.find(t => t.id === theme)?.icon || 'color-palette') as React.ComponentProps<typeof Ionicons>['name'];
  const btn = [styles.iconButton, { backgroundColor: currentColors.card, borderColor: currentColors.border }];

  return (
    <View style={[styles.container, { backgroundColor: currentColors.background, borderBottomColor: currentColors.border }]}>
      <View style={styles.topRow}>
        <View style={styles.brandContainer} accessible accessibilityRole="header" accessibilityLabel={`T-Desk. ${subtitle}`}>
          {/* T/ Orijinal Logo */}
          <View style={[styles.logoSquircle, { backgroundColor: currentColors.primary, borderColor: currentColors.primary }]}>
            <Text style={[styles.logoText, { color: currentColors.onPrimary }]}>T/</Text>
          </View>
          <View style={styles.brandText}>
            <Text style={[styles.title, { color: currentColors.text }]}>T-DESK</Text>
            <Text style={[styles.subtitle, { color: currentColors.textSecondary }]} numberOfLines={1}>{subtitle}</Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          {onSearchPress && (
            <TouchableOpacity
              style={btn}
              onPress={onSearchPress}
              activeOpacity={0.7}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={t('header.searchA11y')}
            >
              <Ionicons name="search" size={18} color={currentColors.text} />
            </TouchableOpacity>
          )}

          {onInfoPress && (
            <TouchableOpacity
              style={btn}
              onPress={onInfoPress}
              activeOpacity={0.7}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={t('common.about')}
            >
              <Ionicons name="information-circle-outline" size={20} color={currentColors.text} />
            </TouchableOpacity>
          )}

          {onThemePress && (
            <TouchableOpacity
              style={btn}
              onPress={onThemePress}
              activeOpacity={0.7}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={t('header.themeA11y', { theme: themeName })}
            >
              <Ionicons name={themeIcon} size={18} color={currentColors.primary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  brandText: {
    flexShrink: 1,
  },
  logoSquircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    borderWidth: 1,
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.5,
    fontFamily: 'monospace',
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  subtitle: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
});
