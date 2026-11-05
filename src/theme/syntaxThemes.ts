// Tek kod teması kaynağı. highlight.js İÇE AKTARMAZ (SettingsScreen bunu hafifçe kullanır).
import { SyntaxTheme } from '../types';

export interface SyntaxThemeDef {
  name: string;
  bg: string;
  gutterBg: string;
  gutterColor: string;
  textColor: string;
  selectionBg: string;
  colors: Record<string, string>;
}

export const DEFAULT_SYNTAX_THEME_ID: SyntaxTheme = 'vscode-dark';

export const SYNTAX_THEMES: Record<SyntaxTheme, SyntaxThemeDef> = {
  'vscode-dark': {
    name: 'VS Code Dark+',
    bg: '#1E1E1E',
    gutterBg: '#252526',
    gutterColor: '#8C8C8C',
    textColor: '#D4D4D4',
    selectionBg: '#264F78',
    colors: {
      keyword: '#569CD6',
      built_in: '#4EC9B0',
      type: '#4EC9B0',
      string: '#CE9178',
      number: '#B5CEA8',
      comment: '#6A9955',
      function: '#DCDCAA',
      title: '#DCDCAA',
      params: '#9CDCFE',
      attr: '#9CDCFE',
      variable: '#9CDCFE',
      operator: '#D4D4D4',
      punctuation: '#D4D4D4',
      meta: '#9B9B9B',
      tag: '#569CD6',
      name: '#569CD6',
      attribute: '#9CDCFE',
      literal: '#569CD6',
    },
  },
  monokai: {
    name: 'Monokai Pro',
    bg: '#272822',
    gutterBg: '#1E1F1C',
    gutterColor: '#928F80',
    textColor: '#F8F8F2',
    selectionBg: '#49483E',
    colors: {
      keyword: '#F92672',
      built_in: '#66D9EF',
      type: '#66D9EF',
      string: '#E6DB74',
      number: '#AE81FF',
      comment: '#928F80',
      function: '#A6E22E',
      title: '#A6E22E',
      params: '#FD971F',
      attr: '#A6E22E',
      variable: '#F8F8F2',
      operator: '#F92672',
      punctuation: '#F8F8F2',
      meta: '#928F80',
      tag: '#F92672',
      name: '#F92672',
      attribute: '#A6E22E',
      literal: '#AE81FF',
    },
  },
  dracula: {
    name: 'Dracula Dark',
    bg: '#282A36',
    gutterBg: '#21222C',
    gutterColor: '#8390B7',
    textColor: '#F8F8F2',
    selectionBg: '#44475A',
    colors: {
      keyword: '#FF79C6',
      built_in: '#8BE9FD',
      type: '#8BE9FD',
      string: '#F1FA8C',
      number: '#BD93F9',
      comment: '#8390B7',
      function: '#50FA7B',
      title: '#50FA7B',
      params: '#FFB86C',
      attr: '#50FA7B',
      variable: '#F8F8F2',
      operator: '#FF79C6',
      punctuation: '#F8F8F2',
      meta: '#BD93F9',
      tag: '#FF79C6',
      name: '#FF79C6',
      attribute: '#50FA7B',
      literal: '#BD93F9',
    },
  },
  'one-dark': {
    name: 'Atom One Dark',
    bg: '#282C34',
    gutterBg: '#21252B',
    gutterColor: '#8F939C',
    textColor: '#ABB2BF',
    selectionBg: '#3E4451',
    colors: {
      keyword: '#C678DD',
      built_in: '#E5C07B',
      type: '#E5C07B',
      string: '#98C379',
      number: '#D19A66',
      comment: '#8F939C',
      function: '#61AFEF',
      title: '#61AFEF',
      params: '#E06C75',
      attr: '#D19A66',
      variable: '#E06C75',
      operator: '#56B6C2',
      punctuation: '#ABB2BF',
      meta: '#E5C07B',
      tag: '#E06C75',
      name: '#E06C75',
      attribute: '#D19A66',
      literal: '#56B6C2',
    },
  },
  'github-light': {
    name: 'GitHub Light',
    bg: '#FFFFFF',
    gutterBg: '#F6F8FA',
    gutterColor: '#6C737A',
    textColor: '#24292F',
    selectionBg: '#B4D5FE',
    colors: {
      keyword: '#CF222E',
      built_in: '#953800',
      type: '#953800',
      string: '#0A3069',
      number: '#0550AE',
      comment: '#6E7781',
      function: '#8250DF',
      title: '#8250DF',
      params: '#24292F',
      attr: '#116329',
      variable: '#953800',
      operator: '#CF222E',
      punctuation: '#24292F',
      meta: '#6E7781',
      tag: '#116329',
      name: '#116329',
      attribute: '#0550AE',
      literal: '#0550AE',
    },
  },
  'solarized-dark': {
    name: 'Solarized Dark',
    bg: '#002B36',
    gutterBg: '#073642',
    gutterColor: '#8C9BA0',
    textColor: '#839496',
    selectionBg: '#073642',
    colors: {
      keyword: '#859900',
      built_in: '#268BD2',
      type: '#B58900',
      string: '#2AA198',
      number: '#D33682',
      comment: '#809196',
      function: '#268BD2',
      title: '#268BD2',
      params: '#657B83',
      attr: '#B58900',
      variable: '#268BD2',
      operator: '#859900',
      punctuation: '#839496',
      meta: '#CB4B16',
      tag: '#268BD2',
      name: '#268BD2',
      attribute: '#B58900',
      literal: '#D33682',
    },
  },
};

export function isSyntaxThemeId(x: unknown): x is SyntaxTheme {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(SYNTAX_THEMES, x);
}

/** Bilinmeyen/eski/bozuk id için bile ASLA undefined dönmez. */
export function getSyntaxTheme(id?: string | null): SyntaxThemeDef {
  return isSyntaxThemeId(id) ? SYNTAX_THEMES[id] : SYNTAX_THEMES[DEFAULT_SYNTAX_THEME_ID];
}

// highlight.js kapsam adı -> tema anahtarı
const TOKEN_ALIAS: Record<string, string> = {
  quote: 'comment',
  doctag: 'comment',
  'selector-tag': 'tag',
  'selector-id': 'attr',
  'selector-class': 'attr',
  'selector-attr': 'attr',
  'selector-pseudo': 'attr',
  property: 'attr',
  regexp: 'string',
  char: 'string',
  link: 'string',
  addition: 'string',
  symbol: 'literal',
  bullet: 'literal',
  formula: 'number',
  section: 'title',
  'template-variable': 'variable',
  'template-tag': 'keyword',
  deletion: 'keyword',
};

export function resolveTokenColor(theme: SyntaxThemeDef, type: string): string {
  if (type === 'text') return theme.textColor;
  return theme.colors[type] || theme.colors[TOKEN_ALIAS[type]] || theme.textColor;
}
