// =========================================================
// Дані для тестів ядра: каталоги речей і довідники з src/doll/data/json через
// import.meta.glob (як у data/__tests__), бо @types/node у проєкті нема —
// node:fs у src/** не типізується. Golden-еталони при цьому згенеровано з
// калькулятора (scripts/doll-golden.ts читає ../pw-calc з диска), а тест
// гідратує фікстури вже з каталогів pvp: збіг доводить і формули, і дані.
// =========================================================

import { setRefData } from '../refdata';
import type { Item } from '../types';
import type { GetItem } from './hydrateFixture';

export const CATALOG_CATS = ['ft', 'vx', 'rv', 'st', 'tg', 'rx', 'wy', 'mj', 'oq', 'ta', 'it', 'qn', 'pp', 'pk', 'gv', 'ic', 'ob', 'wdf', 'crystal'];

const JSON_FILES = import.meta.glob('../../data/json/*.json', { import: 'default', eager: true }) as Record<string, unknown>;

export function readJson<T>(name: string): T {
  const key = Object.keys(JSON_FILES).find((k) => k.endsWith('/' + name + '.json'));
  if (!key) throw new Error(`src/doll/data/json/${name}.json не знайдено`);
  return JSON_FILES[key] as T;
}

/** Доступ до речей каталогів за (cat, id) з кешем по категорії. */
export function testCatalog(): GetItem {
  const cache: Record<string, Map<number, Item>> = {};
  return (cat, id) => {
    if (!cache[cat]) {
      const m = new Map<number, Item>();
      for (const it of readJson<Item[]>(cat)) m.set(Number(it.id), it);
      cache[cat] = m;
    }
    return cache[cat].get(id);
  };
}

/** Підставити довідники ядра (те, що в застосунку робить data/refLoader.ts). */
export function loadTestRefData(): void {
  setRefData({
    sets: readJson('sets'),
    buffs: readJson('buffs'),
    debuffs: readJson('debuffs'),
    buffDefaults: readJson('buff-defaults'),
    skills: readJson('skills'),
    fuState: readJson('fustate'),
    labels: readJson('labels'),
  });
}
