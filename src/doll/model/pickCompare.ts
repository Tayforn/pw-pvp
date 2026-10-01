// =========================================================
// ЛЯЛЬКА — «Проти надітого» в пікері: що зміниться в похідних числах білда,
// якщо в слот поставити іншу річ (чи інший камінь у гніздо). Чисті функції
// над DollState ядра: кандидат підставляється в копію білда, обидва рахуються
// derivedNumbers без бафів (як скор і дельти сетів), різниця — рядками з
// підписом, знаком і «добре/погано». Кандидат, що не проходить вимоги, у
// ядрі не активний — тоді дельта чесно показує провал, а пікер попереджає.
// =========================================================

import { derivedNumbers } from '../core/derived';
import { computeStats } from '../core/stats';
import type { DollState, Item } from '../core/types';

/** Річ-кандидат зі станом екземпляра (для речі з каталогу — лише заточка й камені, які гравець
 * виставив у блоці «Одразу налаштувати»; для речі з інвентаря — усе, що в неї вже є). */
export interface PickCandidate {
  item: Item;
  refine?: number;
  gems?: Array<Item | null>;
  addons?: Array<{ type: string; val: number }>; // ефективні стати (instStats); порожньо = база каталогу
  engrave?: Array<{ type: string; val: number }>;
  wdf?: Item | null;
  crystal?: Item | null;
}

/** Копія білда з кандидатом у слоті (null — слот порожній). Решта слотів спільна за посиланням. */
export function buildWith(build: DollState, slot: string, cand: PickCandidate | null): DollState {
  const b: DollState = {
    ...build,
    equipped: { ...build.equipped },
    gems: { ...build.gems },
    refine: { ...build.refine },
    addons: { ...build.addons },
    engrave: { ...build.engrave },
    wdf: { ...build.wdf },
    crystal: { ...build.crystal },
  };
  if (!cand) {
    delete b.equipped[slot];
    delete b.gems[slot];
    delete b.refine[slot];
    delete b.addons[slot];
    delete b.engrave[slot];
    delete b.wdf[slot];
    delete b.crystal[slot];
    return b;
  }
  b.equipped[slot] = cand.item;
  b.gems[slot] = cand.gems ? [...cand.gems] : [];
  b.refine[slot] = cand.refine || 0;
  b.addons[slot] = cand.addons ? [...cand.addons] : [];
  b.engrave[slot] = cand.engrave ? [...cand.engrave] : [];
  b.wdf[slot] = cand.wdf ?? null;
  b.crystal[slot] = cand.crystal ?? null;
  return b;
}

export interface CompareRow {
  key: string;
  label: string;
  before: number;
  after: number;
  delta: number;
  digits: number; // знаків після коми у підписі (атак/сек — 2)
  unit: string; // '' або '%'
  good: boolean; // зміна на користь гравця
}

/** Ключові числа для порівняння — ті самі «похідні» ядра, що й у дельтах сетів,
 * плюс шанс криту з тоталів. Атака — середина діапазону, як «сер.» на панелі. */
function keyNumbers(build: DollState): Array<{ key: string; label: string; v: number; digits: number; unit: string }> {
  const { t } = computeStats(build);
  const d = derivedNumbers(build, {}, t);
  return [
    { key: 'physAtk', label: 'Фіз. атака (сер.)', v: (d.physAtkMin + d.physAtkMax) / 2, digits: 0, unit: '' },
    { key: 'magAtk', label: 'Маг. атака (сер.)', v: (d.magAtkMin + d.magAtkMax) / 2, digits: 0, unit: '' },
    { key: 'pa', label: 'Рівень атаки', v: d.pa, digits: 0, unit: '' },
    { key: 'pz', label: 'Рівень захисту', v: d.pz, digits: 0, unit: '' },
    { key: 'hp', label: 'Здоровʼя', v: d.hp, digits: 0, unit: '' },
    { key: 'physDef', label: 'Фіз. захист', v: d.physDef, digits: 0, unit: '' },
    { key: 'magDef', label: 'Маг. захист (сер.)', v: d.magDefAvg, digits: 0, unit: '' },
    { key: 'crit', label: 'Шанс криту', v: t.ed || 0, digits: 0, unit: '%' },
    { key: 'aps', label: 'Атак/сек', v: d.aps, digits: 2, unit: '' },
    { key: 'channel', label: 'Швидкість співу', v: d.channel, digits: 0, unit: '%' },
  ];
}

/** Рядки, де число змінилось (після округлення до digits). Порожньо = «без змін». */
export function compareBuilds(before: DollState, after: DollState): CompareRow[] {
  const a = keyNumbers(before);
  const b = keyNumbers(after);
  const out: CompareRow[] = [];
  for (let i = 0; i < a.length; i++) {
    const p = Math.pow(10, a[i].digits);
    const delta = Math.round((b[i].v - a[i].v) * p) / p;
    if (!delta) continue;
    out.push({ key: a[i].key, label: a[i].label, before: a[i].v, after: b[i].v, delta, digits: a[i].digits, unit: a[i].unit, good: delta > 0 });
  }
  return out;
}

/** «+1 387», «−0,10», «+5%» — знак типографський, число з українським розділювачем. */
export function deltaText(r: CompareRow): string {
  const abs = Math.abs(r.delta);
  const num = r.digits ? abs.toLocaleString('uk', { minimumFractionDigits: r.digits, maximumFractionDigits: r.digits }) : Math.round(abs).toLocaleString('uk');
  return (r.delta > 0 ? '+' : '−') + num + r.unit;
}
