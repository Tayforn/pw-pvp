// =========================================================
// СКАН СКРІНШОТІВ — вікно «Персонаж»: прочитати числа характеристик.
//
// Шрифт гри малює кожну цифру однаково й з цілим кроком, тому цифри впізнаємо
// накладанням шаблонів (glyphs.ts), без OCR-бібліотек. Масштаб інтерфейсу в
// гравців різний (1.00, 1.04…): розкладка вікна розтягується, а шрифт лишається
// тим самим. Тому сталих координат немає:
//  1) шукаємо всі числа на скріншоті;
//  2) серед них — таблицю характеристик: дві колонки чисел, вирівняних по
//     правому краю, з рівним кроком рядків і одним пропуском (рядок «Атак/сек |
//     Швидкість», де після числа йдуть одиниці виміру);
//  3) крок рядків дає масштаб, і від таблиці відкладаємо решту полів.
// Від мови клієнта це не залежить: жовті підписи сканер не читає зовсім.
//
// Правило безпеки: число або прочитане повністю, або не прочитане зовсім. Якщо
// поруч із розпізнаними цифрами лишився невпізнаний штрих — поле йде в `unread`,
// а не повертається «майже правильне» число.
// =========================================================

import type { ScanFail } from './equip';
import { FONTS } from './glyphs';
import { inkBox, inkMap } from './ink';
import type { Raster } from './raster';

export type StatKey =
  | 'level' | 'hp' | 'mp' | 'vit' | 'str' | 'mag' | 'dex'
  | 'physMin' | 'physMax' | 'magMin' | 'magMax' | 'crit' | 'aps' | 'acc' | 'pa' | 'cast' | 'stealth' | 'mobDmg'
  | 'physDef' | 'magDef' | 'critDmg' | 'speed' | 'eva' | 'pz' | 'soul' | 'detect' | 'mobDef';

type FontKey = keyof typeof FONTS;
/** int — ціле (можна з «%»); dec — десяткове; range — «мін-макс»; frac — «поточне/максимум» (беремо максимум). */
type Kind = 'int' | 'dec' | 'range' | 'frac';

interface Field {
  keys: StatKey[];
  kind: Kind;
  font: FontKey;
  /** Де шукати число, у координатах еталонного скріншота (масштаб 1.00): x0..x1 і верхній рядок штрихів. */
  x0: number;
  x1: number;
  y: number;
}

/** Таблиця на еталонному скріншоті: праві краї колонок, верх клітинки першого рядка, крок рядків. */
const REF = { xl: 173, xr: 347, y0: 266, pitch: 158 / 9 };

// Таблиця характеристик: значення вирівняні праворуч у двох колонках.
const LEFT = { x0: 92, x1: 176 };
const RIGHT = { x0: 262, x1: 350 };
const ROWS = [267, 284, 302, 320, 338, 355, 372, 389, 407];
/** Рядок таблиці з одиницями виміру після числа — у колонках, вирівняних праворуч, його немає. */
const UNIT_ROW = 3;
const TABLE: Array<[StatKey[], Kind, StatKey[], Kind]> = [
  [['physMin', 'physMax'], 'range', ['physDef'], 'int'],
  [['magMin', 'magMax'], 'range', ['magDef'], 'int'],
  [['crit'], 'int', ['critDmg'], 'int'],
  [['aps'], 'dec', ['speed'], 'dec'],
  [['acc'], 'int', ['eva'], 'int'],
  [['pa'], 'int', ['pz'], 'int'],
  [['cast'], 'int', ['soul'], 'int'],
  [['stealth'], 'int', ['detect'], 'int'],
  [['mobDmg'], 'int', ['mobDef'], 'int'],
];

