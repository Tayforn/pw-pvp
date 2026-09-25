// =========================================================
// Сторож рендеру ляльки: у src/doll жодного HTML-рядка. Лялька Хелпера
// будувала тултіпи й лог рядками HTML і вставляла їх через innerHTML — з
// документом гравця (назви, ролі, імпорт) це дірка для XSS. Тут усе мусить
// йти React-вузлами, тож тест шукає заборонене в сирцях.
//
// Рядкові літерали беремо з розбору компілятором TypeScript, а не регуляркою
// по рядках: у JSX лапки атрибутів сусідять із тегами, і регулярка бачила б
// «рядок» від лапки одного атрибута до лапки наступного.
//
// Сирці — через import.meta.glob ?raw (без node:fs: у проєкті немає @types/node).
// Тести (__tests__) не перевіряються: вони якраз і містять ці слова як шаблони.
// =========================================================

import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/__tests__/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Слова збираються з частин, щоб цей файл не знаходив сам себе, якщо його колись перевірятимуть.
const FORBIDDEN: Array<{ name: string; re: RegExp }> = [
  { name: 'inner' + 'HTML', re: new RegExp('\\binner' + 'HTML\\b') },
  { name: 'outer' + 'HTML', re: new RegExp('\\bouter' + 'HTML\\b') },
  { name: 'dangerously' + 'SetInnerHTML', re: new RegExp('dangerously' + 'SetInner' + 'HTML') },
  { name: 'insertAdjacent' + 'HTML', re: new RegExp('insertAdjacent' + 'HTML') },
  { name: 'document.' + 'write', re: new RegExp('document\\.' + 'write\\s*\\(') },
  { name: 'create' + 'ContextualFragment', re: new RegExp('create' + 'ContextualFragment') },
];

// Тег HTML усередині рядка: '<div', '</span>', '<b>' тощо.
const TAGS = 'div|span|b|i|u|p|a|br|hr|img|svg|path|g|table|tr|td|th|ul|ol|li|strong|em|small|h[1-6]|button|input|label|select|option|script|style|iframe|details|summary';
const HTML_TAG = new RegExp('<\\/?(?:' + TAGS + ')(?=[\\s>/])', 'i');

/** Усі рядкові й шаблонні літерали файла з номером рядка. */
function stringLiterals(file: string, src: string): Array<{ line: number; text: string }> {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const out: Array<{ line: number; text: string }> = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, text: n.text });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Код без коментарів — коментар може описувати, чого робити не треба. */
function codeOnly(file: string, src: string): string {
  const kind = file.endsWith('.tsx') ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  const sc = ts.createScanner(ts.ScriptTarget.Latest, false, kind, src);
  let out = '';
  for (let t = sc.scan(); t !== ts.SyntaxKind.EndOfFileToken; t = sc.scan()) {
    if (t === ts.SyntaxKind.SingleLineCommentTrivia || t === ts.SyntaxKind.MultiLineCommentTrivia) continue;
    out += sc.getTokenText();
  }
  return out;
}

describe('лялька рендериться лише React-вузлами', () => {
  const files = Object.keys(SOURCES).sort();

  it('сирці знайдено (glob працює)', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith('/ui/DollEditor.tsx'))).toBe(true);
    expect(files.some((f) => f.includes('/__tests__/'))).toBe(false);
  });

  it.each(FORBIDDEN.map((f) => [f.name, f.re] as const))('немає %s', (_name, re) => {
    const hits = files.filter((f) => re.test(codeOnly(f, SOURCES[f])));
    expect(hits).toEqual([]);
  });

  it('немає HTML-тегів у рядках', () => {
    const hits: string[] = [];
    for (const f of files) {
      for (const s of stringLiterals(f, SOURCES[f])) if (HTML_TAG.test(s.text)) hits.push(f + ':' + s.line + '  ' + JSON.stringify(s.text));
    }
    expect(hits).toEqual([]);
  });

  it('сторож справді ловить порушення і не чіпає JSX', () => {
    const bad = stringLiterals('x.ts', "const x = '<div class=\"a\">' + name; const y = `<span>${v}</span>`;");
    expect(bad.filter((s) => HTML_TAG.test(s.text)).length).toBe(3);
    const jsx = stringLiterals('x.tsx', 'const a = <div className="doll" title={\'a < b\'}><b>{n}</b></div>; const m = new Map<string, Item[]>();');
    expect(jsx.filter((s) => HTML_TAG.test(s.text))).toEqual([]);
    expect(FORBIDDEN[0].re.test(codeOnly('x.ts', 'el.inner' + 'HTML = s;'))).toBe(true);
    expect(FORBIDDEN[0].re.test(codeOnly('x.ts', '// тут був inner' + 'HTML\nconst a = 1;'))).toBe(false);
  });
});
