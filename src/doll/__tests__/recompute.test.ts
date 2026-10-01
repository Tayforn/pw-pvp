// =========================================================
// ЛЯЛЬКА — перерахунок скору v2 зі знімка заявки в адмінці (recompute.ts):
// ті самі бали, що рахує заявка (scoreItems), розклад із checked: true і
// класом/рівнем/джином, невідома версія шкали → поточна з приміткою, знімка
// немає / пошкоджено → зрозуміла помилка; назви речей з каталогу для розкладу.
// Supabase — заглушка, каталоги — з диска через fetch (як у тесті заявки).
// =========================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../app/supabaseClient', () => ({ supabase: { from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) } }));

import { BUILTIN_RULES_VERSION, classPointsFor, normalizeRules, registerRules, registrationScore, rulesFor } from '../../data/gearRules';
import { NO_SNAPSHOT_HINT, recalcSummary } from '../../data/itemPointsRecalc';
import type { PlayerGear } from '../../data/types';
import { readJson } from '../core/__tests__/testData';
import { scoreItems } from '../model/itemScore';
import { docFrom, loadRef, lookup } from '../model/__tests__/testDoc';
import { catalogItemName, docFromSnapshot, ensureBreakdownCats, recomputeFromSnapshot } from '../recompute';

beforeAll(() => {
  loadRef();
  vi.stubGlobal('fetch', async (url: string) => {
    const name = String(url).split('/').pop()!.replace(/[?#].*$/, '').replace(/\.json$/, '');
    return { ok: true, status: 200, json: async () => readJson(name) };
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const rules = rulesFor(BUILTIN_RULES_VERSION);
/** Анкета заявки (legacy-колонки) — джин звідси, як у registrationScore. */
const GEAR: PlayerGear = {
  charClass: 'archer', charLevel: 'l105', build: 'dd', weaponGrade: 'r9', weaponRefine: 'w12', weaponPz: false, armorSet: 'r9', armorRefine: 'a10',
  gems: 'camp', specialSets: [], specialSetGems: {}, tract: 'emperor', genie: 'g91_99', shg: false, shgRefine: null, voznes: false, voznesRefine: null,
  ring1: 'moon', ring1Refine: null, ring2: 'moon', ring2Refine: null,
};

describe('recomputeFromSnapshot', () => {
  it('бали за речі = scoreItems зі знімка; розклад із checked: true, класом за розміром команди, рівнем і джином з анкети', async () => {
    const doc = docFrom('typical-js');
    const r = await recomputeFromSnapshot({ characterSnapshot: doc, gear: GEAR }, { rulesVersion: BUILTIN_RULES_VERSION, teamSize: 3 });
    const expected = scoreItems(doc, rules, lookup);
    expect(r.itemPoints).toBe(expected.itemPoints);
    expect(r.itemPoints).toBe(189.01);
    expect(r.rulesVersion).toBe(BUILTIN_RULES_VERSION);
    expect(r.versionNote).toBeNull();
    expect(r.itemBreakdown.checked).toBe(true);
    expect(r.itemBreakdown.ver).toBe(BUILTIN_RULES_VERSION);
    expect(r.itemBreakdown.sum).toEqual({ cls: classPointsFor(rules, 'archer', 3), lvl: rules.level.l105, genie: rules.genie.g91_99, main: expected.mainTotal, sets: expected.setsCapped, setsRaw: expected.setsRaw, pair: expected.pairBonus });
    expect(r.itemBreakdown.rows.length).toBeGreaterThan(5);
    expect(r.setNames).toEqual(doc.sets.map((s) => s.name));
    expect(JSON.stringify(r.itemBreakdown)).not.toMatch(/NaN|Infinity|undefined/);
    // скор заявки після запису — складові розкладу + бали за речі
    expect(registrationScore({ gear: GEAR, itemPoints: r.itemPoints }, rules, 3)).toBe(Math.round(8 + 10 + 8 + 189.01));
    // без анкети джин — з документа (typical-js його не має → 0)
    const noGear = await recomputeFromSnapshot({ characterSnapshot: doc, gear: null }, { rulesVersion: BUILTIN_RULES_VERSION, teamSize: 3 });
    expect(noGear.itemBreakdown.sum.genie).toBe(0);
    expect(noGear.itemPoints).toBe(189.01);
  });

  it('версія турніру й розмір команди; невідома версія — поточна з приміткою', async () => {
    const doc = docFrom('typical-js');
    const six = normalizeRules({ classPointsBySize: { ...rules.classPointsBySize, '6': { ...rules.classPointsBySize['6'], archer: 2 } } });
    registerRules({ version: 'balance-v9.6', note: 'тест', createdAt: '2026-10-01T00:00:00Z', builtin: false }, six, false);
    const r = await recomputeFromSnapshot({ characterSnapshot: doc, gear: GEAR }, { rulesVersion: 'balance-v9.6', teamSize: 6 });
    expect(r.rulesVersion).toBe('balance-v9.6');
    expect(r.itemBreakdown.ver).toBe('balance-v9.6');
    expect(r.itemBreakdown.sum.cls).toBe(2);
    expect(r.itemBreakdown.checked).toBe(true);
    const unknown = await recomputeFromSnapshot({ characterSnapshot: doc, gear: GEAR }, { rulesVersion: 'balance-v0.0', teamSize: null });
    expect(unknown.rulesVersion).toBe(BUILTIN_RULES_VERSION);
    expect(unknown.versionNote).toMatch(/balance-v0\.0/);
    expect(unknown.itemBreakdown.sum.cls).toBe(8);
  });

  it('знімка немає — «перерахувати неможливо (старий турнір)»; пошкоджений — помилка з поясненням', async () => {
    await expect(recomputeFromSnapshot({ characterSnapshot: null, gear: GEAR }, { rulesVersion: BUILTIN_RULES_VERSION, teamSize: 3 })).rejects.toThrow(NO_SNAPSHOT_HINT);
    await expect(recomputeFromSnapshot({ characterSnapshot: { v: 99 }, gear: GEAR }, { rulesVersion: BUILTIN_RULES_VERSION, teamSize: 3 })).rejects.toThrow(/пошкоджено/);
    expect(docFromSnapshot(null)).toBeNull();
    expect(docFromSnapshot(undefined)).toBeNull();
    expect(() => docFromSnapshot('not json')).toThrow(/пошкоджено/);
    expect(docFromSnapshot(docFrom('typical-js'))?.cls).toBe('js');
  });

  it('catalogItemName: назва з каталогу за слотом розкладу (кільця — категорія oq); невідоме — null', async () => {
    const doc = docFrom('typical-js');
    const r = await recomputeFromSnapshot({ characterSnapshot: doc, gear: GEAR }, { rulesVersion: BUILTIN_RULES_VERSION, teamSize: 3 });
    await ensureBreakdownCats(r.itemBreakdown);
    for (const row of r.items.main) expect(catalogItemName(row.catId, row.slot), row.slot).toBe(row.name);
    const ring = r.items.main.find((row) => row.slot === 'cr' || row.slot === 'cd');
    if (ring) expect(catalogItemName(ring.catId, ring.slot)).toBe(ring.name);
    expect(catalogItemName(1902, 'zz')).toBeNull();
    expect(catalogItemName(-1, 'ta')).toBeNull();
  });
});

describe('recalcSummary — підсумок для адміна', () => {
  it('розбіжність, збіг, перехід з таблиці; примітка про версію', () => {
    expect(recalcSummary({ prev: 268.68, next: 270.1, prevScore: 294, nextScore: 296, versionNote: null })).toBe('Перераховано: бали за речі 268.68 → 270.1 (скор 294 → 296)');
    expect(recalcSummary({ prev: 268.68, next: 268.68, prevScore: 294, nextScore: 294, versionNote: null })).toBe('Перераховано: збігається — 268.68 б. (скор 294)');
    expect(recalcSummary({ prev: null, next: 268.68, prevScore: 262, nextScore: 294, versionNote: null })).toBe('Перераховано: було за таблицею (скор 262) → бали за речі 268.68 (скор 294)');
    expect(recalcSummary({ prev: 1, next: 2, prevScore: null, nextScore: null, versionNote: 'версії немає' })).toBe('Перераховано: бали за речі 1 → 2 (скор — → —); версії немає');
  });
});
