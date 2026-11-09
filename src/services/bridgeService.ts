// T-Bridge (PC ile telefon eşleme uygulaması) entegrasyonu: "Bilgisayara gönder" ve "Bilgisayarda sun".
// Yalnızca T-Bridge (app.kopru) kuruluysa kullanılır; yerel modül yoksa (Expo Go/web/iOS) her şey sessizce kapalıdır.
import { Platform } from 'react-native';
import { TDeskBridge, BRIDGE_PACKAGE, BridgeResult, PresentKey } from '../../modules/tdesk-bridge/src';
import { FileService } from './fileService';
import type { FileInfo } from '../types';

export type { BridgeResult, PresentKey };

/** Sunum olarak PC'ye gönderilebilen türler. */
export function canPresent(file: FileInfo): boolean {
  return file.category === 'pdf' || file.category === 'pptx';
}

/** Dosya PC'ye gönderilebilir mi (sanal/arşiv içi ve örnek olmayan kopyalanabilir dosyalar). */
export function canSendToPc(file: FileInfo): boolean {
  return !file.virtual;
}

export function isBridgeInstalled(): boolean {
  return Platform.OS === 'android' && TDeskBridge.available && TDeskBridge.isPackageInstalled(BRIDGE_PACKAGE);
}

/** Dosyayı T-Bridge'in "Bilgisayara gönder" paylaşım hedefine verir. Hata metni (Türkçe) ya da null (başarılı). */
export async function sendToPc(file: FileInfo): Promise<string | null> {
  try {
    const copy = await FileService.exportCopy(file);
    if (!copy) return 'Bu dosya gönderilemiyor.';
    await TDeskBridge.sendToBridge(copy);
    return null;
  } catch (e: any) {
    return friendly(e);
  }
}

/** Dosyayı PC'ye gönderir ve orada sunum olarak açtırır. Hata metni ya da null. */
export async function presentOnPc(file: FileInfo): Promise<string | null> {
  try {
    const copy = await FileService.exportCopy(file);
    if (!copy) return 'Bu dosya gönderilemiyor.';
    await TDeskBridge.present(copy);
    return null;
  } catch (e: any) {
    return friendly(e);
  }
}

export async function sendPresentKey(key: PresentKey): Promise<string | null> {
  try {
    await TDeskBridge.presentKey(key);
    return null;
  } catch (e: any) {
    return friendly(e);
  }
}

export function onBridgeResult(cb: (r: BridgeResult) => void): { remove(): void } {
  return TDeskBridge.onResult(cb);
}

function friendly(e: any): string {
  const code = String(e?.code || '');
  if (code === 'ERR_NO_BRIDGE') return 'T-Bridge kurulu değil.';
  if (code === 'ERR_BRIDGE_UNAVAILABLE') return 'T-Bridge\'e bağlanılamadı. Uygulamayı bir kez açıp tekrar deneyin.';
  return 'T-Bridge ile iletişim kurulamadı.';
}
