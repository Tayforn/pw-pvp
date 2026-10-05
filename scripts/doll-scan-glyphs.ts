// =========================================================
// Генератор шаблонів для сканера скріншотів (src/doll/scan/glyphs.ts): цифри двох
// шрифтів вікна «Персонаж».
//
// Шаблони знімаються з еталонних скріншотів: для кожного рядка відомо, що там
// написано і де починається перша літера. Шрифт у грі з цілим кроком (цифра —
// 6 px у великому шрифті, 5 px у малому), тож клітинки ріжуться без розпізнавання.
// Кілька зразків одного символу зводяться медіаною — вона прибирає сліди сусідів.
//
// Коли зʼявиться скріншот із символом, якого бракує, або з іншим розміром шрифту
// (інший масштаб інтерфейсу), додати рядки в LINES і перезапустити:
//   npx vite-node scripts/doll-scan-glyphs.ts
// =========================================================

import fs from 'node:fs';
import { inkBox } from '../src/doll/scan/ink';
import { decodePng } from '../src/doll/scan/png';

const FIXTURES = 'src/doll/scan/__tests__/fixtures/';
const OUT = 'src/doll/scan/glyphs.ts';

type FontKey = 'A' | 'B';
/** Висота клітинки шрифту: рядки штрихів + по одному рядку згладжування згори і знизу. */
const HEIGHT: Record<FontKey, number> = { A: 11, B: 10 };
const DIGIT_W: Record<FontKey, number> = { A: 6, B: 5 };
const PUNCT_W: Record<FontKey, Record<string, number>> = { A: { '-': 4, '.': 3, '%': 9 }, B: { '/': 3 } };

interface Line {
  file: string;
  font: FontKey;
  text: string;
  /** x лівого краю клітинки першого символу. */
  x: number;
  /** Приблизний y верхнього рядка штрихів (уточнюється в межах ±3). */
  y: number;
}
const S1 = 'stats-1.png';
const LINES: Line[] = [
  // таблиця характеристик: ліва колонка вирівняна до x=173, права — до x=347
  { file: S1, font: 'A', text: '10573-16054', x: 109, y: 267 },
  { file: S1, font: 'A', text: '7273', x: 323, y: 267 },
  { file: S1, font: 'A', text: '646-646', x: 133, y: 284 },
  { file: S1, font: 'A', text: '9256', x: 323, y: 284 },
  { file: S1, font: 'A', text: '34%', x: 152, y: 302 },
  { file: S1, font: 'A', text: '200%', x: 320, y: 302 },
  { file: S1, font: 'A', text: '0.71', x: 115, y: 320 },
  { file: S1, font: 'A', text: '5.5', x: 299, y: 320 },
  { file: S1, font: 'A', text: '6672', x: 149, y: 338 },
  { file: S1, font: 'A', text: '3984', x: 323, y: 338 },
  { file: S1, font: 'A', text: '35', x: 161, y: 355 },
  { file: S1, font: 'A', text: '59', x: 335, y: 355 },
  { file: S1, font: 'A', text: '12', x: 161, y: 372 },
  { file: S1, font: 'A', text: '22248', x: 317, y: 372 },
  { file: S1, font: 'A', text: '0', x: 167, y: 389 },
  { file: S1, font: 'A', text: '104', x: 329, y: 389 },
  { file: S1, font: 'A', text: '1822', x: 149, y: 425 },
  // шапка: репутація, досвід, рівень
  { file: S1, font: 'A', text: '551573', x: 227, y: 64 },
  { file: S1, font: 'A', text: '401630279', x: 227, y: 140 },
  { file: S1, font: 'A', text: '1750000000', x: 227, y: 153 },
  { file: S1, font: 'A', text: '104', x: 31, y: 146 },
  // атрибути (зелені)
  { file: S1, font: 'A', text: '218', x: 43, y: 219 },
  { file: S1, font: 'A', text: '15', x: 170, y: 219 },
  { file: S1, font: 'A', text: '111', x: 43, y: 240 },
  { file: S1, font: 'A', text: '502', x: 170, y: 240 },
  // рядок ЖС / МЕ / Дух — малий шрифт
  { file: S1, font: 'B', text: '14622/14622', x: 58, y: 170 },
  { file: S1, font: 'B', text: '3031/3031', x: 173, y: 170 },
  { file: S1, font: 'B', text: '2000000000', x: 282, y: 170 },
  // ті самі рядки в інших гравців — заради 5, 7, 8, 9 малого шрифту
  { file: 'f1.png', font: 'B', text: '17290/17290', x: 64, y: 185 },
  { file: 'f1.png', font: 'B', text: '2169/2169', x: 184, y: 185 },
  { file: 'f1.png', font: 'B', text: '1641945820', x: 297, y: 185 },
  { file: 'l1.png', font: 'B', text: '11537/11537', x: 64, y: 180 },
  { file: 'l1.png', font: 'B', text: '7914/7914', x: 184, y: 180 },
  { file: 'l1.png', font: 'B', text: '2000000000', x: 297, y: 180 },
];

