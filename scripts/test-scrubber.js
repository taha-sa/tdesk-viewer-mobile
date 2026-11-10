#!/usr/bin/env node
// Maskeleyici + rapor biçimi testi (JS test çalıştırıcısı yok; TS, typescript ile anında derlenir).
// Çalıştırma: node scripts/test-scrubber.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ts = require('typescript');

function load(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', file), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out)(m, m.exports, (p) => (p === './scrubber' ? scrubberMod : require(p)));
  return m.exports;
}
const scrubberMod = load('scrubber.ts');
const report = load('crashReport.ts');
const { Scrubber } = scrubberMod;
const s = new Scrubber(false, ['MyPhone', 'taha']);
const eq = (input, expected, label) => assert.strictEqual(s.scrub(input), expected, label || input);

eq('see https://user:pw@example.com/a/b?token=abc#frag', 'see https://[credentials]@example.com/a/b[query]', 'url');
eq('mail me: a.b+c@example.co.uk now', 'mail me: [email] now', 'email');
eq('C:\\Users\\Ahmet\\Desktop\\x.txt', 'C:\\Users\\[user]\\Desktop\\x.txt', 'win user');
eq('/storage/emulated/0/Download/Gizli Belge.pdf', '/storage/emulated/0/[path]', 'android path');
eq('file:///data/user/0/com.app/cache/tdesk_1.pdf', 'file:///data/user/0/[path]', 'android file uri');
eq('host MyPhone and taha, tahani', 'host [identity] and [identity], tahani', 'identity');
eq('peer 192.168.1.20 up', 'peer [ip] up', 'ipv4');
eq('peer fe80::1ff:fe23:4567:890a x', 'peer [ip] x', 'ipv6');
eq('at 12:30:45 ok', 'at 12:30:45 ok', 'time is not ipv6');
eq('Proxy Bearer abc.def-ghi', 'Proxy Bearer [secret]', 'bearer bare');
eq('Authorization: Bearer abc.def-ghi', 'Authorization: [secret]', 'bearer (auth key rule)');
eq('apiKey = "sk-123 456"', 'apiKey = [secret]', 'key quoted');
eq('password=hunter2&x=1', 'password=[secret]&x=1', 'password');
eq('id deadbeefdeadbeefdeadbeefdeadbeef end', 'id [token] end', 'hex token');
eq('x ' + 'A'.repeat(45) + ' y', 'x [token] y', 'base64 token');
eq('plain text', 'plain text', 'plain');
eq(null, '', 'null');
assert.strictEqual(new Scrubber(true).scrub('id 123e4567-e89b-12d3-a456-426614174000'), 'id [id]', 'guid');

const rec = {
  appName: 'T-Desk Viewer', version: '1.0.0', utc: '2026-11-10T10:00:00.000Z', os: 'android 14', runtime: 'RN 0.76.9 / Hermes',
  locale: 'tr-TR', uptimeSec: 12, updateId: null, isFatal: true, errorName: 'TypeError',
  message: 'boom at /storage/emulated/0/Download/a.pdf from 10.0.0.5', stack: 'TypeError: boom\n at f (index.android.bundle:1:2)',
  logLines: Array.from({ length: 300 }, (_, i) => 'line ' + i + ' token=abc123'),
};
const text = report.formatReportText(rec, s);
assert(!text.includes('abc123') && !text.includes('10.0.0.5') && !text.includes('a.pdf'), 'report is scrubbed');
assert(text.includes('line 299') && !text.includes('line 99 '), 'log capped to last 200');
const url = report.buildIssueUrl(rec, 'taha-sa/tdesk-viewer-releases', s);
assert(url.startsWith('https://github.com/taha-sa/tdesk-viewer-releases/issues/new?title='), 'issue url');
assert(url.length < 7000, 'url length ' + url.length);
assert(!/abc123|10\.0\.0\.5/.test(decodeURIComponent(url)), 'url is scrubbed');
assert.throws(() => report.buildIssueUrl(rec, 'bad repo'), 'bad repo rejected');
assert.throws(() => report.validateRepo('a/..'), 'dotdot rejected');
console.log('scrubber/report tests OK');
