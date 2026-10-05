// =========================================================
// СКАН СКРІНШОТІВ — вікно спорядження: знайти сітку слотів і впізнати речі за
// іконками. Сітка в грі та сама, що на ляльці (3 колонки, фігура, 3 колонки;
// 4 рядки), плюс слоти, яких лялька не моделює (мода тощо) — їх пропускаємо.
//
// Сітку шукаємо за рамкою слота: довкола кожної іконки 32×32 йдуть три лінії
// «темна · світла · темна». Це не залежить від того, що лежить у слоті, тож
// працює і на обрізаному скріншоті, і на знімку всього екрана. Іконку звіряємо
// зі спрайтами каталогу (ті самі, що малює лялька) за середнім квадратом різниці.
//
// Одна іконка буває в кількох речей каталогу — тоді повертаємо всіх кандидатів,
// а вибір лишаємо звірці з лялькою (reconcile.ts).
// =========================================================

import { XZ } from '../core/constants';
import { classRestriction, num } from '../core/stats';
import type { Item } from '../core/types';
import { SLOT_CAT, type SlotKey } from '../model/doc';
import { crop, luminance, resample, type Raster, type Rect } from './raster';

/** Сторона іконки, px. */
export const ICON = 32;
/** Зсуви колонок і рядків сітки від лівого верхнього слота, px (масштаб 1:1). */
const COL_X = [0, 38, 76, 189, 227, 265];
const ROW_Y = [0, 45, 90, 135];
/** Який слот ляльки в якій клітинці гри; null — слот, якого лялька не має. */
const GRID: Array<Array<SlotKey | null>> = [
  [null, null, 'ic', null, 'ft', null],
  ['vx', 'wy', 'qn', null, 'rv', 'gv'],
  ['mj', 'st', 'pp', null, 'tg', 'ta'],
  ['cr', 'cd', 'pk', null, 'rx', 'it'],
];

/** Рамка слота — три кільця довкола іконки на відстані 1, 2 і 3 px. */
const FRAME = 3;
/** Мінімум видимих клітинок, щоб вважати сітку знайденою (решту могли обрізати). */
const MIN_CELLS = 12;
/** Найбільший внесок одного боку рамки в бал клітинки. */
const SIDE_MAX = 40;
/** Мінімальний середній бал рамки по видимих клітинках (максимум — 4 × SIDE_MAX). */
const MIN_FRAME = 60;
/** Скільки положень сітки перевіряємо іконками і наскільки вони можуть бути гірші за найкраще. */
const MAX_HITS = 6;
const HIT_SHARE = 0.7;
/** Масштаб інтерфейсу в грі довільний (у різних гравців 1.00, 1.04…), а рамка
 * слота — лінії в 1 px, тож сітку видно лише коли масштаб вгадано до ±0.005.
 * Перебираємо з цим кроком; далі уточнюємо довкола найкращих. */
const SWEEP = { from: 0.9, to: 1.3, step: 0.005 };
/** Великі масштаби (збільшення Windows), які пробуємо окремо. */
const BIG_SCALES = [1.5, 1.75, 2];
const REFINE = { span: 0.004, step: 0.002 };
/** Скільки найкращих за рамкою масштабів перевіряємо іконками. */
const SCALE_PICKS = 3;
/** З підказкою масштабу (зі скріншота характеристик) шукаємо лише довкола неї. */
const HINT_SPAN = 0.02;
/** Скільки речей має впізнатись у масштабі 1:1, щоб не перебирати інші. */
const ENOUGH_ITEMS = 3;

/** Поля іконки, які не порівнюємо: рамка іконки відрізняється від спрайта. */
const PAD = 4;
/** У боєприпасів знизу намальована кількість — порівнюємо лише верх іконки. */
const AMMO_ROWS = 18;
/** Найбільша похибка, з якою збіг ще вважаємо збігом. */
export const MAX_ERR = 2500;
/** У скільки разів друга за схожістю іконка має бути гіршою. */
const MIN_RATIO = 1.8;
/** Межі «впевненого» збігу. */
const SURE_ERR = 600;
const SURE_RATIO = 3;
/** Порожній слот у грі сірий: середня насиченість нижча за цю межу. */
const EMPTY_CHROMA = 14;

