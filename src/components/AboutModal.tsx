import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Modal, TouchableOpacity, Linking, ScrollView, Animated, Alert, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppThemeMode } from '../types';
import { Colors } from '../theme/colors';
import { APP_DISPLAY_NAME, getOpenSource, getAppVersion } from '../utils/appInfo';
import { t } from '../i18n';

interface AboutModalProps {
  visible: boolean;
  theme: AppThemeMode;
  onClose: () => void;
}

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };
const ANIM_MS = 180;

export const AboutModal: React.FC<AboutModalProps> = ({ visible, theme, onClose }) => {
  const currentColors = Colors[theme] || Colors.emerald;
  // Kapanış animasyonu bitene kadar Modal açık kalır (return null animasyonu keserdi).
  const [mounted, setMounted] = useState(visible);
  const anim = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(anim, { toValue: 1, duration: ANIM_MS, useNativeDriver: true }).start();
    } else {
      Animated.timing(anim, { toValue: 0, duration: ANIM_MS, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    return () => anim.stopAnimation();
  }, [visible, anim]);

  const openLink = async (url: string, what: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('about.openFailTitle'), t('about.openFailBody', { what }));
    }
  };

  if (!mounted && !visible) return null;

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.overlay, { opacity: anim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Kapat" accessibilityRole="button" />
        <Animated.View
          style={[styles.modalContent, { backgroundColor: currentColors.background, borderColor: currentColors.border, transform: [{ translateY }] }]}
          accessibilityViewIsModal
        >
          <View style={styles.header}>
            <Image source={require('../../assets/family/t-desk-viewer.png')} style={styles.logoImage} accessibilityIgnoresInvertColors />
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: currentColors.text }]} accessibilityRole="header">{APP_DISPLAY_NAME}</Text>
              <Text style={[styles.version, { color: currentColors.primary }]}>{t('settings.version', { version: getAppVersion() })}</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={t('about.closeA11y')}
            >
              <Ionicons name="close" size={24} color={currentColors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            <Text style={[styles.desc, { color: currentColors.textSecondary }]}>
              {t('about.desc')}
            </Text>

            <View style={styles.contactSection}>
              <Text style={[styles.sectionTitle, { color: currentColors.textMuted }]}>{t('about.sectionContact')}</Text>

              <TouchableOpacity
                style={[styles.contactCard, { backgroundColor: currentColors.surface, borderColor: currentColors.border }]}
                onPress={() => openLink('mailto:t-desk@outlook.com.tr', t('about.emailApp'))}
                accessibilityRole="link"
                accessibilityLabel={t('about.emailA11y')}
              >
                <View style={[styles.iconBox, { backgroundColor: 'rgba(59, 130, 246, 0.1)' }]}>
                  <Ionicons name="mail-outline" size={20} color="#3B82F6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.contactLabel, { color: currentColors.textSecondary }]}>{t('about.emailLabel')}</Text>
                  <Text style={[styles.contactValue, { color: currentColors.text }]}>t-desk@outlook.com.tr</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={currentColors.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.contactCard, { backgroundColor: currentColors.surface, borderColor: currentColors.border }]}
                onPress={() => openLink('https://instagram.com/tdesk.studio', t('about.instagramPage'))}
                accessibilityRole="link"
                accessibilityLabel={t('about.instagramA11y')}
              >
                <View style={[styles.iconBox, { backgroundColor: 'rgba(236, 72, 153, 0.1)' }]}>
                  <Ionicons name="logo-instagram" size={20} color="#EC4899" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.contactLabel, { color: currentColors.textSecondary }]}>Instagram</Text>
                  <Text style={[styles.contactValue, { color: currentColors.text }]}>tdesk.studio</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={currentColors.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.contactSection}>
              <Text style={[styles.sectionTitle, { color: currentColors.textMuted }]}>{t('about.sectionOss')}</Text>
              <Text style={[styles.ossIntro, { color: currentColors.textSecondary }]}>
                {t('about.ossIntro')}
              </Text>
              <View style={[styles.ossBox, { backgroundColor: currentColors.surface, borderColor: currentColors.border }]}>
                {getOpenSource().map((o, i) => (
                  <View
                    key={o.name}
                    style={[styles.ossRow, i > 0 && { borderTopWidth: 1, borderTopColor: currentColors.border }]}
                    accessible
                    accessibilityLabel={t('about.ossA11y', { name: o.name, license: o.license, use: o.use })}
                  >
                    <Text style={[styles.ossName, { color: currentColors.text }]}>{o.name}</Text>
                    <Text style={[styles.ossMeta, { color: currentColors.textSecondary }]}>{o.license} · {o.use}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.signatureBox}>
              <Text style={[styles.signatureLabel, { color: currentColors.textMuted }]}>{t('about.developedBy')}</Text>
              <Text style={[styles.signatureName, { color: currentColors.primary }]}>Taha Şaprak</Text>
            </View>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '90%',
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 16,
  },
  logoSquircle: {
    width: 54,
    height: 54,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  logoImage: { width: 54, height: 54, borderRadius: 16 },
  logoText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -1,
    fontFamily: 'monospace',
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  version: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    gap: 24,
    paddingBottom: 4,
  },
  desc: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  contactSection: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 4,
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  contactValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  ossIntro: { fontSize: 12, lineHeight: 17 },
  ossBox: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  ossRow: { paddingHorizontal: 12, paddingVertical: 9 },
  ossName: { fontSize: 13, fontWeight: '700' },
  ossMeta: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  signatureBox: {
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(150,150,150,0.2)',
  },
  signatureLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 2,
    marginBottom: 8,
  },
  signatureName: {
    fontSize: 32,
    fontWeight: '400',
    fontStyle: 'italic',
    fontFamily: 'serif',
    letterSpacing: 1,
  },
});