const FIELDS: Field[] = [
  { keys: ['level'], kind: 'int', font: 'A', x0: 27, x1: 56, y: 146 },
  { keys: ['hp'], kind: 'frac', font: 'B', x0: 50, x1: 122, y: 170 },
  { keys: ['mp'], kind: 'frac', font: 'B', x0: 162, x1: 226, y: 170 },
  { keys: ['vit'], kind: 'int', font: 'A', x0: 38, x1: 80, y: 219 },
  { keys: ['mag'], kind: 'int', font: 'A', x0: 162, x1: 204, y: 219 },
  { keys: ['str'], kind: 'int', font: 'A', x0: 38, x1: 80, y: 240 },
  { keys: ['dex'], kind: 'int', font: 'A', x0: 162, x1: 204, y: 240 },
  ...TABLE.flatMap(([lk, lkind, rk, rkind], i): Field[] => [
    { keys: lk, kind: lkind, font: 'A', ...LEFT, y: ROWS[i] },
    { keys: rk, kind: rkind, font: 'A', ...RIGHT, y: ROWS[i] },
  ]),
];

/** Запас довкола очікуваного місця поля: масштаб відомий неточно, а підписи не масштабуються. */
const X_SLACK = 8;
const Y_SLACK = 4;
/** Найменша схожість шаблону з клітинкою, щоб вважати символ знайденим. */
const MIN_GLYPH = 0.7;
/** Яскравість, з якої стовпчик вважаємо зайнятим штрихом. */
const INK_ON = 0.3;
/** Скільки стовпчиків зліва і справа від числа мають бути порожні. */
const EDGE_LEFT = 5;
const EDGE_RIGHT = 3;
/** Межі масштабу інтерфейсу, за яких шрифт ще той самий, що в шаблонах. */
const MIN_SCALE = 0.9;
const MAX_SCALE = 1.2;
/** Скільки чисел має бути в колонці, щоб вважати її колонкою таблиці. */
const MIN_COLUMN = 5;

interface Glyph {
  ch: string;
  w: number;
  px: Float32Array;
  /** Найяскравіший піксель шаблону — швидкий відсів позицій при пошуку по всьому кадру. */
  kx: number;
  ky: number;
}
const GLYPHS: Record<FontKey, Glyph[]> = { A: [], B: [] };
for (const font of Object.keys(FONTS) as FontKey[]) {
  for (const [ch, rows] of Object.entries(FONTS[font].glyphs)) {
    const w = rows[0].length;
    const px = new Float32Array(w * rows.length);
    let key = 0;
    rows.forEach((row, j) => {
      for (let i = 0; i < w; i++) {
        px[j * w + i] = parseInt(row[i], 16) / 15;
        if (px[j * w + i] > px[key]) key = j * w + i;
      }
    });
    GLYPHS[font].push({ ch, w, px, kx: key % w, ky: Math.floor(key / w) });
  }
}

interface Hit {
  x: number;
  y: number;
  g: Glyph;
  score: number;
}

/** Схожість шаблону з клітинкою чорнила (сума мінімумів до суми максимумів, 0..1). */
function match(ink: Float32Array, w: number, x: number, y: number, g: Glyph, h: number): number {
  let lo = 0;
  let hi = 0;
  for (let j = 0; j < h; j++) {
    const row = (y + j) * w + x;
    for (let i = 0; i < g.w; i++) {
      const a = ink[row + i];
      const b = g.px[j * g.w + i];
      lo += a < b ? a : b;
      hi += a > b ? a : b;
    }
  }
  return hi > 0 ? lo / hi : 0;
}

/** Залишити найсильніші збіги без перекриття (сусідні клітинки заходять одна на одну щонайбільше на піксель). */
function prune(all: Hit[], h: number): Hit[] {
  all.sort((a, b) => b.score - a.score);
  const kept: Hit[] = [];
  for (const c of all) {
    if (!kept.some((k) => Math.abs(k.y - c.y) < h - 1 && c.x < k.x + k.g.w - 1 && k.x < c.x + c.g.w - 1)) kept.push(c);
  }
  return kept;
}

// ---------- 1. числа по всьому кадру ----------

interface Token {
  /** Лівий край першої клітинки, правий край останньої (не включно), верх клітинки. */
  x: number;
  end: number;
  y: number;
  text: string;
}