/** Звідки сканер бере каталог і спрайти (у браузері — catalog.ts і assets.ts). */
export interface ScanSource {
  /** Речі категорії каталогу; null — категорія не завантажена. */
  items(cat: string): readonly Item[] | null;
  /** Спрайт категорії: 6 колонок по 32 px, індекс іконки — поле `an` речі. */
  sprite(cat: string, gender: 'm' | 'f'): Raster | null;
}

export interface ScanSlot {
  slot: SlotKey;
  /** item — річ упізнано; empty — слот порожній; unknown — щось лежить, але в каталозі такої іконки немає. */
  state: 'item' | 'empty' | 'unknown';
  /** Чи збіг однозначний (мала похибка і великий відрив від наступної іконки). */
  sure: boolean;
  /** Індекс найсхожішої іконки у спрайті (−1, якщо порівнювати не було з чим). */
  an: number;
  /** Похибка найкращого збігу і наступного за ним. */
  err: number;
  next: number;
  /** id речей каталогу з цією іконкою (звужено за класом і рівнем, якщо їх передано). */
  ids: number[];
}

export interface EquipScan {
  ok: true;
  /** Масштаб скріншота відносно рідного інтерфейсу (1 = іконки по 32 px). */
  scale: number;
  /** Лівий верхній кут першого слота на скріншоті, приведеному до 1:1. */
  x: number;
  y: number;
  /** Скільки клітинок сітки видно на скріншоті (з 24). */
  cells: number;
  /** Стать, за спрайтами якої впізнано броню. */
  gender: 'm' | 'f';
  slots: Record<SlotKey, ScanSlot>;
}
export interface ScanFail {
  ok: false;
  reason: string;
}

export interface EquipOpts {
  gender?: 'm' | 'f';
  /** Масштаб інтерфейсу, якщо він відомий (scanStats повертає його) — пошук буде швидший. */
  scale?: number;
  /** Клас і рівень персонажа — щоб відкинути речі, які він не може носити. */
  cls?: string;
  level?: number;
}

interface GridHit {
  x: number;
  y: number;
  cells: number;
  score: number;
}

/** Бал рамки для кожної можливої позиції іконки (0 — рамки немає або клітинка не
 * влазить у кадр) і прапорець «клітинка в кадрі». З кожного боку беремо світлу
 * лінію мінус яскравішу з двох темних; лінії рахуються через префіксні суми. */
function frameMap(r: Raster): { score: Float32Array; inside: Uint8Array } {
  const { w, h } = r;
  const lum = luminance(r);
  const rw = w + 1;
  const ch = h + 1;
  const rowP = new Float64Array(rw * h); // rowP[y*rw + x] — сума рядка y до x (не включно)
  const colP = new Float64Array(ch * w); // colP[x*ch + y] — сума стовпця x до y (не включно)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rowP[y * rw + x + 1] = rowP[y * rw + x] + lum[y * w + x];
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) colP[x * ch + y + 1] = colP[x * ch + y] + lum[y * w + x];
  const score = new Float32Array(w * h);
  const inside = new Uint8Array(w * h);
  // Середні яскравості ліній на відстані 1, 2, 3 px: [верх, низ, ліво, право].
  const m = [new Float64Array(4), new Float64Array(4), new Float64Array(4)];
  for (let y = FRAME; y + ICON + FRAME <= h; y++) {
    for (let x = FRAME; x + ICON + FRAME <= w; x++) {
      for (let d = 1; d <= FRAME; d++) {
        const x0 = x - d;
        const x1 = x + ICON + d; // не включно
        const y0 = y - d;
        const y1 = y + ICON + d; // не включно
        const len = ICON + 2 * d;
        const md = m[d - 1];
        md[0] = (rowP[y0 * rw + x1] - rowP[y0 * rw + x0]) / len;
        md[1] = (rowP[(y1 - 1) * rw + x1] - rowP[(y1 - 1) * rw + x0]) / len;
        md[2] = (colP[x0 * ch + y1] - colP[x0 * ch + y0]) / len;
        md[3] = (colP[(x1 - 1) * ch + y1] - colP[(x1 - 1) * ch + y0]) / len;
      }
      // Кожен бік дає не більше SIDE_MAX, тож високий бал означає рамку з усіх
      // чотирьох боків, а не одну дуже контрастну лінію.
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const dark = m[0][k] > m[2][k] ? m[0][k] : m[2][k];
        const c = m[1][k] - dark;
        if (c > 0) sum += c < SIDE_MAX ? c : SIDE_MAX;
      }
      score[y * w + x] = sum;
      inside[y * w + x] = 1;
    }
  }
  return { score, inside };
}

