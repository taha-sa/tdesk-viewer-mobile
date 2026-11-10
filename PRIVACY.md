# Gizlilik / Privacy / Datenschutz — T-Desk Viewer

TR · EN · DE


---

# GİZLİLİK POLİTİKASI (TR)

**Yürürlük Tarihi:** 10 Kasım 2026  
**Geliştirici:** taha (GitHub: [taha-sa](https://github.com/taha-sa))  
**Kapsam:** T-Suite yazılım ailesi (T-Bridge, T-Downloader, T-RamCash, T-DeskTree, T-Desk Viewer)

### 1. Temel İlke ve Veri Egemenliği
T-Suite açık kaynaklı, şeffaf ve yerel öncelikli (local-first) bir yazılım projesidir. **Hiçbir uzak sunucuya kişisel veri aktarılmaz; telemetri, analitik, reklam veya kullanıcı izleme mekanizmaları kesinlikle yer almaz.** Tüm verileriniz cihazınızda veya yerel ağınızda kalır.

### 2. Uygulama Bazlı İzinler ve Veri İşleme
* **T-Bridge (Windows & Android):** Cihazlar aynı yerel Wi-Fi ağında QUIC protokolü ile uçtan uca şifreli (E2EE) haberleşir. Bildirim yansıtma ve yanıtlama (Android Bildirim Erişimi), yerel dosya aktarımı, pano eşitleme, uzaktan masaüstü (ekran akışı yalnızca yerel ağda eşleşmiş telefona verilir) ve Windows 11 webcam işlevleri yalnızca eşleşmiş cihazlar arasında doğrudan çalışır; üçüncü taraflarla paylaşılmaz.
* **T-Downloader:** Windows istemcisi ve Chrome/Edge tarayıcı eklentisinden oluşur. Kimlik doğrulama gerektiren indirmelerde oturum çerezleri yalnızca yerel indirme isteği sırasında `yt-dlp` motoru tarafından kullanılır. Çerezler dışa aktarılmaz veya saklanmaz.
* **T-RamCash & T-DeskTree:** Tamamen yerel çalışan sistem yardımcı araçlarıdır. RAM ve disk meta verilerini sisteminizde yerel olarak işler; kaydetmez veya iletmez.
* **T-Desk Viewer:** Android üzerindeki belgeleri tamamen çevrimdışı görüntüler.

### 3. Ağ Erişimi Sınırları
Uygulamalar yalnızca aşağıdaki durumlarda ağa erişir:
1. GitHub üzerinden sürüm ve güncelleme kontrolü (`github.com`).
2. Kullanıcının T-Downloader üzerinden bizzat başlattığı indirme işlemleri.
3. T-Desk Viewer güncellemeleri için Expo güncelleme servisi.

### 4. Hata Raporlama (İsteğe Bağlı)
Bir çökme veya hata meydana geldiğinde otomatik rapor gönderilmez. Kullanıcı hata bildirmek isterse, kişisel verilerden arındırılmış ve maskelenmiş rapor metnini önceden inceler. Kullanıcı onay verirse rapor herkese açık GitHub Issue olarak oluşturulur; bu aşamadan itibaren GitHub'ın kendi Gizlilik Politikası geçerlidir.

### 5. Yasal Dayanak (KVKK & GDPR) ve Haklar
6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) ve AB Genel Veri Koruma Tüzüğü (GDPR) kapsamında veri sorumlusu sıfatıyla merkezi bir kişisel veri işleme faaliyeti yürütülmemektedir. Veriler kullanıcı kontrolündeki yerel ortamlardadır.

### 6. Çocukların Gizliliği ve İletişim
T-Suite 13 yaşın (veya yargı bölgesine göre ilgili yaş sınırının) altındaki çocuklara yönelik değildir. Soru ve bildirimleriniz için iletişim adresi:  
GitHub Issues / Discussions: [https://github.com/taha-sa](https://github.com/taha-sa)

---

# PRIVACY POLICY (EN)

**Effective Date:** November 10, 2026  
**Developer:** taha (GitHub: [taha-sa](https://github.com/taha-sa))  
**Scope:** T-Suite Application Family (T-Bridge, T-Downloader, T-RamCash, T-DeskTree, T-Desk Viewer)

### 1. Core Principle & Data Sovereignty
T-Suite is an open-source, local-first suite of tools. **No personal data is ever collected, transmitted to, or stored on external servers. There are zero tracking, analytics, telemetry, or advertising libraries.** All operational data remains strictly on your local devices.

### 2. Application Features & Local Processing
* **T-Bridge (Windows & Android):** Communicates strictly over the local Wi-Fi network using QUIC with end-to-end encryption (E2EE). Notification mirroring/replies (Android Notification Listener), file transfers, clipboard synchronization, remote desktop (screen stream transmitted exclusively to the paired phone on the LAN), and Windows 11 webcam emulation operate entirely peer-to-peer within your LAN.
* **T-Downloader:** Windows client + Chrome/Edge extension. Browser cookies are accessed strictly locally for authorized download requests via `yt-dlp`. Cookies are never transmitted off-device or stored externally.
* **T-RamCash & T-DeskTree:** Standalone system maintenance utilities that inspect RAM and local file system structures in memory only. No data is retained or transmitted.
* **T-Desk Viewer:** Offline Android document viewer processing files locally.

### 3. Limited Network Connections
Network connectivity is restricted strictly to:
1. Version checks and release downloads via GitHub (`github.com`).
2. Download requests initiated explicitly by the user.
3. Expo update delivery service for T-Desk Viewer.

### 4. Opt-in Crash Reports
No telemetry or silent crash reports exist. If an error occurs, users may optionally generate an issue report. The report is masked to remove personal identifiers and displayed for user review and approval before being submitted as a public GitHub Issue (subject to GitHub’s Privacy Policy).

### 5. Legal Compliance (GDPR & KVKK)
Under the EU General Data Protection Regulation (GDPR) and the Turkish Data Protection Law (KVKK No. 6698), no personal data is stored, aggregated, or profiled on central infrastructure by the developer.

### 6. Children's Privacy & Contact
T-Suite is not directed at children under the age of 13 (or local legal minimum age). For questions, inquiries, or feedback:  
GitHub Issues & Discussions: [https://github.com/taha-sa](https://github.com/taha-sa)

---

# DATENSCHUTZERKLÄRUNG (DE)

**Gültig ab:** 10. November 2026  
**Entwickler:** taha (GitHub: [taha-sa](https://github.com/taha-sa))  
**Geltungsbereich:** T-Suite Anwendungsfamilie (T-Bridge, T-Downloader, T-RamCash, T-DeskTree, T-Desk Viewer)

### 1. Grundprinzip und Datensparsamkeit
T-Suite ist eine quelloffene, lokale Software-Suite (Local-First). **Es werden keinerlei personenbezogene Daten an externe Server übermittelt. Es findet kein Tracking, keine Telemetrie und keine Analyse des Nutzerverhaltens statt.** Alle Daten verbleiben auf Ihren lokalen Geräten.

### 2. Funktionsbezogene Datenverarbeitung
* **T-Bridge (Windows & Android):** Verbindung ausschließlich im selben lokalen WLAN mittels Ende-zu-Ende-verschlüsseltem (E2EE) QUIC-Protokoll. Benachrichtigungsspiegelung & Direktantworten (Android-Benachrichtigungszugriff), Dateiübertragung, Zwischenablage-Abgleich, Remote-Desktop (Bildschirmübertragung ausschließlich an das gekoppelte Smartphone im lokalen Netz) sowie die Webcam-Funktion für Windows 11 verbleiben strikt im lokalen Netzwerk.
* **T-Downloader:** Windows-Anwendung + Chrome/Edge-Erweiterung. Browser-Cookies werden ausschließlich lokal für autorisierte Download-Anfragen über `yt-dlp` genutzt und weder weitergeleitet noch extern gespeichert.
* **T-RamCash & T-DeskTree:** Lokale Systemwerkzeuge zur temporären Arbeitsspeicher- und Speicherplatzanalyse. Es erfolgt keine Aufzeichnung oder Übertragung.
* **T-Desk Viewer:** Lokaler Android-Dokumentenbetrachter ohne Cloud-Anbindung.

### 3. Netzwerkzugriffe
Netzwerkverbindungen beschränken sich ausschließlich auf:
1. Versionsprüfung und Downloads von Updates über GitHub (`github.com`).
2. Vom Nutzer explizit gestartete Downloadvorgänge.
3. Den Expo-Aktualisierungsdienst für T-Desk Viewer.

### 4. Fehlerberichte (Opt-in)
Es gibt keine automatisierte Fehlerübermittlung. Sollte ein Fehler auftreten, kann der Nutzer freiwillig einen Fehlerbericht erstellen. Der Bericht wird anonymisiert/maskiert, dem Nutzer zur Prüfung angezeigt und erst nach ausdrücklicher Freigabe als öffentliches GitHub-Issue eingestellt (hierbei gilt die Datenschutzerklärung von GitHub).

### 5. DSGVO- & KVKK-Konformität
Gemäß der EU-Datenschutz-Grundverordnung (DSGVO) und dem türkischen Datenschutzgesetz (KVKK Nr. 6698) werden vom Entwickler keine personenbezogenen Daten serverseitig verarbeitet oder gespeichert.

### 6. Jugendschutz & Kontakt
Die Anwendungen richten sich nicht an Kinder unter 13 bzw. 16 Jahren. Für Fragen und Anliegen:  
GitHub Issues / Discussions: [https://github.com/taha-sa](https://github.com/taha-sa)
