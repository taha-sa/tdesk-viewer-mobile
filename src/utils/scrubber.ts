// Kişisel veri maskeleme (en iyi çaba). Kurallar T-Suite TSuite.Diagnostics/Scrubber.cs ile birebir aynıdır
// (+ Android'e özgü yol maskesi). Saf mantık: RN içe aktarmaz, node'da test edilir (scripts/test-scrubber.js).

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** IPv6 adayı gerçekten geçerli bir adres mi (System.Net.IPAddress.TryParse karşılığı). */
export function isIPv6(s: string): boolean {
  let v = s;
  const zone = v.indexOf('%');
  if (zone >= 0) v = v.slice(0, zone);
  if (!v.includes(':') || !/^[0-9a-f:.]+$/i.test(v)) return false;
  const lastColon = v.lastIndexOf(':');
  const last = v.slice(lastColon + 1);
  if (last.includes('.')) {
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(last) || last.split('.').some(p => Number(p) > 255)) return false;
    v = v.slice(0, lastColon + 1) + '0:0';
  }
  const dbl = v.split('::');
  if (dbl.length > 2) return false;
  const all = dbl.flatMap(part => (part === '' ? [] : part.split(':')));
  if (all.some(g => !/^[0-9a-f]{1,4}$/i.test(g))) return false;
  return dbl.length === 2 ? all.length <= 7 : all.length === 8;
}

export class Scrubber {
  private identities: string[];
  private maskGuids: boolean;

  /** identities: cihaz/kullanıcı adı gibi ek maskelenecek kimlikler (isteğe bağlı). */
  constructor(maskGuids = false, identities: Array<string | null | undefined> = []) {
    this.maskGuids = maskGuids;
    this.identities = identities.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  }

  scrub(value: string | null | undefined): string {
    let s = value ?? '';
    // Kimlik bilgisi ve sorgu/parça (query/fragment) tamamen atılır.
    s = s.replace(/https?:\/\/[^\s<>"`]+/gi, m => {
      let url = m;
      const end = url.search(/[?#]/);
      if (end >= 0) url = url.slice(0, end) + '[query]';
      return url.replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[credentials]@');
    });
    s = s.replace(/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]');
    s = s.replace(/(\b[A-Z]:[\\/]Users[\\/])[^\\/\r\n"'<>]+/gi, '$1[user]');
    // Android: depolama/uygulama dizinleri kullanıcı dosya adlarını içerebilir.
    s = s.replace(
      /((?:file:\/\/)?\/(?:storage\/emulated\/\d+|storage\/[0-9A-F-]{4,}|sdcard|data\/user\/\d+|data\/data|mnt\/sdcard)\/)[^\r\n"'<>]*/gi,
      '$1[path]',
    );
    for (const identity of this.identities) {
      s = s.replace(new RegExp('(?<![\\p{L}\\p{N}_])' + escapeRegex(identity) + '(?![\\p{L}\\p{N}_])', 'giu'), '[identity]');
    }
    s = s.replace(/(?<![\w:])(?:[0-9a-f]{0,4}:){2,}[0-9a-f:.]*(?:%[\w.-]+)?/gi, m => {
      if (isIPv6(m)) return '[ip]';
      const trimmed = m.replace(/[.:]+$/, '');
      return isIPv6(trimmed) ? '[ip]' + m.slice(trimmed.length) : m;
    });
    s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gi, '[ip]');
    s = s.replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [secret]');
    s = s.replace(
      /\b((?:[\w-]*(?:token|key|auth|secret|password)[\w-]*)["']?\s*[:=]\s*)(?:\[secret\]|"[^"\r\n]*"|'[^'\r\n]*'|Bearer\s+[^\s,;]+|[^\s,;"'&}\]]+)/gi,
      '$1[secret]',
    );
    if (this.maskGuids) s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]');
    s = s.replace(/(?<![\w+/=-])(?:[0-9a-f]{32,}|[A-Za-z0-9_+/-]{40,}={0,2})(?![\w+/=-])/gi, '[token]');
    return s;
  }
}