/**
 * Можливі положення сітки на растрі 1:1, найкращі спершу. Їх кілька, бо рамка
 * слота періодична: через 3 px праворуч іде ще одна світла лінія, і зсунута
 * сітка набирає майже той самий бал. Яке положення справжнє, вирішують іконки.
 */
function findGrids(r: Raster): GridHit[] {
  const { w, h } = r;
  if (w < ICON + 2 * FRAME || h < ICON + 2 * FRAME) return [];
  const { score, inside } = frameMap(r);
  const offX = COL_X[COL_X.length - 1];
  const offY = ROW_Y[ROW_Y.length - 1];
  // Сума по 24 клітинках розкладається: спершу по колонках сітки, потім по рядках.
  // Сітка може виходити за кадр ліворуч і вгору, тому початок зсунуто на offX, offY.
  const pw = w + offX;
  const ph = h + offY;
  const rowSum = new Float32Array(pw * h);
  const rowCnt = new Uint8Array(pw * h);
  for (let y = 0; y < h; y++) {
    for (const dx of COL_X) {
      // клітинка на x = ox + dx, де ox = i − offX
      const shift = offX - dx;
      for (let x = 0; x < w; x++) {
        rowSum[y * pw + x + shift] += score[y * w + x];
        rowCnt[y * pw + x + shift] += inside[y * w + x];
      }
    }
  }
  const sum = new Float32Array(pw * ph);
  const cnt = new Uint8Array(pw * ph);
  for (const dy of ROW_Y) {
    const shift = offY - dy;
    for (let y = 0; y < h; y++) {
      const src = y * pw;
      const dst = (y + shift) * pw;
      for (let i = 0; i < pw; i++) {
        sum[dst + i] += rowSum[src + i];
        cnt[dst + i] += rowCnt[src + i];
      }
    }
  }
  const all: GridHit[] = [];
  for (let j = 0; j < ph; j++) {
    for (let i = 0; i < pw; i++) {
      const cells = cnt[j * pw + i];
      const total = sum[j * pw + i];
      if (cells >= MIN_CELLS && total >= MIN_FRAME * cells) all.push({ x: i - offX, y: j - offY, cells, score: total });
    }
  }
  all.sort((p, q) => q.score - p.score);
  const out: GridHit[] = [];
  for (const c of all) {
    if (out.length >= MAX_HITS || c.score < all[0].score * HIT_SHARE) break;
    // Сусідні на піксель положення — та сама сітка; беремо лише вершини.
    if (!out.some((o) => Math.abs(o.x - c.x) <= 1 && Math.abs(o.y - c.y) <= 1)) out.push(c);
  }
  return out;
}

/** Середній квадрат різниці іконки на скріншоті й іконки `an` у спрайті. */
function iconErr(shot: Raster, sx: number, sy: number, sprite: Raster, an: number, rows: number): number {
  const px = (an % 6) * ICON;
  const py = Math.floor(an / 6) * ICON;
  let sum = 0;
  for (let y = PAD; y < rows; y++) {
    let a = ((sy + y) * shot.w + sx + PAD) * 4;
    let b = ((py + y) * sprite.w + px + PAD) * 4;
    for (let x = PAD; x < ICON - PAD; x++, a += 4, b += 4) {
      const dr = shot.data[a] - sprite.data[b];
      const dg = shot.data[a + 1] - sprite.data[b + 1];
      const db = shot.data[a + 2] - sprite.data[b + 2];
      sum += dr * dr + dg * dg + db * db;
    }
  }
  return sum / ((rows - PAD) * (ICON - 2 * PAD) * 3);
}

