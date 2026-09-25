// =========================================================
// Golden тултіпа: текст itemTipHtml калькулятора (теги знято, порожні
// рядки-розділювачі відкинуто) має збігатися з buildTipModel().lines.map(text)
// pvp. buildTipModel живе в src/doll/model/tipModel.ts (робить агент T);
// доки модуля нема — набір пропускається, а не падає.
//
// Формат еталона (golden/tips.json): { [фікстура]: { [слот]: { name, lines } } },
// де name — рядок назви (зірки + назва + «+N» заточки), lines — решта рядків
// зверху вниз: «ур. N», тип, базові стати, вимоги, допи, заточка, камені,
// шліфовка/кристал, гравіювання, комплект.
// =========================================================

import { beforeAll, describe, expect, it } from 'vitest';
import { SLOTS } from '../constants';
import { computeStats } from '../stats';
import type { DollState, Item, TipCtx } from '../types';
import { hydrateFixture, type Fixture } from './hydrateFixture';
import { loadTestRefData, testCatalog } from './testData';
import { pvpWording } from './tipWording';

interface TipLineLike {
  kind: string;
  text: string;
}
interface TipModelLike {
  name: string;
  grade: number;
  lines: TipLineLike[];
}
type BuildTip = (item: Item, cat: string, ctx: TipCtx, build: DollState | null) => TipModelLike;

const TIPS = import.meta.glob('./golden/tips.json', { import: 'default', eager: true }) as Record<string, Record<string, Record<string, { name: string; lines: string[] }>>>;
const FX = import.meta.glob('./fixtures/manual.json', { import: 'default', eager: true }) as Record<string, Fixture[]>;
const tips = Object.values(TIPS)[0];
const manual = Object.values(FX)[0];

// Шлях у змінній + @vite-ignore: Vite не має резолвити модуль на етапі трансформації,
// інакше відсутній файл валить увесь тест-файл замість пропуску.
async function loadBuildTip(): Promise<BuildTip | null> {
  const modulePath = '../../model/tipModel';
  try {
    const m = (await import(/* @vite-ignore */ modulePath)) as { buildTipModel?: BuildTip };
    return typeof m.buildTipModel === 'function' ? m.buildTipModel : null;
  } catch {
    return null;
  }
}
const buildTipModel = await loadBuildTip();

/** Контекст тултіпа надітої речі — як slotTipCtx у calc lib/doll/tooltip.ts. */
function slotTipCtx(build: DollState, key: string): TipCtx {
  return {
    gems: build.gems[key],
    refine: build.refine[key] || 0,
    isBook: key === 'qn',
    isWeapon: key === 'ta',
    engrave: build.engrave[key],
    addons: build.addons[key],
    wdf: build.wdf[key],
    crystal: build.crystal[key],
  };
}

const getItem = testCatalog();
beforeAll(() => loadTestRefData());

describe.skipIf(!buildTipModel)('golden тултіпа речі', () => {
  for (const fx of manual) {
    it(fx.name, () => {
      const build = hydrateFixture(fx, getItem);
      // gearAttr у calc потрібен для червоних вимог; buildTipModel бере його з build сам.
      computeStats(build);
      for (const def of SLOTS) {
        const it = build.equipped[def.slot];
        const exp = tips[fx.name][def.slot];
        if (!it || !exp) continue;
        const model = buildTipModel!(it, def.cat, slotTipCtx(build, def.slot), build);
        const lines = model.lines.map((l) => l.text.replace(/\s+/g, ' ').trim()).filter(Boolean);
        expect(lines, `${fx.name} / ${def.slot} (${it.name})`).toEqual(exp.lines.map(pvpWording));
        expect(exp.name).toContain(model.name);
      }
    });
  }
});
