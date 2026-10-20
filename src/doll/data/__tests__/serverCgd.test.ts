// =========================================================
// ЦГД / РЦГД сервера (serverCgd.ts, скріни власника 20.10.2026): під кожною з
// 15 назв каталог має ЦГД (ПА 30) і РЦГД — ті самі стати з ПА 50; зайві копії
// РЦГД сховані з пікера. Падає, якщо ta.json оновили з Хелпера й не прогнали
// scripts/doll-server-cgd.ts.
// =========================================================

import { describe, expect, it } from 'vitest';
import { readJson } from '../../core/__tests__/testData';
import type { Item } from '../../core/types';
import { weaponGradeOf } from '../../model/grades';
import { HIDDEN_FROM_PICK } from '../catalog';
import { CGD_HIDDEN, CGD_ROWS } from '../serverCgd';

const TA = readJson<Item[]>('ta');
const byId = new Map(TA.map((it) => [Number(it.id), it]));
const wu = (it: Item) => ((it.nw as { wu?: Array<{ type: string; val: number }> }).wu ?? []).map((w) => [w.type, w.val]);
/** Стати без ідентичності, іконки, зірок і ПА — мають збігатися в ЦГД і РЦГД. */
function body(it: Item): unknown {
  const { id: _id, pw_id: _pw, an: _an, mi: _mi, pg: _pg, tv: _tv, nw: _nw, ...rest } = it as Record<string, unknown>;
  return { ...rest, wu: wu(it).filter(([t]) => t !== 'ad') };
}

describe('ЦГД і РЦГД як на сервері', () => {
  it('15 назв: ЦГД з ПА 30, усі інші записи — ті самі стати з ПА 50', () => {
    expect(CGD_ROWS).toHaveLength(15);
    for (const row of CGD_ROWS) {
      const cgd = byId.get(row.cgd)!;
      expect(cgd.name, String(row.cgd)).toBe(row.name);
      expect(weaponGradeOf(cgd).grade, row.name).toBe('cgd');
      expect(wu(cgd).filter(([t]) => t === 'ad'), row.name).toEqual([['ad', 30]]);
      for (const id of [row.rcgd, ...row.hidden]) {
        const r = byId.get(id)!;
        expect(r.name, String(id)).toBe(row.name);
        expect(weaponGradeOf(r).grade, `${row.name} ${id}`).toBe('rcgd');
        expect(wu(r).filter(([t]) => t === 'ad'), `${row.name} ${id}`).toEqual([['ad', 50]]);
        expect(body(r), `${row.name} ${id}`).toEqual(body(cgd));
      }
      // інших записів із цією назвою 80 рівня в каталозі немає
      const all = TA.filter((it) => it.name === row.name && Number(it.oj) === 80).map((it) => Number(it.id)).sort((a, b) => a - b);
      expect(all, row.name).toEqual([row.cgd, row.rcgd, ...row.hidden].sort((a, b) => a - b));
    }
  });

  it('стати, звірені зі скрінами гри', () => {
    const at = (id: number) => byId.get(id)!;
    // «Думки Брахми»: час активації −3% (у каталозі Хелпера його не було)
    expect(wu(at(1179))).toContainEqual(['ci', 3]);
    // «Душа Лі Хуа» РЦГД: швидкість 1.11 і «Дальність +2.00», як у ЦГД
    expect(at(2563).sy).toBe(1.11);
    expect(wu(at(2563))).toContainEqual(['fp', 2]);
    expect(at(2562).sy).toBe(1.11); // «Генеральська нагорода»
    // кастети не носять Страж (9) і Містик (10); «Три тисячі квітів» — без обмеження
    expect(at(1175).hi).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(at(2362).hi).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(at(1176).hi).toBeUndefined();
  });

  it('у пікері один РЦГД на назву; зайві копії сховані', () => {
    expect([...HIDDEN_FROM_PICK.ta].sort((a, b) => a - b)).toEqual([...CGD_HIDDEN].sort((a, b) => a - b));
    for (const row of CGD_ROWS) {
      expect(HIDDEN_FROM_PICK.ta.has(row.cgd)).toBe(false);
      expect(HIDDEN_FROM_PICK.ta.has(row.rcgd)).toBe(false);
    }
    expect(HIDDEN_FROM_PICK.pk.has(5)).toBe(true); // «Тао Лі» лишається схованим
  });
});