/** Скільки найсхожіших іконок перевіряємо в рідному масштабі скріншота. */
const RESCORE_TOP = 5;
/** Зсуви іконки в рідному масштабі: спершу ±2 px кроком у пів пікселя, далі чверть пікселя довкола найкращого. */
const SHIFT = { span: 2, step: 0.5, fine: 0.25 };

/**
 * Похибка іконки на нерозтягнутому скріншоті: спрайт розтягуємо в k разів так
 * само, як гра (білінійно), і підбираємо зсув до чверті пікселя. Точніше за
 * порівняння на зменшеній копії скріншота: там картинку розмито двічі, і схожі
 * речі (емблеми різних кольорів) перестають розрізнятись.
 */
function iconErrScaled(shot: Raster, x0: number, y0: number, k: number, sprite: Raster, an: number, rows: number): number {
  const px = (an % 6) * ICON;
  const py = Math.floor(an / 6) * ICON;
  const bx = Math.round(x0);
  const by = Math.round(y0);
  const lo = Math.ceil(PAD * k) + 1;
  const hiX = Math.floor((ICON - PAD) * k) - 1;
  const hiY = Math.floor(rows * k) - 1;
  if (bx + lo < 0 || by + lo < 0 || bx + hiX > shot.w || by + hiY > shot.h) return Infinity;
  const n = hiX - lo;
  const i0 = new Int32Array(n);
  const wx = new Float32Array(n);
  const at = (ox: number, oy: number): number => {
    for (let i = 0; i < n; i++) {
      const u = Math.min(ICON - 1, Math.max(0, (lo + i + 0.5 - (x0 - bx) - ox) / k - 0.5));
      i0[i] = Math.min(ICON - 2, Math.floor(u));
      wx[i] = u - i0[i];
    }
    let sum = 0;
    for (let j = lo; j < hiY; j++) {
      const v = Math.min(ICON - 1, Math.max(0, (j + 0.5 - (y0 - by) - oy) / k - 0.5));
      const j0 = Math.min(ICON - 2, Math.floor(v));
      const wy = v - j0;
      const rowA = ((py + j0) * sprite.w + px) * 4;
      const rowB = rowA + sprite.w * 4;
      let a = ((by + j) * shot.w + bx + lo) * 4;
      for (let i = 0; i < n; i++, a += 4) {
        const p = rowA + i0[i] * 4;
        const q = rowB + i0[i] * 4;
        for (let c = 0; c < 3; c++) {
          const top = sprite.data[p + c] * (1 - wx[i]) + sprite.data[p + 4 + c] * wx[i];
          const bot = sprite.data[q + c] * (1 - wx[i]) + sprite.data[q + 4 + c] * wx[i];
          const d = shot.data[a + c] - (top * (1 - wy) + bot * wy);
          sum += d * d;
        }
      }
    }
    return sum;
  };
  let best = Infinity;
  let bestX = 0;
  let bestY = 0;
  for (let oy = -SHIFT.span; oy <= SHIFT.span; oy += SHIFT.step) {
    for (let ox = -SHIFT.span; ox <= SHIFT.span; ox += SHIFT.step) {
      const e = at(ox, oy);
      if (e < best) {
        best = e;
        bestX = ox;
        bestY = oy;
      }
    }
  }
  for (const dy of [-SHIFT.fine, 0, SHIFT.fine]) for (const dx of [-SHIFT.fine, 0, SHIFT.fine]) if (dx || dy) best = Math.min(best, at(bestX + dx, bestY + dy));
  return best / ((hiY - lo) * n * 3);
}

/** Середня насиченість (max − min каналів) внутрішньої частини клітинки. */
function chroma(shot: Raster, sx: number, sy: number): number {
  let sum = 0;
  for (let y = PAD; y < ICON - PAD; y++) {
    let a = ((sy + y) * shot.w + sx + PAD) * 4;
    for (let x = PAD; x < ICON - PAD; x++, a += 4) {
      const r = shot.data[a];
      const g = shot.data[a + 1];
      const b = shot.data[a + 2];
      sum += Math.max(r, g, b) - Math.min(r, g, b);
    }
  }
  return sum / ((ICON - 2 * PAD) * (ICON - 2 * PAD));
}

