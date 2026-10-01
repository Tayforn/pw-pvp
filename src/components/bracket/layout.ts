// =========================================================
// Розкладка турнірної сітки в абсолютних координатах — одне полотно з
// однією прокруткою для всього: верхня й нижня сітки, гранд-фінал, блок
// переможця й матч за 3-тє. Картки стоять у колонках по раундах, центр
// картки — посередині між матчами попереднього раунду, що ведуть у неї
// (nextMatchId); якщо веде один (раунд нижньої з «підсадкою») — навпроти
// нього. Лінії — SVG-шляхи під прямим кутом (картка → злам у проміжку між
// колонками → наступна картка); кожна лінія знає свої «від/до», тож шлях
// команди підсвічується саме своїми відрізками.
//
// Три вигляди:
//  · double  — верхня сітка зверху, нижня під нею в тих самих колонках;
//              гранд-фінал — у колонці після найдовшої з них, по висоті
//              посередині між фіналами верхньої й нижньої (як на макеті B);
//              під заголовком першої колонки нижньої — видимий підзаголовок
//              «другий програш — виліт» (повне пояснення — у title);
//  · columns — одинарна сітка колонками по раундах (старий вигляд);
//  · mirror  — одинарна дзеркальна: половини зліва й справа, фінал у центрі.
// Блок переможця — під вирішальним матчем (там колонка вільна), матч за
// 3-тє — під блоком переможця.
// =========================================================

import type { BracketMatch } from '../../data/types';
import { roundLabel, type BracketInfo } from './model';

export type LayoutKind = 'double' | 'columns' | 'mirror';

export interface LayoutDims {
  cardW: number;
  /** ширина вирішального матчу (гранд-фінал / фінал) і блоку переможця */
  finalW: number;
  /** висота картки — вимірюється з DOM (максимум), тут лише використовується */
  cardH: number;
  colGap: number;
  rowGap: number;
  headH: number;
  /** висота блоку переможця (вимірюється з DOM) */
  champH: number;
}

export interface Box { x: number; y: number; w: number; h: number }

export interface HeadSpec {
  key: string;
  x: number;
  y: number;
  w: number;
  text: string;
  /** «2/4» — зіграно в колонці */
  sub?: string;
  title?: string;
  /** видимий підзаголовок другим рядком під заголовком (перша колонка нижньої сітки) */
  note?: string;
}

export interface EdgeSpec {
  /** `${from}>${to}` — за цим ключем підсвічується шлях */
  key: string;
  from: string;
  to: string;
  d: string;
}

export interface BracketLayout {
  width: number;
  height: number;
  boxes: Map<string, Box>;
  heads: HeadSpec[];
  edges: EdgeSpec[];
  /** y роздільника між верхньою й нижньою сітками (лише double) */
  divider: number | null;
  /** блок переможця під вирішальним матчем + лінія до нього */
  champion: { box: Box; d: string; fromId: string } | null;
}

/** Відступ від заголовка колонки до першої картки. */
export const HEAD_GAP = 8;
/** Проміжок між нижнім краєм верхньої сітки й заголовками нижньої. */
export const SECTION_GAP = 44;
/** Від вирішального матчу до блоку переможця. */
export const CHAMP_GAP = 24;
/** Від блоку переможця до заголовка матчу за 3-тє. */
const THIRD_GAP = 22;
/** Висота рядка-підзаголовка під заголовками нижньої сітки («другий програш — виліт»). */
export const LB_NOTE_H = 16;
/** Підзаголовок першої колонки нижньої сітки (видимий) і повне пояснення (title, aria-describedby). */
export const LB_NOTE = 'другий програш — виліт';
export const LB_HINT = 'Програвший у верхній переходить сюди; другий програш — виліт. Переможець нижньої грає гранд-фінал.';

export const edgeKey = (from: string, to: string): string => `${from}>${to}`;

const played = (list: BracketMatch[]): string => `${list.filter((m) => m.winnerId).length}/${list.length}`;

/** Матчі сторони, згруповані по раундах (за зростанням), кожен раунд — за слотом. */
function byRounds(list: BracketMatch[]): BracketMatch[][] {
  const rounds = Array.from(new Set(list.map((m) => m.round))).sort((a, b) => a - b);
  return rounds.map((r) => list.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot));
}

/** Розставляє раунди однієї сітки: перший раунд (і раунди без звʼязків) —
 * рівномірно, решта — по центру між матчами-«годувальниками». */
