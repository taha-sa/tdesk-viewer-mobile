# CI / Yayın otomasyonu

Workflow'lar: `ci.yml` (her push/PR: tsc, i18n, test, lisans denetimi), `ota.yml` (OTA), `release.yml` (etiketli native yayın).

`npm test`, EAS dışlama kurallarının `modules/tdesk-bridge/android` kaynaklarını koruduğunu ve Expo'nun `TDeskBridgeModule` sınıfını gerçekten autolink ettiğini de denetler. Üretilen kök Android projesi yalnız `/android/` kuralıyla dışlanır; `android/` gibi köksüz bir kural yerel modülü de paketten çıkarır. Native sürüm tesliminde APK içeriği ayrıca kontrol edilmelidir; başarılı bir EAS işi tek başına modülün APK'da bulunduğunu kanıtlamaz.

## Secrets
- `EXPO_TOKEN`: expo.dev hesabı erişim token'ı (EAS build/update).
- `RELEASE_TOKEN`: `taha-sa/tdesk-viewer-releases` deposunda release oluşturma yetkili GitHub PAT (contents: write).
İmza/keystore EAS'ta kalır; depoda tutulmaz.

## Environment
Settings > Environments > `release` oluşturun; "Required reviewers" ekleyin (onay) ve secret'ları bu environment'a koyun.

## OTA mı, etiketli sürüm mü?
- **OTA** (`release/*` dalına push veya Actions > OTA update > Run): yalnızca JS/asset değişiklikleri. `scripts/check-js-only.js` son `v*` etiketinden beri android/, modules/*/android, plugins/, eas.json, app.json (extra/updates hariç; `version` dahil, çünkü runtimeVersion=appVersion) veya native bağımlılık değişimini yakalarsa job fail olur.
- **Etiketli sürüm** (`git tag vX.Y.Z && git push --tags`): native değişiklik veya yeni sürüm. `app.json` `expo.version` önce artırılmalı; etiket uygulamadaki sürümden büyük olmalı. APK `tdesk-viewer-X.Y.Z.apk` adıyla `v` etiketli release'e eklenir (uygulama içi güncelleyici `.apk` uzantılı asset arar).
