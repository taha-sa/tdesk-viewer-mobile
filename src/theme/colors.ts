import type { AppThemeMode } from '../types';

/** Her tema paletinin sahip olması gereken tokenlar (derleyici anahtar tutarlılığını garanti eder). */
export interface ThemeColors {
  background: string;
  card: string;
  cardBorder: string;
  surface: string;
  surfaceLight: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryGlow: string;
  primaryDark: string;
  /** primary üzerindeki metin/ikon rengi */
  onPrimary: string;
  secondary: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  border: string;
  tabBar: string;
  tabBarBorder: string;
  tabActive: string;
  tabInactive: string;
}

export const Colors: Record<AppThemeMode, ThemeColors> = {
  emerald: {
    background: '#090D14',
    card: '#121824',
    cardBorder: '#1E2638',
    surface: '#161F30',
    surfaceLight: '#202B40',
    text: '#F8FAFC',
    textSecondary: '#94A3B8',
    textMuted: '#7B889C',
    primary: '#10B981', 
    primaryGlow: 'rgba(16, 185, 129, 0.12)',
    primaryDark: '#059669',
    onPrimary: '#07131B', // primary üzerindeki metin/ikon
    secondary: '#1E4D40',
    accent: '#34D399',
    success: '#10B981',
    warning: '#F59E0B',
    danger: '#EF4444',
    border: '#1E2638',
    tabBar: '#0C111C',
    tabBarBorder: '#1A2234',
    tabActive: '#10B981',
    tabInactive: '#718096',
  },
  light: {
    background: '#F8FAFC',
    card: '#FFFFFF',
    cardBorder: '#E2E8F0',
    surface: '#F1F5F9',
    surfaceLight: '#E2E8F0',
    text: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#5E6E84',
    primary: '#1E4D40', 
    primaryGlow: 'rgba(30, 77, 64, 0.08)',
    primaryDark: '#14352B',
    onPrimary: '#FFFFFF', // primary üzerindeki metin/ikon
    secondary: '#10B981',
    accent: '#047857',
    success: '#047857',
    warning: '#B45309',
    danger: '#DC2626',
    border: '#E2E8F0',
    tabBar: '#FFFFFF',
    tabBarBorder: '#E2E8F0',
    tabActive: '#1E4D40',
    tabInactive: '#64748B',
  },
  dark: {
    background: '#0B0F17',
    card: '#131A26',
    cardBorder: '#1E293B',
    surface: '#1A2332',
    surfaceLight: '#243044',
    text: '#F8FAFC',
    textSecondary: '#94A3B8',
    textMuted: '#808DA1',
    primary: '#38BDF8',
    primaryGlow: 'rgba(56, 189, 248, 0.12)',
    primaryDark: '#0284C7',
    onPrimary: '#07131B', // primary üzerindeki metin/ikon
    secondary: '#818CF8',
    accent: '#38BDF8',
    success: '#10B981',
    warning: '#F59E0B',
    danger: '#EF4444',
    border: '#1E293B',
    tabBar: '#0E1420',
    tabBarBorder: '#1E293B',
    tabActive: '#38BDF8',
    tabInactive: '#718096',
  },
  oled: {
    background: '#000000',
    card: '#0D0D0D',
    cardBorder: '#1A1A1A',
    surface: '#141414',
    surfaceLight: '#202020',
    text: '#FFFFFF',
    textSecondary: '#A0A0A0',
    textMuted: '#7E7E7E',
    primary: '#10B981',
    primaryGlow: 'rgba(16, 185, 129, 0.12)',
    primaryDark: '#059669',
    onPrimary: '#07131B', // primary üzerindeki metin/ikon
    secondary: '#1E4D40',
    accent: '#34D399',
    success: '#10B981',
    warning: '#F59E0B',
    danger: '#EF4444',
    border: '#1A1A1A',
    tabBar: '#000000',
    tabBarBorder: '#141414',
    tabActive: '#10B981',
    tabInactive: '#757575',
  },
  purple: {
    background: '#0B0715',
    card: '#140D26',
    cardBorder: '#291845',
    surface: '#1A1032',
    surfaceLight: '#2E1A55',
    text: '#FDFBFF',
    textSecondary: '#F472B6',
    textMuted: '#9063F6',
    primary: '#D946EF',
    primaryGlow: 'rgba(217, 70, 239, 0.25)',
    primaryDark: '#C026D3',
    onPrimary: '#07131B', // primary üzerindeki metin/ikon
    secondary: '#38BDF8',
    accent: '#06B6D4',
    success: '#10B981',
    warning: '#FBBF24',
    danger: '#F43F5E',
    border: '#291845',
    tabBar: '#0A0614',
    tabBarBorder: '#291845',
    tabActive: '#D946EF',
    tabInactive: '#905CE2',
  },
  ocean: {
    background: '#041221',
    card: '#091C31',
    cardBorder: '#0F2C4C',
    surface: '#0B233C',
    surfaceLight: '#113559',
    text: '#F8FAFC',
    textSecondary: '#7DD3FC',
    textMuted: '#38BDF8',
    primary: '#0EA5E9',
    primaryGlow: 'rgba(14, 165, 233, 0.15)',
    primaryDark: '#0369A1',
    onPrimary: '#07131B', // primary üzerindeki metin/ikon
    secondary: '#075985',
    accent: '#38BDF8',
    success: '#10B981',
    warning: '#F59E0B',
    danger: '#EF4444',
    border: '#0F2C4C',
    tabBar: '#06172A',
    tabBarBorder: '#0F2C4C',
    tabActive: '#0EA5E9',
    tabInactive: '#0786C8',
  }
};