function placeRounds(
  rounds: BracketMatch[][],
  xOf: (i: number) => number,
  widthOf: (m: BracketMatch) => number,
  top: number,
  d: LayoutDims,
  boxes: Map<string, Box>,
): { bottom: number; centers: Map<string, number> } {
  const pitch = d.cardH + d.rowGap;
  const maxCount = Math.max(1, ...rounds.map((r) => r.length));
  const height = maxCount * pitch - d.rowGap;
  const centers = new Map<string, number>();
  rounds.forEach((list, i) => {
    const prev = i > 0 ? rounds[i - 1] : [];
    list.forEach((m, s) => {
      const feeders = prev.filter((f) => f.nextMatchId === m.id && centers.has(f.id));
      const c = feeders.length > 0
        ? feeders.reduce((sum, f) => sum + centers.get(f.id)!, 0) / feeders.length
        : top + ((s + 0.5) * (height + d.rowGap)) / list.length - d.rowGap / 2;
      centers.set(m.id, c);
      boxes.set(m.id, { x: xOf(i), y: Math.round(c - d.cardH / 2), w: widthOf(m), h: d.cardH });
    });
  });
  return { bottom: top + height, centers };
}

/** Лінія від матчу до наступного: горизонталь із бічного краю картки, злам
 * посередині проміжку перед цільовою колонкою, горизонталь у ціль. Працює в
 * обидва боки (права половина дзеркальної сітки йде справа наліво). */
export function edgePath(f: Box, t: Box, colGap: number): string {
  const y1 = Math.round(f.y + f.h / 2);
  const y2 = Math.round(t.y + t.h / 2);
  if (t.x >= f.x + f.w) {
    const x1 = f.x + f.w, x2 = t.x, xe = Math.round(x2 - colGap / 2);
    return `M${x1} ${y1}H${xe}V${y2}H${x2}`;
  }
  const x1 = f.x, x2 = t.x + t.w, xe = Math.round(x2 + colGap / 2);
  return `M${x1} ${y1}H${xe}V${y2}H${x2}`;
}

