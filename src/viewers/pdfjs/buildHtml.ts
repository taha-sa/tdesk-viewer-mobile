import { PDFJS_LIB, PDFJS_WORKER, PDFJS_VIEWER_JS, PDFJS_VIEWER_CSS } from './pdfjsBundle';

/** WebView'a verilen sahte (hiç ağ isteği yapılmayan) kök adres: blob worker'ın aynı kökenden çalışabilmesi için. */
export const PDFJS_BASE_URL = 'https://tdesk-pdf.invalid/';

/**
 * Tek parça, tamamen çevrimdışı görüntüleyici sayfası. CSP: ağ yok; yalnızca satır içi betik ve blob (worker).
 * @param bg sayfa dışı arka plan rengi, @param fg ilk mesaj yazı rengi
 */
export function buildPdfHtml(bg: string, fg: string): string {
  const csp = "default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src blob: data:";
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=6, user-scalable=yes">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    `<style>${PDFJS_VIEWER_CSS}</style></head>`,
    `<body style="background:${bg};color:${fg}"><div id="msg">PDF hazırlanıyor…</div><div id="pages"></div>`,
    `<script>${PDFJS_LIB}</script>`,
    `<script id="pdfworker" type="text/plain">${PDFJS_WORKER}</script>`,
    `<script>${PDFJS_VIEWER_JS}</script>`,
    '</body></html>',
  ].join('');
}