/** Усі ланцюжки символів великого шрифту на скріншоті (числа таблиці, шапки, атрибутів). */
function findTokens(shot: Raster): Token[] {
  const { w, h } = shot;
  const ink = inkMap(shot);
  const gh = FONTS.A.h;
  const all: Hit[] = [];
  for (const g of GLYPHS.A) {
    for (let y = 0; y + gh <= h; y++) {
      for (let x = 0; x + g.w <= w; x++) {
        if (ink[(y + g.ky) * w + x + g.kx] < 0.5) continue;
        const score = match(ink, w, x, y, g, gh);
        if (score >= MIN_GLYPH) all.push({ x, y, g, score });
      }
    }
  }
  const hits = prune(all, gh).sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Token[] = [];
  for (let i = 0; i < hits.length; ) {
    let end = hits[i].x + hits[i].g.w;
    let text = hits[i].g.ch;
    let j = i + 1;
    for (; j < hits.length && hits[j].y === hits[i].y && Math.abs(hits[j].x - end) <= 1; j++) {
      text += hits[j].g.ch;
      end = hits[j].x + hits[j].g.w;
    }
    out.push({ x: hits[i].x, end, y: hits[i].y, text });
    i = j;
  }
  return out;
}

// ---------- 2. таблиця характеристик ----------

interface Table {
  /** Правий край лівої колонки, верх клітинки нульового рядка, крок рядків — на скріншоті. */
  xl: number;
  y0: number;
  pitch: number;
}

/** Числа, вирівняні по одному правому краю (±1 px), — кандидати в колонки таблиці. */
function columns(tokens: Token[]): Token[][] {
  const nums = tokens.filter((t) => /^\d+(-\d+)?%?$/.test(t.text)).sort((a, b) => a.end - b.end);
  const out: Token[][] = [];
  for (const t of nums) {
    const last = out[out.length - 1];
    if (last && t.end - last[last.length - 1].end <= 1) last.push(t);
    else out.push([t]);
  }
  return out.filter((c) => c.length >= MIN_COLUMN);
}

/** Спробувати скласти таблицю з двох колонок: рядки з рівним кроком і пропуск на місці рядка з одиницями. */
function tableOf(left: Token[], right: Token[]): (Table & { rows: number }) | null {
  const xl = Math.round(left.reduce((n, t) => n + t.end, 0) / left.length);
  const xr = Math.round(right.reduce((n, t) => n + t.end, 0) / right.length);
  // Сусідні колонки бувають зсунуті на піксель, тож рядок — це номер, а не точний y.
  const ys = [...left, ...right].map((t) => t.y).sort((a, b) => a - b);
  const top = ys[0];
  let best: (Table & { rows: number }) | null = null;
  // Між першим і останнім рядком ціле число кроків; пробуємо можливі.
  for (let n = 6; n <= 9; n++) {
    const pitch = (ys[ys.length - 1] - top) / n;
    const scale = pitch / REF.pitch;
    if (scale < MIN_SCALE || scale > MAX_SCALE) continue;
    if (Math.abs(xr - xl - (REF.xr - REF.xl) * scale) > 4) continue;
    const idx = ys.map((y) => Math.round((y - top) / pitch));
    if (ys.some((y, i) => Math.abs(y - top - idx[i] * pitch) > 2)) continue;
    const have = new Set(idx);
    // Єдиний пропуск усередині — рядок із одиницями виміру; за ним визначаємо номер першого рядка.
    const gaps: number[] = [];
    for (let i = 1; i < n; i++) if (!have.has(i)) gaps.push(i);
    if (gaps.length !== 1 || gaps[0] > UNIT_ROW) continue;
    const first = UNIT_ROW - gaps[0];
    // Верх нульового рядка — середнє по всіх числах, а не один (можливо зсунутий) рядок.
    const y0 = ys.reduce((sum, y, i) => sum + y - (idx[i] + first) * pitch, 0) / ys.length;
    if (!best || have.size > best.rows) best = { xl, y0, pitch, rows: have.size };
  }
  return best;
}

function findTable(tokens: Token[]): Table | null {
  const cols = columns(tokens);
  let best: (Table & { rows: number }) | null = null;
  for (const left of cols) {
    for (const right of cols) {
      if (right[0].end <= left[0].end) continue;
      const t = tableOf(left, right);
      if (t && (!best || t.rows > best.rows)) best = t;
    }
  }
  return best;
}

// ---------- 3. поля ----------

