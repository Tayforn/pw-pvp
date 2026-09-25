// =========================================================
// Спільне для тестів моделі: каталог і довідники з диска (через хелпери
// тестів ядра), документи з golden-фікстур (фікстура → DollState Хелпера →
// fromCalcDollState) і дрібні конструктори документів «руками».
// =========================================================

import { hydrateFixture, type Fixture } from '../../core/__tests__/hydrateFixture';
import { loadTestRefData, testCatalog } from '../../core/__tests__/testData';
import type { DollState } from '../../core/types';
import { emptyDoc, type Cat, type CharacterDoc, type ItemInst, type SetCfg, type SlotKey } from '../doc';
import { hydrate, type CharacterModel } from '../hydrate';
import { fromCalcDollState } from '../importCalc';

const FX = import.meta.glob('../../core/__tests__/fixtures/*.json', { import: 'default', eager: true }) as Record<string, Fixture[]>;

export const lookup = testCatalog();
export const loadRef = loadTestRefData;

export function fixtures(group: 'manual' | 'random'): Fixture[] {
  const key = Object.keys(FX).find((k) => k.endsWith('/' + group + '.json'));
  if (!key) throw new Error('фікстури ' + group + ' не знайдено');
  return FX[key];
}
export function fixture(name: string): Fixture {
  const fx = [...fixtures('manual'), ...fixtures('random')].find((f) => f.name === name);
  if (!fx) throw new Error('нема фікстури ' + name);
  return fx;
}
/** DollState Хелпера з фікстури (речі — з каталогів pvp). */
export function calcState(name: string): DollState {
  return hydrateFixture(fixture(name), lookup);
}
/** Документ персонажа з фікстури — через імпорт із Хелпера. */
export function docFrom(name: string): CharacterDoc {
  return fromCalcDollState(calcState(name));
}
export function modelFrom(name: string): CharacterModel {
  return hydrate(docFrom(name), lookup);
}

/** Документ руками: речі + слоти Головного + сети. */
export function mkDoc(over: Partial<CharacterDoc> = {}): CharacterDoc {
  return { ...emptyDoc('by'), ...over };
}
export function inst(i: string, cat: Cat, id: number, extra: Partial<ItemInst> = {}): ItemInst {
  return { i, cat, id, ...extra };
}
export function mkSet(id: string, slots: SetCfg['slots'] = {}, kind: SetCfg['kind'] = 'pz', name = 'ПЗ'): SetCfg {
  return { id, name, kind, slots };
}
/** Слоти Головного з фікстури «typical-by» — реальні id речей каталогу. */
export const BY: Record<SlotKey, { cat: Cat; id: number }> = {
  ta: { cat: 'ta', id: 1900 }, rv: { cat: 'rv', id: 391 }, mj: { cat: 'mj', id: 317 }, tg: { cat: 'tg', id: 366 },
  rx: { cat: 'rx', id: 325 }, st: { cat: 'st', id: 303 }, ft: { cat: 'ft', id: 83 }, wy: { cat: 'wy', id: 40 },
  vx: { cat: 'vx', id: 236 }, cr: { cat: 'oq', id: 284 }, cd: { cat: 'oq', id: 280 }, qn: { cat: 'qn', id: 109 },
  pp: { cat: 'pp', id: 146 }, pk: { cat: 'pk', id: 1 }, gv: { cat: 'gv', id: 1 }, ic: { cat: 'ic', id: 15 }, it: { cat: 'it', id: 8 },
};
