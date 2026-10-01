// =========================================================
// Розкладка полотна сітки (components/bracket/layout.ts) і підбір ширини
// карток під сторінку (BracketView.fitColumns): верхня й нижня сітки — в
// одному полотні (одна прокрутка), гранд-фінал посередині між фіналами
// верхньої й нижньої, лінії від краю картки до краю наступної, картки не
// накладаються, блок переможця й матч за 3-тє — під вирішальним матчем;
// під заголовком першої колонки нижньої — видимий підзаголовок.
// =========================================================

import { describe, expect, it } from 'vitest';
import type { BracketMatch } from '../../data/types';
import { doubleElim, singleElim } from '../../pages/DevBracketPage';
import { fitColumns } from '../BracketView';
import { bracketInfo } from '../bracket/model';
import { CHAMP_GAP, HEAD_GAP, LB_HINT, LB_NOTE, LB_NOTE_H, layoutBracket, type Box, type LayoutDims, type LayoutKind } from '../bracket/layout';

const D: LayoutDims = { cardW: 200, finalW: 224, cardH: 98, colGap: 40, rowGap: 18, headH: 26, champH: 140 };
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const lay = (kind: LayoutKind, ms: BracketMatch[]) => layoutBracket(kind, ms, bracketInfo(ms), D);
const cy = (b: Box) => b.y + b.h / 2;
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Кожна лінія починається на бічному краї своєї картки й закінчується на краї наступної, на висоті їхніх центрів. */
function expectEdgesTouchCards(ms: BracketMatch[], l: ReturnType<typeof lay>) {
  const expected = ms.filter((m) => m.nextMatchId && m.bracketSide !== 'third_place').length;
  expect(l.edges).toHaveLength(expected);
  for (const e of l.edges) {
    const f = l.boxes.get(e.from)!;
    const t = l.boxes.get(e.to)!;
    const m = /^M(\d+) (\d+)H(\d+)V(\d+)H(\d+)$/.exec(e.d);
    expect(m, e.d).not.toBeNull();
    const [x1, y1, , y2, x2] = m!.slice(1).map(Number);
    expect([f.x, f.x + f.w]).toContain(x1);
    expect([t.x, t.x + t.w]).toContain(x2);
    expect(Math.abs(y1 - cy(f))).toBeLessThanOrEqual(1);
    expect(Math.abs(y2 - cy(t))).toBeLessThanOrEqual(1);
  }
}

describe('подвійна елімінація — одне полотно', () => {
  for (const n of [4, 8, 16]) {
    it(`${n} команд: картки не накладаються, лінії доходять до карток`, () => {
      const ms = doubleElim(ids(n));
      const l = lay('double', ms);
      expect(l.boxes.size).toBe(ms.length);
      const boxes = Array.from(l.boxes.values());
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
      expectEdgesTouchCards(ms, l);
      for (const b of boxes) {
        expect(b.x + b.w).toBeLessThanOrEqual(l.width);
        expect(b.y + b.h).toBeLessThanOrEqual(l.height);
      }
    });
  }

  it('нижня сітка — під роздільником, у тих самих колонках; ГФ — посередині між фіналами, у колонці після найдовшої', () => {
    const ms = doubleElim(ids(8));
    const l = lay('double', ms);
    const box = (id: string) => l.boxes.get(id)!;
    expect(l.divider).not.toBeNull();
    for (const m of ms.filter((x) => x.bracketSide === 'winners')) expect(box(m.id).y + box(m.id).h).toBeLessThan(l.divider!);
    for (const m of ms.filter((x) => x.bracketSide === 'losers')) expect(box(m.id).y).toBeGreaterThan(l.divider!);
    expect(box('w1-0').x).toBe(box('l1-0').x);
    expect(box('w2-0').x).toBe(box('l2-0').x);
    const gf = box('gf');
    expect(Math.abs(cy(gf) - (cy(box('w3-0')) + cy(box('l4-0'))) / 2)).toBeLessThanOrEqual(1);
    expect(gf.x).toBeGreaterThan(box('l4-0').x + box('l4-0').w);
    expect(gf.w).toBe(D.finalW);
    // раунди «з підсадкою» в нижній — навпроти свого матчу
    expect(cy(box('l2-0'))).toBe(cy(box('l1-0')));
    // заголовки обох сіток і гранд-фіналу
    const texts = l.heads.map((h) => h.text);
    expect(texts).toContain('Верхня · Раунд 1');
    expect(texts).toContain('Нижня · Раунд 1');
    expect(texts).toContain('Фінал верхньої');
    expect(texts).toContain('Фінал нижньої');
    expect(texts).toContain('Гранд-фінал');
  });

  it('нижня сітка: під заголовком першої колонки — підзаголовок «другий програш — виліт», картки — нижче нього', () => {
    const ms = doubleElim(ids(8));
    const l = lay('double', ms);
    const noted = l.heads.filter((h) => h.note);
    expect(noted).toHaveLength(1);
    const head = noted[0];
    expect(head.text).toBe('Нижня · Раунд 1');
    expect(head.note).toBe(LB_NOTE);
    expect(head.title).toBe(LB_HINT);
    expect(head.sub).toBe('0/2');
    // місце під рядок підзаголовка зарезервовано для всіх колонок нижньої
    const noteBottom = head.y + D.headH + LB_NOTE_H;
    for (const m of ms.filter((x) => x.bracketSide === 'losers')) expect(l.boxes.get(m.id)!.y).toBeGreaterThanOrEqual(noteBottom + HEAD_GAP);
    // і рядок підзаголовка не налазить на картки першої колонки
    const firstCol = ms.filter((x) => x.bracketSide === 'losers' && x.round === 1).map((m) => l.boxes.get(m.id)!);
    expect(Math.min(...firstCol.map((b) => b.y))).toBe(noteBottom + HEAD_GAP);
  });

  it('одинарна сітка — без підзаголовка нижньої', () => {
    expect(lay('mirror', singleElim(ids(8), true)).heads.some((h) => h.note)).toBe(false);
    expect(lay('columns', singleElim(ids(8), false)).heads.some((h) => h.note)).toBe(false);
  });

  it('блок переможця — під гранд-фіналом, лінія від картки до блоку', () => {
    const ms = doubleElim(ids(8));
    const l = lay('double', ms);
    const gf = l.boxes.get('gf')!;
    expect(l.champion?.fromId).toBe('gf');
    expect(l.champion!.box).toMatchObject({ x: gf.x, w: gf.w, y: gf.y + gf.h + CHAMP_GAP, h: D.champH });
    expect(l.champion!.d).toBe(`M${gf.x + gf.w / 2} ${gf.y + gf.h}V${gf.y + gf.h + CHAMP_GAP}`);
    expect(l.height).toBeGreaterThanOrEqual(l.champion!.box.y + D.champH);
  });
});