/** Текст числа в прямокутнику поля або null, якщо числа немає чи воно прочитане не повністю. */
function readField(shot: Raster, font: FontKey, x: number, y: number, w: number): string | null {
  const h = FONTS[font].h;
  const ink = inkBox(shot, { x, y: y - Y_SLACK, w, h: h + 2 * Y_SLACK });
  if (!ink) return null;
  let best: Hit[] = [];
  let bestSum = 0;
  for (let top = 0; top <= 2 * Y_SLACK; top++) {
    const all: Hit[] = [];
    for (const g of GLYPHS[font]) {
      for (let i = 0; i + g.w <= w; i++) {
        const score = match(ink, w, i, top, g, h);
        if (score >= MIN_GLYPH) all.push({ x: i, y: top, g, score });
      }
    }
    const hits = prune(all, h).sort((a, b) => a.x - b.x);
    const sum = hits.reduce((n, k) => n + k.score, 0);
    if (sum > bestSum) {
      best = hits;
      bestSum = sum;
    }
  }
  if (!best.length) return null;
  // Число — ланцюжок символів упритул один до одного; далі (після пробілу) можуть іти одиниці виміру.
  const top = best[0].y;
  let end = best[0].x + best[0].g.w;
  let text = best[0].g.ch;
  for (let i = 1; i < best.length && Math.abs(best[i].x - end) <= 1; i++) {
    text += best[i].g.ch;
    end = best[i].x + best[i].g.w;
  }
  // Штрих упритул зліва чи справа від ланцюжка — невпізнаний символ: число неповне.
  const busy = (col: number): boolean => {
    if (col < 0 || col >= w) return false;
    for (let j = 0; j < h; j++) if (ink[(top + j) * w + col] > INK_ON) return true;
    return false;
  };
  // Ліворуч дивимось на цілу клітинку: в «1» штрих стоїть за 2–3 px від правого краю.
  // Праворуч — лише до пробілу (3 px), далі вже одиниці виміру.
  const start = best[0].x;
  for (let k = 1; k <= EDGE_LEFT; k++) if (busy(start - k)) return null;
  for (let k = 0; k < EDGE_RIGHT; k++) if (busy(end + k)) return null;
  return text;
}

function parse(text: string, kind: Kind): number[] | null {
  let m: RegExpExecArray | null;
  if (kind === 'int') return (m = /^(-?\d+)%?$/.exec(text)) ? [Number(m[1])] : null;
  if (kind === 'dec') return (m = /^(\d+(?:\.\d+)?)$/.exec(text)) ? [Number(m[1])] : null;
  if (kind === 'range') return (m = /^(\d+)-(\d+)$/.exec(text)) ? [Number(m[1]), Number(m[2])] : null;
  return (m = /^(\d+)\/(\d+)$/.exec(text)) ? [Number(m[2])] : null;
}

export interface StatsScan {
  ok: true;
  /** Масштаб інтерфейсу гри відносно еталонного (1 = як у шаблонах). */
  scale: number;
  /** Прочитані числа. */
  values: Partial<Record<StatKey, number>>;
  /** Поля, які не вдалося прочитати (обрізані, перекриті або з невідомим символом). */
  unread: StatKey[];
}

/** Скріншот вікна «Персонаж» → числа характеристик. Знімок має бути не стиснутий і не розтягнутий. */
export function scanStats(shot: Raster): StatsScan | ScanFail {
  const table = findTable(findTokens(shot));
  if (!table) {
    return {
      ok: false,
      reason: 'Не знайшов таблицю характеристик. Потрібен скріншот вікна «Персонаж» цілком, без стиснення і збільшення, з чистими (без бафів) числами.',
    };
  }
  const scale = table.pitch / REF.pitch;
  const values: Partial<Record<StatKey, number>> = {};
  const unread: StatKey[] = [];
  for (const f of FIELDS) {
    const x = Math.round(table.xl + (f.x0 - REF.xl) * scale) - X_SLACK;
    const x1 = Math.round(table.xl + (f.x1 - REF.xl) * scale) + X_SLACK;
    const y = Math.round(table.y0 + (f.y - 1 - REF.y0) * scale);
    const text = readField(shot, f.font, x, y, x1 - x);
    const nums = text === null ? null : parse(text, f.kind);
    if (!nums) unread.push(...f.keys);
    else f.keys.forEach((k, i) => (values[k] = nums[i]));
  }
  return { ok: true, scale, values, unread };
}