export const FormatColors: Record<string, { bg: string; text: string; icon: string }> = {
  pdf: { bg: 'rgba(239, 68, 68, 0.10)', text: '#F04F4F', icon: 'file-text' },
  code: { bg: 'rgba(16, 185, 129, 0.10)', text: '#10B981', icon: 'code' },
  markdown: { bg: 'rgba(168, 85, 247, 0.10)', text: '#B166F8', icon: 'edit-3' },
  spreadsheet: { bg: 'rgba(14, 165, 233, 0.10)', text: '#0EA5E9', icon: 'grid' },
  docx: { bg: 'rgba(59, 130, 246, 0.10)', text: '#478AF7', icon: 'file-text' },
  pptx: { bg: 'rgba(249, 115, 22, 0.10)', text: '#F97316', icon: 'monitor' },
  epub: { bg: 'rgba(139, 92, 246, 0.10)', text: '#9A71F7', icon: 'book-open' },
  text: { bg: 'rgba(148, 163, 184, 0.10)', text: '#94A3B8', icon: 'align-left' },
  image: { bg: 'rgba(236, 72, 153, 0.10)', text: '#EC4C9B', icon: 'image' },
  archive: { bg: 'rgba(245, 158, 11, 0.10)', text: '#F59E0B', icon: 'archive' },
  unknown: { bg: 'rgba(100, 116, 139, 0.10)', text: '#7E8C9F', icon: 'file' },
};

// Açık tema kartında (beyaz) AA kontrast için koyulaştırılmış varyant; koyu temalar FormatColors'u kullanır.
export const FormatColorsLight: Record<string, { bg: string; text: string; icon: string }> = {
  pdf: { bg: 'rgba(239, 68, 68, 0.10)', text: '#C63838', icon: 'file-text' },
  code: { bg: 'rgba(16, 185, 129, 0.10)', text: '#0B7E58', icon: 'code' },
  markdown: { bg: 'rgba(168, 85, 247, 0.10)', text: '#9049D4', icon: 'edit-3' },
  spreadsheet: { bg: 'rgba(14, 165, 233, 0.10)', text: '#0A77A8', icon: 'grid' },
  docx: { bg: 'rgba(59, 130, 246, 0.10)', text: '#316CCC', icon: 'file-text' },
  pptx: { bg: 'rgba(249, 115, 22, 0.10)', text: '#B35310', icon: 'monitor' },
  epub: { bg: 'rgba(139, 92, 246, 0.10)', text: '#7C52DB', icon: 'book-open' },
  text: { bg: 'rgba(148, 163, 184, 0.10)', text: '#66707F', icon: 'align-left' },
  image: { bg: 'rgba(236, 72, 153, 0.10)', text: '#BF3A7C', icon: 'image' },
  archive: { bg: 'rgba(245, 158, 11, 0.10)', text: '#9D6507', icon: 'archive' },
  unknown: { bg: 'rgba(100, 116, 139, 0.10)', text: '#606F85', icon: 'file' },
};

/** Temaya uygun rozet renkleri (açık tema için koyu tonlar, diğerleri için açık tonlar). */
export function getFormatColors(type: string, isLight: boolean): { bg: string; text: string; icon: string } {
  const map = isLight ? FormatColorsLight : FormatColors;
  return map[type] || map.unknown;
}