describe('одинарна елімінація', () => {
  it('дзеркальна: фінал у центрі, половини симетричні, права половина веде лінії справа наліво', () => {
    const ms = singleElim(ids(8), true);
    const l = lay('mirror', ms);
    const box = (id: string) => l.boxes.get(id)!;
    const fin = box('w3-0');
    const left = box('w2-0');
    const right = box('w2-1');
    expect(left.x + left.w).toBeLessThan(fin.x);
    expect(right.x).toBeGreaterThan(fin.x + fin.w);
    expect(fin.x - (left.x + left.w)).toBe(right.x - (fin.x + fin.w));
    expect(cy(fin)).toBe(cy(left));
    expect(cy(left)).toBe(cy(right));
    expect(l.edges.find((e) => e.from === 'w2-1')!.d.startsWith(`M${right.x} `)).toBe(true);
    expectEdgesTouchCards(ms, l);
    // матч за 3-тє — під блоком переможця в колонці фіналу
    const third = box('third');
    expect(third.x).toBe(fin.x);
    expect(third.y).toBeGreaterThan(l.champion!.box.y + l.champion!.box.h);
  });

  it('колонки (старий вигляд): фінал — остання колонка, ширший; без матчу за 3-тє лінії до нього немає', () => {
    const ms = singleElim(ids(8), false);
    const l = lay('columns', ms);
    const fin = l.boxes.get('w3-0')!;
    for (const b of l.boxes.values()) if (b !== fin) expect(b.x).toBeLessThan(fin.x);
    expect(fin.w).toBe(D.finalW);
    expect(l.heads.map((h) => h.text)).toEqual(['Раунд 1', 'Півфінал', 'Фінал']);
    expectEdgesTouchCards(ms, l);
  });
});

describe('fitColumns — картки під ширину сторінки', () => {
  const team = { min: 184, max: 236 };

  it('широко — картки ширші, до максимуму', () => {
    expect(fitColumns(1300, 5, team)).toEqual({ cardW: 223, colGap: 40 });
    expect(fitColumns(2000, 5, team)).toEqual({ cardW: 236, colGap: 40 });
  });

  it('тісніше — спершу звужуються картки, потім проміжки; не вміщається — мінімум і прокрутка', () => {
    expect(fitColumns(1241, 5, team)).toEqual({ cardW: 211, colGap: 40 });
    expect(fitColumns(1072, 5, team)).toEqual({ cardW: 184, colGap: 32 });
    expect(fitColumns(1056, 5, team)).toEqual({ cardW: 184, colGap: 28 });
    expect(fitColumns(360, 5, team)).toEqual({ cardW: 184, colGap: 28 });
    expect(fitColumns(0, 5, team)).toEqual({ cardW: 184, colGap: 40 });
  });
});
