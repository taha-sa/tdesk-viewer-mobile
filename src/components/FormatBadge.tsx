import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FileType, AppThemeMode } from '../types';
import { getFormatColors } from '../theme/colors';

interface FormatBadgeProps {
  type: FileType;
  extension?: string;
  size?: 'small' | 'medium' | 'large';
  /** Açık temada koyulaştırılmış rozet renkleri kullanılır. */
  theme?: AppThemeMode;
}

export const FormatBadge: React.FC<FormatBadgeProps> = ({
  type,
  extension,
  size = 'medium',
  theme,
}) => {
  const config = getFormatColors(type, theme === 'light');
  const label = (extension || type).toUpperCase();

  const isSmall = size === 'small';
  const isLarge = size === 'large';

  return (
    <View
      accessible
      accessibilityLabel={`${label} biçimi`}
      style={[
        styles.badge,
        { backgroundColor: config.bg },
        isSmall && styles.badgeSmall,
        isLarge && styles.badgeLarge,
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: config.text },
          isSmall && styles.labelSmall,
          isLarge && styles.labelLarge,
        ]}
      >
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  badgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeLarge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  labelSmall: {
    fontSize: 9,
  },
  labelLarge: {
    fontSize: 13,
  },
});
