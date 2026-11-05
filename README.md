# T-Desk Viewer (mobil)

PDF, DOCX, XLSX/CSV, PPTX, EPUB, Markdown, kod/metin, görsel ve ZIP dosyalarını açan Expo / React Native (Android öncelikli) dosya görüntüleyici.

> Bu depo yalnızca **T-Desk Viewer mobil uygulamasına** aittir. (tdesk.com ve diğer projelerle ilgisi yoktur.)

## Geliştirme

```bash
npm install
npx expo start          # PDF için geliştirme derlemesi (dev client / EAS build) gerekir; Expo Go'da PDF motoru yoktur
npx tsc --noEmit        # tür denetimi
```

## Uygulama içi güncelleme

Uygulama, ayrı ve herkese açık **taha-sa/tdesk-viewer-releases** deposunun GitHub Releases bölümünü denetler (kaynak kod bu özel depoda kalır; o depoda yalnızca APK dosyaları bulunur) (Ayarlar → Güncelleme ve açılışta günde bir kez).
Yeni sürüm varsa release'e eklenmiş `.apk` indirme bağlantısını açar.

### Yeni sürüm yayınlama

1. `app.json` içinde `expo.version` değerini artırın (ör. `1.0.1`). Etiket, uygulamadaki sürümden **büyük** olmalıdır.
2. APK üretin (aynı imza anahtarıyla — EAS'ın kayıtlı keystore'u; farklı anahtarla üretilen APK mevcut uygulamanın üstüne kurulmaz):
   ```bash
   npx eas build -p android --profile preview
   ```
3. İndirdiğiniz APK'yı release olarak yükleyin (etiket `v` + sürüm):
   ```bash
   gh release create v1.0.1 tdesk-viewer-1.0.1.apk --repo taha-sa/tdesk-viewer-releases --title "v1.0.1" --notes "Yenilikler: ..."
   ```
4. Kullanıcılar uygulamayı açtığında (veya Ayarlar'dan denetlediğinde) güncelleme önerisi görür.

Notlar: taslak (draft) ve ön sürüm (pre-release) release'leri dikkate alınmaz. Güncelleme yalnızca `github.com/taha-sa/tdesk-viewer-releases/releases/` adreslerini açar. iOS'ta APK yoktur; yayın sayfası açılır.
