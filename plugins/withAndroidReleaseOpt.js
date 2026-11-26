// Android release derleme optimizasyonu:
// - Yalnızca 64-bit arm64-v8a mimarisi (x86/x86_64/armeabi-v7a atılır, APK ~%45-55 küçülür).
// - R8 / ProGuard küçültme + shrinkResources (kullanılmayan Java/Kotlin kodu ve kaynaklar temizlenir).
// - TDeskBridgeModule, Expo modülleri, react-native-pdf/Pdfium, WebView ve SVG için güvenli R8 koruma kuralları.
const fs = require('node:fs');
const path = require('node:path');
const { withGradleProperties, withDangerousMod } = require('@expo/config-plugins');

const MARKER_START = '# --- tdesk-release-opt:start ---';
const MARKER_END = '# --- tdesk-release-opt:end ---';

const PROGUARD_RULES = `${MARKER_START}
# T-Desk native bridge and Expo module autolinking
-keep class expo.modules.tdeskbridge.** { *; }
-keep class expo.modules.** { *; }

# react-native-pdf / Pdfium JNI / react-native-blob-util
-keep class org.wonday.pdf.** { *; }
-keep class com.github.barteksc.pdfviewer.** { *; }
-keep class com.shockwave.pdfium.** { *; }
-keep class com.ReactNativeBlobUtil.** { *; }
-dontwarn org.wonday.pdf.**
-dontwarn com.github.barteksc.pdfviewer.**
-dontwarn com.shockwave.pdfium.**

# WebView, SVG, Gesture Handler, Screens, Hermes/JNI
-keep class com.reactnativecommunity.webview.** { *; }
-keep class com.horcrux.svg.** { *; }
-keep class com.swmansion.gesturehandler.** { *; }
-keep class com.swmansion.rnscreens.** { *; }
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }
${MARKER_END}`;

function setGradleProp(props, key, value) {
  const existing = props.find((item) => item.type === 'property' && item.key === key);
  if (existing) {
    existing.value = value;
  } else {
    props.push({ type: 'property', key, value });
  }
}

module.exports = function withAndroidReleaseOpt(config) {
  config = withGradleProperties(config, (cfg) => {
    setGradleProp(cfg.modResults, 'reactNativeArchitectures', 'arm64-v8a');
    setGradleProp(cfg.modResults, 'android.enableProguardInReleaseBuilds', 'true');
    setGradleProp(cfg.modResults, 'android.enableShrinkResourcesInReleaseBuilds', 'true');
    return cfg;
  });

  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const proguardPath = path.join(cfg.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      if (fs.existsSync(proguardPath)) {
        const current = fs.readFileSync(proguardPath, 'utf8');
        const re = new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}`, 'm');
        const updated = re.test(current)
          ? current.replace(re, PROGUARD_RULES)
          : `${current.trimEnd()}\n\n${PROGUARD_RULES}\n`;
        fs.writeFileSync(proguardPath, updated, 'utf8');
      }
      return cfg;
    },
  ]);

  return config;
};