/** Чи може персонаж носити річ (обмеження класу і рівня; невідоме — не заважає). */
function wearable(it: Item, opts: EquipOpts): boolean {
  const sm = opts.cls ? XZ[opts.cls] : 0;
  const cls = classRestriction(it);
  if (sm && cls && !cls.includes(sm)) return false;
  if (opts.level && num(it.oj) > opts.level) return false;
  return true;
}

function scanSlot(
  shot: Raster,
  cx: number,
  cy: number,
  slot: SlotKey,
  src: ScanSource,
  gender: 'm' | 'f',
  opts: EquipOpts,
  orig: Raster,
): ScanSlot {
  const none: ScanSlot = { slot, state: 'unknown', sure: false, an: -1, err: Infinity, next: Infinity, ids: [] };
  if (cx < 0 || cy < 0 || cx + ICON > shot.w || cy + ICON > shot.h) return none; // клітинку обрізано
  const cat = SLOT_CAT[slot];
  const items = src.items(cat);
  const sprite = src.sprite(cat, gender);
  const gray = chroma(shot, cx, cy) < EMPTY_CHROMA;
  if (!items || !sprite) return { ...none, state: gray ? 'empty' : 'unknown' };

  const rows = slot === 'it' ? AMMO_ROWS : ICON - PAD;
  const maxAn = Math.floor(sprite.h / ICON) * 6;
  const byAn = new Map<number, number>();
  for (const it of items) {
    const an = Number(it.an);
    if (Number.isInteger(an) && an >= 0 && an < maxAn && !byAn.has(an)) byAn.set(an, Infinity);
  }
  // Іконка в грі буває зсунута на піксель відносно сітки — беремо найкращий зі зсувів.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const sx = cx + dx;
      const sy = cy + dy;
      if (sx < 0 || sy < 0 || sx + ICON > shot.w || sy + ICON > shot.h) continue;
      for (const [an, cur] of byAn) {
        const e = iconErr(shot, sx, sy, sprite, an, rows);
        if (e < cur) byAn.set(an, e);
      }
    }
  }
  // Скріншот не 1:1 — найсхожіші іконки переміряємо на оригіналі, без подвійного розмиття.
  if (orig !== shot) {
    const k = orig.w / shot.w;
    const top = [...byAn].sort((a, b) => a[1] - b[1]).slice(0, RESCORE_TOP);
    byAn.clear();
    for (const [an] of top) byAn.set(an, iconErrScaled(orig, cx * k, cy * k, k, sprite, an, rows));
  }
  let an = -1;
  let err = Infinity;
  let next = Infinity;
  for (const [k, e] of byAn) {
    if (e < err) {
      next = err;
      err = e;
      an = k;
    } else if (e < next) next = e;
  }
  const hit = err <= MAX_ERR && next >= err * MIN_RATIO;
  if (!hit) return { ...none, state: gray ? 'empty' : 'unknown', an, err, next };
  const all = items.filter((it) => Number(it.an) === an);
  const fit = all.filter((it) => wearable(it, opts));
  return {
    slot,
    state: 'item',
    sure: err <= SURE_ERR && next >= err * SURE_RATIO,
    an,
    err,
    next,
    ids: (fit.length ? fit : all).map((it) => Number(it.id)),
  };
}

function scanAll(
  shot: Raster,
  hit: GridHit,
  src: ScanSource,
  gender: 'm' | 'f',
  opts: EquipOpts,
  orig: Raster,
  only?: ReadonlySet<SlotKey>,
): Record<SlotKey, ScanSlot> {
  const out = {} as Record<SlotKey, ScanSlot>;
  GRID.forEach((line, row) =>
    line.forEach((slot, colIdx) => {
      if (slot && (!only || only.has(slot))) out[slot] = scanSlot(shot, hit.x + COL_X[colIdx], hit.y + ROW_Y[row], slot, src, gender, opts, orig);
    }),
  );
  return out;
}

/** Якість розпізнавання: більше впізнаних речей краще, далі — менша сумарна похибка. */
function quality(slots: Record<SlotKey, ScanSlot>): number {
  let q = 0;
  for (const s of Object.values(slots)) if (s.state === 'item') q += 1 - s.err / (MAX_ERR * 100);
  return q;
}

