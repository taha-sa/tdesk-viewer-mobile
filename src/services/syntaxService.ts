// Uzantı -> dil eşlemesi (vurgulama motoru utils/highlight.ts; tema kaynağı theme/syntaxThemes.ts).
// highlight.js içe aktarmaz.
export { SYNTAX_THEMES } from '../theme/syntaxThemes';

/** Uzantı -> highlight.js dil adı. 'plaintext' = vurgulama yok. */
export const LANGUAGE_MAP: Record<string, string> = {
  // Web & Scripting
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', xhtml: 'xml', vue: 'xml', plist: 'xml',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  json: 'json', jsonc: 'json', json5: 'json',
  yaml: 'yaml', yml: 'yaml',
  // Backend & Systems
  py: 'python', pyw: 'python',
  dart: 'dart',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  gradle: 'groovy', groovy: 'groovy',
  c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp', hh: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  php: 'php',
  rb: 'ruby',
  swift: 'swift',
  // Data & DevOps
  sql: 'sql',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  bat: 'dos', cmd: 'dos',
  ps1: 'powershell', psm1: 'powershell',
  dockerfile: 'dockerfile', docker: 'dockerfile',
  makefile: 'makefile', mk: 'makefile',
  ini: 'ini', env: 'ini', conf: 'ini', properties: 'ini', toml: 'ini', cfg: 'ini',
  md: 'markdown', markdown: 'markdown',
  tex: 'latex',
  lua: 'lua',
  r: 'r',
  scala: 'scala',
  perl: 'perl', pl: 'perl',
  diff: 'diff', patch: 'diff',
};