export function layoutBracket(kind: LayoutKind, matches: BracketMatch[], info: BracketInfo, d: LayoutDims): BracketLayout {
  const boxes = new Map<string, Box>();
  const heads: HeadSpec[] = [];
  let divider: number | null = null;
  const winners = matches.filter((m) => m.bracketSide === 'winners');
  const losers = matches.filter((m) => m.bracketSide === 'losers');
  const finalMatch = matches.find((m) => m.bracketSide === 'final') ?? null;
  const third = matches.find((m) => m.bracketSide === 'third_place') ?? null;
  const step = d.cardW + d.colGap;
  const top = d.headH + HEAD_GAP;
  const decisiveId = info.decisive?.id ?? null;
  const widthOf = (m: BracketMatch) => (m.id === decisiveId ? d.finalW : d.cardW);

  if (kind === 'double') {
    const wb = byRounds(winners);
    const lb = byRounds(losers);
    const xOf = (i: number) => i * step;
    wb.forEach((list, i) => {
      const r = list[0].round;
      const label = r === info.wbMax ? 'Фінал верхньої' : `Раунд ${r}`;
      heads.push({ key: `w${r}`, x: xOf(i), y: 0, w: d.cardW, text: i === 0 ? `Верхня · ${label}` : label, sub: played(list) });
    });
    const upper = placeRounds(wb, xOf, widthOf, top, d, boxes);
    let lower: { bottom: number; centers: Map<string, number> } | null = null;
    if (lb.length > 0) {
      divider = Math.round(upper.bottom + SECTION_GAP / 2);
      const lowerHead = upper.bottom + SECTION_GAP;
      lb.forEach((list, i) => {
        const r = list[0].round;
        const label = r === info.lbMax ? 'Фінал нижньої' : `Раунд ${r}`;
        heads.push({
          key: `l${r}`, x: xOf(i), y: lowerHead, w: d.cardW, text: i === 0 ? `Нижня · ${label}` : label, sub: played(list),
          ...(i === 0 ? { title: LB_HINT, note: LB_NOTE } : {}),
        });
      });
      // під заголовками нижньої — рядок підзаголовка (LB_NOTE_H), далі картки
      lower = placeRounds(lb, xOf, widthOf, lowerHead + d.headH + LB_NOTE_H + HEAD_GAP, d, boxes);
    }
    if (finalMatch) {
      const ends: number[] = [];
      const wbFinal = wb[wb.length - 1]?.[0];
      const lbFinal = lb[lb.length - 1]?.[0];
      if (wbFinal) ends.push(upper.centers.get(wbFinal.id)!);
      if (lbFinal && lower) ends.push(lower.centers.get(lbFinal.id)!);
      const cy = ends.length ? ends.reduce((a, b) => a + b, 0) / ends.length : top + d.cardH / 2;
      const box: Box = { x: xOf(Math.max(wb.length, lb.length)), y: Math.round(cy - d.cardH / 2), w: widthOf(finalMatch), h: d.cardH };
      boxes.set(finalMatch.id, box);
      heads.push({ key: 'gf', x: box.x, y: box.y - d.headH - 4, w: box.w, text: 'Гранд-фінал', sub: played([finalMatch]) });
    }
  } else if (kind === 'columns') {
    const rounds = byRounds(winners);
    const xOf = (i: number) => i * step;
    rounds.forEach((list, i) => {
      const r = list[0].round;
      const text = r === info.wbMax ? 'Фінал' : r === info.wbMax - 1 && info.wbMax > 1 ? 'Півфінал' : `Раунд ${r}`;
      heads.push({ key: `w${r}`, x: xOf(i), y: 0, w: widthOf(list[0]), text, sub: played(list) });
    });
    placeRounds(rounds, xOf, widthOf, top, d, boxes);
  } else {
    // Дзеркальна: раунд r ліворуч — колонка r-1; фінал — у центрі; праворуч — дзеркально.
    const k = info.wbMax;
    const half = Math.max(0, k - 1);
    const xOfCol = (col: number) => (col <= half ? col * step : half * step + d.finalW + d.colGap + (col - half - 1) * step);
    const left: BracketMatch[][] = [];
    const right: BracketMatch[][] = [];
    for (let r = 1; r <= half; r++) {
      const list = winners.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot);
      const mid = list.length / 2;
      left.push(list.filter((m) => m.slot < mid));
      right.push(list.filter((m) => m.slot >= mid));
      const label = roundLabel(k - r);
      const both = [...left[r - 1], ...right[r - 1]];
      heads.push({ key: `wl${r}`, x: xOfCol(r - 1), y: 0, w: d.cardW, text: label, sub: played(both) });
      heads.push({ key: `wr${r}`, x: xOfCol(2 * half - r + 1), y: 0, w: d.cardW, text: label });
    }
    const l = placeRounds(left, (i) => xOfCol(i), widthOf, top, d, boxes);
    const rr = placeRounds(right, (i) => xOfCol(2 * half - i), widthOf, top, d, boxes);
    const fin = winners.find((m) => m.round === k);
    if (fin) {
      const ends = [left[half - 1]?.[0], right[half - 1]?.[0]].filter((m): m is BracketMatch => !!m);
      const cs = ends.map((m) => (l.centers.get(m.id) ?? rr.centers.get(m.id))!);
      const cy = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : top + d.cardH / 2;
      boxes.set(fin.id, { x: xOfCol(half), y: Math.round(cy - d.cardH / 2), w: widthOf(fin), h: d.cardH });
      heads.push({ key: 'final', x: xOfCol(half), y: 0, w: widthOf(fin), text: 'Фінал', sub: played([fin]) });
    }
  }

  // Блок переможця — під вирішальним матчем; матч за 3-тє — під блоком переможця.
  let champion: BracketLayout['champion'] = null;
  const dec = decisiveId ? boxes.get(decisiveId) : undefined;
  if (dec && decisiveId) {
    const box: Box = { x: dec.x, y: dec.y + dec.h + CHAMP_GAP, w: dec.w, h: d.champH };
    const cx = Math.round(dec.x + dec.w / 2);
    champion = { box, d: `M${cx} ${dec.y + dec.h}V${box.y}`, fromId: decisiveId };
    if (third) {
      const headY = box.y + box.h + THIRD_GAP;
      heads.push({ key: 'third', x: dec.x, y: headY, w: dec.w, text: 'Матч за 3-тє місце', sub: played([third]) });
      boxes.set(third.id, { x: dec.x, y: headY + d.headH + HEAD_GAP, w: dec.w, h: d.cardH });
    }
  } else if (third) {
    heads.push({ key: 'third', x: 0, y: 0, w: d.cardW, text: 'Матч за 3-тє місце' });
    boxes.set(third.id, { x: 0, y: top, w: d.cardW, h: d.cardH });
  }

  const edges: EdgeSpec[] = [];
  for (const m of matches) {
    if (!m.nextMatchId || m.bracketSide === 'third_place') continue;
    const f = boxes.get(m.id);
    const t = boxes.get(m.nextMatchId);
    if (f && t) edges.push({ key: edgeKey(m.id, m.nextMatchId), from: m.id, to: m.nextMatchId, d: edgePath(f, t, d.colGap) });
  }

  let width = 0;
  let height = 0;
  for (const b of boxes.values()) {
    width = Math.max(width, b.x + b.w);
    height = Math.max(height, b.y + b.h);
  }
  if (champion) height = Math.max(height, champion.box.y + champion.box.h);
  for (const h of heads) width = Math.max(width, h.x + h.w);
  return { width, height: height + 4, boxes, heads, edges, divider, champion };
}
