// =========================================================
// Спільне для тестів сканера: PNG з диска (фікстури і спрайти іконок) і джерело
// каталогу для scanEquip — ті самі JSON і спрайти, що бере застосунок.
// =========================================================

import { existsSync, readFileSync } from 'node:fs';
import { readJson } from '../../core/__tests__/testData';
import type { Item } from '../../core/types';
import type { ScanSource } from '../equip';
import { decodePng } from '../png';
import type { Raster } from '../raster';

const FIXTURES = 'src/doll/scan/__tests__/fixtures/';
const SPRITES = 'src/doll/data/sprites/fe/';

export function loadPng(path: string): Promise<Raster> {
  return decodePng(readFileSync(path));
}
export function fixture(name: string): Promise<Raster> {
  return loadPng(FIXTURES + name);
}

/** Джерело для сканера: каталоги й спрайти потрібних категорій, завантажені наперед. */
export async function testSource(cats: readonly string[]): Promise<ScanSource> {
  const items = new Map<string, Item[]>();
  const sprites = new Map<string, Raster>();
  for (const cat of cats) {
    items.set(cat, readJson<Item[]>(cat));
    for (const g of ['m', 'f'] as const) {
      const gendered = SPRITES + cat + '/' + g + '/' + cat + '-hii.png';
      const plain = SPRITES + cat + '/' + cat + '-hii.png';
      sprites.set(cat + ':' + g, await loadPng(existsSync(gendered) ? gendered : plain));
    }
  }
  return {
    items: (cat) => items.get(cat) ?? null,
    sprite: (cat, gender) => sprites.get(cat + ':' + gender) ?? null,
  };
}
