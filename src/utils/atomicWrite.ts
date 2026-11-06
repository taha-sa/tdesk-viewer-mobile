// Atomik dosya yazma. Android'de writeAsStringAsync önce hedefi 0 bayta keser; yazma sırasında
// disk dolması / çökme / bellek yetersizliği orijinal içeriği yok eder. Burada önce yanına geçici dosya
// yazılır, başarıyla yazıldıktan sonra hedefin üzerine taşınır (Android'de File.renameTo eski dosyayı değiştirir).
import * as FileSystem from 'expo-file-system';

export async function writeFileAtomic(uri: string, data: string, encoding: 'utf8' | 'base64'): Promise<void> {
  const enc = encoding === 'base64' ? FileSystem.EncodingType.Base64 : FileSystem.EncodingType.UTF8;
  // Yalnız normal file:// yollarında geçici dosya kullanılabilir; diğerlerinde (content:// vb.) doğrudan yaz.
  if (!uri.startsWith('file://')) {
    await FileSystem.writeAsStringAsync(uri, data, { encoding: enc });
    return;
  }
  const tmp = `${uri}.tdesk-tmp`;
  try {
    await FileSystem.writeAsStringAsync(tmp, data, { encoding: enc });
    const info = await FileSystem.getInfoAsync(tmp);
    if (!info.exists || (data.length > 0 && info.size === 0)) {
      throw new Error('Geçici dosya yazılamadı.');
    }
    await FileSystem.moveAsync({ from: tmp, to: uri });
  } catch (e) {
    try { await FileSystem.deleteAsync(tmp, { idempotent: true }); } catch { /* temizlik başarısız olabilir */ }
    throw e; // orijinal dosyaya dokunulmadı
  }
}