interface Found {
  /** Скріншот, приведений до 1:1, і оригінал (той самий обʼєкт, якщо масштаб 1). */
  img: Raster;
  orig: Raster;
  scale: number;
  hit: GridHit;
  slots: Record<SlotKey, ScanSlot>;
  q: number;
}

/** Слоти з малими каталогами: за ними дешево перевірити, чи сітка стоїть на іконках. */
const QUICK: ReadonlySet<SlotKey> = new Set<SlotKey>(['pk', 'it', 'wy', 'vx', 'st', 'qn', 'cr', 'cd']);

/** Найкраще положення сітки на растрі в заданому масштабі (за іконками). */
function bestAt(shot: Raster, scale: number, src: ScanSource, gender: 'm' | 'f', opts: EquipOpts): Found | null {
  const img = scale === 1 ? shot : resample(shot, 1 / scale);
  const grids = findGrids(img);
  if (!grids.length) return null;
  // Спершу швидка перевірка кожного положення; якщо в «швидких» слотах порожньо
  // (персонаж без біжутерії) — порівнюємо положення за всіма слотами.
  let pick = grids[0];
  let pickQ = -1;
  for (const hit of grids) {
    const q = quality(scanAll(img, hit, src, gender, opts, img, QUICK));
    if (q > pickQ) {
      pick = hit;
      pickQ = q;
    }
  }
  if (pickQ >= 1) {
    const slots = scanAll(img, pick, src, gender, opts, shot);
    return { img, orig: shot, scale, hit: pick, slots, q: quality(slots) };
  }
  let best: Found | null = null;
  for (const hit of grids) {
    const slots = scanAll(img, hit, src, gender, opts, shot);
    const q = quality(slots);
    if (!best || q > best.q) best = { img, orig: shot, scale, hit, slots, q };
  }
  return best;
}

/** Бал рамки найкращої сітки в заданому масштабі (0 — сітки не видно). */
function frameScore(shot: Raster, scale: number): number {
  return findGrids(scale === 1 ? shot : resample(shot, 1 / scale))[0]?.score ?? 0;
}

