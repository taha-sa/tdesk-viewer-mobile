// PDF motoru seçimi: "advanced" = pdf.js (WebView; metin araması, sayfa içi işaretleme), "fast" = yerel motor (react-native-pdf).
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FileInfo } from '../types';

export type PdfEngine = 'advanced' | 'fast';
const KEY = '@tdesk_pdf_engine';

/** pdf.js bu boyutun üstündeki dosyalarda belleği zorlar; otomatik olarak hızlı (yerel) motor kullanılır. */
export const ADVANCED_MAX_BYTES = 60 * 1024 * 1024;

export async function loadPdfEngine(): Promise<PdfEngine> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === 'fast' ? 'fast' : 'advanced';
  } catch {
    return 'advanced';
  }
}

export async function savePdfEngine(engine: PdfEngine): Promise<boolean> {
  try {
    await AsyncStorage.setItem(KEY, engine);
    return true;
  } catch {
    return false;
  }
}

/** Gelişmiş motor yalnızca yerel dosyalarda ve makul boyutta kullanılabilir (içerik parça parça WebView'a aktarılır). */
export function canUseAdvancedEngine(file: Pick<FileInfo, 'uri' | 'size'>): { ok: boolean; reason?: string } {
  if (!file.uri.startsWith('file://')) return { ok: false, reason: 'Dosya uygulama dışında (content://) olduğu için hızlı motor kullanıldı.' };
  if (typeof file.size === 'number' && file.size > ADVANCED_MAX_BYTES) return { ok: false, reason: 'Büyük dosya: hızlı motor kullanıldı.' };
  return { ok: true };
}