const widthOf = (font: FontKey, ch: string): number => (/\d/.test(ch) ? DIGIT_W[font] : PUNCT_W[font][ch]);
const hex = (v: number): string => Math.min(15, Math.max(0, Math.round(v * 15))).toString(16);

async function main(): Promise<void> {
  const rasters = new Map<string, Awaited<ReturnType<typeof decodePng>>>();
  const raster = async (file: string) => {
    if (!rasters.has(file)) rasters.set(file, await decodePng(fs.readFileSync(FIXTURES + file)));
    return rasters.get(file)!;
  };

  const samples: Record<FontKey, Map<string, Float32Array[]>> = { A: new Map(), B: new Map() };
  for (const ln of LINES) {
    const r = await raster(ln.file);
    const h = HEIGHT[ln.font];
    const width = [...ln.text].reduce((n, ch) => n + widthOf(ln.font, ch), 0);
    const margin = 3;
    const rect = { x: ln.x, y: ln.y - 1 - margin, w: width, h: h + 2 * margin };
    const ink = inkBox(r, rect);
    if (!ink) throw new Error(`немає тексту: «${ln.text}» (${ln.file} ${ln.x},${ln.y})`);
    // Верхній рядок штрихів — перший, де є яскравий піксель; клітинка починається рядком вище.
    let first = -1;
    // Шукаємо від y − 2: вище може стирчати низ попереднього рядка (підкреслення, хвости літер).
    for (let j = margin - 1; j < rect.h && first < 0; j++) for (let i = 0; i < rect.w; i++) if (ink[j * rect.w + i] > 0.5) first = j;
    const top = first - 1;
    if (top < 0 || top + h > rect.h) throw new Error(`рядок не влазить у вікно пошуку: «${ln.text}»`);
    let cx = 0;
    for (const ch of ln.text) {
      const w = widthOf(ln.font, ch);
      const cell = new Float32Array(w * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) cell[j * w + i] = ink[(top + j) * rect.w + cx + i];
      const list = samples[ln.font].get(ch) ?? [];
      list.push(cell);
      samples[ln.font].set(ch, list);
      cx += w;
    }
  }

  const fonts: Record<string, { h: number; glyphs: Record<string, string[]> }> = {};
  for (const font of ['A', 'B'] as const) {
    const glyphs: Record<string, string[]> = {};
    for (const ch of [...samples[font].keys()].sort()) {
      const list = samples[font].get(ch)!;
      const w = widthOf(font, ch);
      const h = HEIGHT[font];
      const med = new Float32Array(w * h);
      let worst = 0;
      for (let i = 0; i < med.length; i++) {
        const vals = list.map((c) => c[i]).sort((a, b) => a - b);
        med[i] = vals[vals.length >> 1];
        // Розкид між зразками всередині клітинки (краї зачіпають сусіди — їх не рахуємо).
        const col = i % w;
        if (col > 0 && col < w - 1) worst = Math.max(worst, vals[vals.length - 1] - vals[0]);
      }
      console.log(`${font} «${ch}»: зразків ${list.length}, розкид ${worst.toFixed(2)}`);
      const rows: string[] = [];
      for (let j = 0; j < h; j++) rows.push(Array.from(med.subarray(j * w, (j + 1) * w), hex).join(''));
      for (const row of rows) console.log('    ' + row.replace(/0/g, '·'));
      glyphs[ch] = rows;
    }
    fonts[font] = { h: HEIGHT[font], glyphs };
  }

  const lines: string[] = [];
  lines.push('// ЗГЕНЕРОВАНО scripts/doll-scan-glyphs.ts з еталонних скріншотів — не правити руками.');
  lines.push('// Шаблони цифр вікна «Персонаж»: рядок масиву — рядок пікселів, символ — рівень');
  lines.push('// чорнила 0..f. Шрифт A — таблиця, атрибути, рівень; B — рядок ЖС / МЕ.');
  lines.push('');
  lines.push('export interface GlyphFont {');
  lines.push('  /** Висота клітинки, px. */');
  lines.push('  h: number;');
  lines.push('  glyphs: Record<string, string[]>;');
  lines.push('}');
  lines.push('');
  lines.push('export const FONTS: Record<' + "'A' | 'B'" + ', GlyphFont> = {');
  for (const font of ['A', 'B'] as const) {
    lines.push(`  ${font}: {`);
    lines.push(`    h: ${fonts[font].h},`);
    lines.push('    glyphs: {');
    for (const [ch, rows] of Object.entries(fonts[font].glyphs)) lines.push(`      '${ch}': [${rows.map((r) => `'${r}'`).join(', ')}],`);
    lines.push('    },');
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  fs.writeFileSync(OUT, lines.join('\n'));
  console.log('записано ' + OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