/** Масштаби-кандидати: найкращі за рамкою з переліку, кожен уточнено дрібнішим кроком. */
function pickScales(shot: Raster, list: number[]): number[] {
  const ranked = list
    .map((k) => ({ k, score: frameScore(shot, k) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  const picks: number[] = [];
  for (const c of ranked) {
    if (picks.length >= SCALE_PICKS) break;
    if (picks.some((k) => Math.abs(k - c.k) <= 2 * SWEEP.step)) continue; // сусід уже взятого піка
    let best = c;
    for (let d = -REFINE.span; d <= REFINE.span + 1e-9; d += REFINE.step) {
      const k = Math.round((c.k + d) * 1000) / 1000;
      if (k === c.k) continue;
      const score = frameScore(shot, k);
      if (score > best.score) best = { k, score };
    }
    picks.push(best.k);
  }
  return picks;
}

const steps = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let k = from; k <= to + 1e-9; k += step) out.push(Math.round(k * 1000) / 1000);
  return out;
};

/** Знімок, більший за це, — уже не вирізане вікно, а екран: масштаби на ньому не перебираємо (це десятки секунд). */
const BIG_PX = 700_000;
/** Запас довкола сітки, коли вирізаємо її з великого знімка, px у масштабі 1:1. */
const CROP_PAD = 10;

/** Знайти на великому знімку місце сітки в одному з масштабів — щоб далі працювати лише з ним. */
function locate(shot: Raster, scales: number[]): Rect | null {
  let best: { score: number; rect: Rect } | null = null;
  for (const k of scales) {
    const img = resample(shot, 1 / k);
    const hit = findGrids(img)[0];
    if (!hit || (best && hit.score <= best.score)) continue;
    const f = shot.w / img.w;
    const w = COL_X[COL_X.length - 1] + ICON + 2 * CROP_PAD;
    const h = ROW_Y[ROW_Y.length - 1] + ICON + 2 * CROP_PAD;
    best = { score: hit.score, rect: { x: (hit.x - CROP_PAD) * f, y: (hit.y - CROP_PAD) * f, w: w * f, h: h * f } };
  }
  return best && best.rect;
}

/** Скан одного растра: масштаб 1:1 (або підказаний), великі масштаби і — якщо дозволено — повний перебір. */
function scanWhole(shot: Raster, src: ScanSource, opts: EquipOpts, sweep: boolean): EquipScan | null {
  const first = opts.gender ?? 'm';
  let best: Found | null = null;
  const tryScale = (k: number): void => {
    const f = bestAt(shot, k, src, first, opts);
    if (f && (!best || f.q > best.q)) best = f;
  };
  const enough = (): boolean => !!best && (best as Found).q >= ENOUGH_ITEMS;
  const tryAll = (list: number[]): void => {
    for (const k of list) if (!enough()) tryScale(k);
  };
  if (opts.scale) tryAll(pickScales(shot, steps(opts.scale - HINT_SPAN, opts.scale + HINT_SPAN, SWEEP.step)));
  if (!enough()) tryScale(1);
  if (!enough()) tryAll(pickScales(shot, BIG_SCALES));
  if (!enough() && sweep) tryAll(pickScales(shot, steps(SWEEP.from, SWEEP.to, SWEEP.step)));
  const found = best as Found | null;
  if (!found) return null;

  let gender = first;
  let slots = found.slots;
  if (!opts.gender) {
    const alt = scanAll(found.img, found.hit, src, 'f', opts, found.orig);
    if (quality(alt) > found.q) {
      slots = alt;
      gender = 'f';
    }
  }
  return { ok: true, scale: found.scale, x: found.hit.x, y: found.hit.y, cells: found.hit.cells, gender, slots };
}

const recognized = (scan: EquipScan): number => Object.values(scan.slots).filter((s) => s.state === 'item').length;

/**
 * Скріншот вікна спорядження → речі в слотах. Спершу пробуємо масштаб 1:1 (або
 * підказаний), далі перебираємо масштаби інтерфейсу. Стать, якщо її не задано,
 * визначаємо за тим, чиї спрайти броні схожіші.
 *
 * Знімок усього екрана: з підказкою масштабу знаходимо сітку й далі працюємо з
 * вирізаним шматком; без підказки пробуємо лише 1:1 і збільшення Windows.
 */
export function scanEquip(shot: Raster, src: ScanSource, opts: EquipOpts = {}): EquipScan | ScanFail {
  const fail: ScanFail = { ok: false, reason: 'Не знайшов сітку слотів спорядження. Потрібен скріншот вікна спорядження, не перекритого іншими вікнами.' };
  if (shot.w * shot.h <= BIG_PX) return scanWhole(shot, src, opts, true) ?? fail;

  if (opts.scale) {
    const area = locate(shot, [opts.scale - SWEEP.step, opts.scale, opts.scale + SWEEP.step]);
    const scan = area && scanWhole(crop(shot, area), src, opts, true);
    // Координати сітки — знову відносно всього знімка.
    if (area && scan && recognized(scan) > 0) return { ...scan, x: scan.x + Math.round(area.x / scan.scale), y: scan.y + Math.round(area.y / scan.scale) };
  }
  const scan = scanWhole(shot, src, { ...opts, scale: undefined }, false);
  if (scan && recognized(scan) > 0) return scan;
  return {
    ok: false,
    reason:
      'На великому знімку не знайшов сітку слотів спорядження. Обріж його до вікна спорядження або додай скріншот вікна «Персонаж» — з нього беру масштаб інтерфейсу.',
  };
}

/** Клітинка слота на скріншоті (у його пікселях) — щоб показати гравцеві, що саме побачив сканер. */
export function slotRect(scan: EquipScan, slot: SlotKey): Rect {
  for (let row = 0; row < GRID.length; row++) {
    const colIdx = GRID[row].indexOf(slot);
    if (colIdx >= 0) return { x: (scan.x + COL_X[colIdx]) * scan.scale, y: (scan.y + ROW_Y[row]) * scan.scale, w: ICON * scan.scale, h: ICON * scan.scale };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}
