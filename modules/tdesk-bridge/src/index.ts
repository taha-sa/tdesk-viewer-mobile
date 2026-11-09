import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

/** T-Bridge kanalından dönen sonuç (olay). */
export interface BridgeResult {
  ok: boolean;
  /** Kullanıcıya gösterilebilir Türkçe metin (boş olabilir). */
  message: string;
  /** T-Bridge şu an bilgisayara bağlı mı. */
  connected: boolean;
}

export type PresentKey = 'next' | 'prev' | 'end';

interface TDeskBridgeNative {
  isPackageInstalled(pkg: string): boolean;
  sendToBridge(uri: string): Promise<void>;
  present(uri: string): Promise<void>;
  presentKey(key: PresentKey): Promise<void>;
  addListener(event: 'onBridgeResult', cb: (r: BridgeResult) => void): { remove(): void };
}

/** Yerel modül yalnızca Android derlemelerinde vardır (Expo Go/web/iOS'ta null). */
let native: TDeskBridgeNative | null = null;
if (Platform.OS === 'android') {
  try { native = requireNativeModule<TDeskBridgeNative>('TDeskBridge'); } catch { native = null; }
}

export const BRIDGE_PACKAGE = 'app.kopru';

const MISSING = () => Promise.reject(new Error('T-Bridge köprüsü bu derlemede yok'));

export const TDeskBridge = {
  /** Modül kullanılabilir mi (Android + yerel derleme). */
  available: native !== null,
  isPackageInstalled(pkg: string): boolean {
    try { return native ? native.isPackageInstalled(pkg) : false; } catch { return false; }
  },
  /** content:// veya file:// dosyayı T-Bridge'in "Bilgisayara gönder" hedefine gönderir. */
  sendToBridge(uri: string): Promise<void> {
    return native ? native.sendToBridge(uri) : MISSING();
  },
  /** Dosyayı PC'ye gönderir ve orada tam ekran sunum olarak açtırır. */
  present(uri: string): Promise<void> {
    return native ? native.present(uri) : MISSING();
  },
  presentKey(key: PresentKey): Promise<void> {
    return native ? native.presentKey(key) : MISSING();
  },
  onResult(cb: (r: BridgeResult) => void): { remove(): void } {
    return native ? native.addListener('onBridgeResult', cb) : { remove() {} };
  },
};
