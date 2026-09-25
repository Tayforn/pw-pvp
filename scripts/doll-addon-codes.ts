// =========================================================
// Генератор ADDON_CODES для src/doll/core/constants.ts: білий список кодів стат,
// які можуть стояти в ролах речі документа персонажа = ADDON_OPTIONS ∪ усі коди
// nw.wu з каталогів mypers (включно з ob/wdf/crystal). Результат вписується
// між маркерами «>>> ADDON_CODES» / «<<< ADDON_CODES».
//
// Запуск:  npx vite-node scripts/doll-addon-codes.ts
// Каталоги: src/doll/data/json, а доки їх нема — PW_CALC_DIR (../pw-calc)/public/assets/data/mypers.
// =========================================================

import fs from 'node:fs';
import path from 'node:path';
import { ADDON_OPTIONS } from '../src/doll/core/constants';

const CATS = ['ft', 'vx', 'rv', 'st', 'tg', 'rx', 'wy', 'mj', 'oq', 'ta', 'it', 'qn', 'pp', 'pk', 'gv', 'ic', 'ob', 'wdf', 'crystal'];

function dataDir(): string {
  const local = path.resolve('src/doll/data/json');
  if (fs.existsSync(path.join(local, 'ta.json'))) return local;
  return path.resolve(process.env.PW_CALC_DIR || '../pw-calc', 'public/assets/data/mypers');
}

/** Коди nw.wu усіх речей каталогу (порожні/нечислові пропускаємо — так само робить flattenItemStats). */
export function collectWuCodes(dir: string): Set<string> {
  const out = new Set<string>();
  for (const cat of CATS) {
    const items = JSON.parse(fs.readFileSync(path.join(dir, cat + '.json'), 'utf8')) as Array<Record<string, unknown>>;
    for (const it of items) {
      const nw = it.nw as { wu?: Array<{ type?: string }> } | undefined;
      if (!nw || !Array.isArray(nw.wu)) continue;
      for (const w of nw.wu) if (w && typeof w.type === 'string' && w.type) out.add(w.type);
    }
  }
  return out;
}

/** Порядок: спершу ADDON_OPTIONS (як у редакторі), далі решта кодів каталогів за алфавітом. */
export function buildAddonCodes(dir: string): string[] {
  const base = ADDON_OPTIONS.map((o) => o.code);
  const seen = new Set(base);
  const extra = [...collectWuCodes(dir)].filter((c) => !seen.has(c)).sort();
  return [...base, ...extra];
}

function main(): void {
  const dir = dataDir();
  const codes = buildAddonCodes(dir);
  const file = path.resolve('src/doll/core/constants.ts');
  const src = fs.readFileSync(file, 'utf8');
  const open = '// >>> ADDON_CODES\n';
  const close = '// <<< ADDON_CODES';
  const a = src.indexOf(open);
  const b = src.indexOf(close);
  if (a < 0 || b < 0 || b < a) throw new Error('constants.ts: не знайдено маркери ADDON_CODES');
  // По 8 кодів у рядку — щоб diff у git лишався читабельним.
  const rows: string[] = [];
  for (let i = 0; i < codes.length; i += 8) rows.push('  ' + codes.slice(i, i + 8).map((c) => `'${c}'`).join(', ') + ',');
  const body = `export const ADDON_CODES: readonly string[] = [\n${rows.join('\n')}\n];\n`;
  const next = src.slice(0, a + open.length) + body + src.slice(b);
  if (next !== src) fs.writeFileSync(file, next);
  console.log(`ADDON_CODES: ${codes.length} кодів (${codes.length - ADDON_OPTIONS.length} понад ADDON_OPTIONS) з ${dir}${next !== src ? ' — записано' : ' — без змін'}`);
}

main();
