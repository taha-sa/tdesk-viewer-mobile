// PDF birleştirme (pdf-lib). Saf bayt işler: dosya okuma/yazma ve base64 dönüşümü çağıranın işidir.
import { PDFDocument } from 'pdf-lib';

export type PdfMergeFailure = 'encrypted' | 'invalid' | 'empty';

export class PdfMergeError extends Error {
  /** Hatanın kaynağı olan girdinin 0 tabanlı sırası. */
  readonly index: number;
  readonly reason: PdfMergeFailure;
  constructor(index: number, reason: PdfMergeFailure, message: string) {
    super(message);
    this.name = 'PdfMergeError';
    this.index = index;
    this.reason = reason;
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Verilen PDF baytlarını sırayla tek PDF'te birleştirir. UI donmasın diye her dosyadan sonra olay döngüsüne nefes verir. */
export async function mergePdfBytes(
  inputs: readonly Uint8Array[],
  onProgress?: (done: number, total: number) => void
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  if (inputs.length < 2) throw new PdfMergeError(0, 'empty', 'Birleştirmek için en az iki PDF gerekir.');
  const out = await PDFDocument.create();
  let pageCount = 0;
  for (let i = 0; i < inputs.length; i++) {
    let src: PDFDocument;
    try {
      src = await PDFDocument.load(inputs[i]);
    } catch (e) {
      const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
      if (/encrypt/i.test(msg)) throw new PdfMergeError(i, 'encrypted', 'Şifreli PDF birleştirilemez.');
      throw new PdfMergeError(i, 'invalid', 'PDF okunamadı veya bozuk.');
    }
    const pages = await out.copyPages(src, src.getPageIndices());
    if (pages.length === 0) throw new PdfMergeError(i, 'empty', 'PDF hiç sayfa içermiyor.');
    for (const p of pages) out.addPage(p);
    pageCount += pages.length;
    onProgress?.(i + 1, inputs.length);
    await tick();
  }
  const bytes = await out.save();
  return { bytes, pageCount };
}
