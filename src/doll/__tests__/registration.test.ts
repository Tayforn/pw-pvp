// =========================================================
// ЛЯЛЬКА — заявка персонажем (registration.ts): разом з анкетою (legacy) іде
// скор v2 — itemPoints і item_breakdown за версією шкали турніру, з класом за
// розміром команди, рівнем і джином; складові розкладу сходяться з
// registrationScore. Бекенд персонажів і Supabase — заглушки, каталоги й
// довідники — з диска через fetch (як у димовому тесті сторінки).
// =========================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// rulesStore (версії шкали) тягне клієнт Supabase — у тестах без мережі.
vi.mock('../../app/supabaseClient', () => ({ supabase: { from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) } }));
const api = vi.hoisted(() => ({ rec: null as unknown }));
vi.mock('../api/characters', () => ({
  getCharacter: async (id: string) => {
    if (!api.rec) throw new Error('немає персонажа ' + id);
    return api.rec;
  },
  listCharacters: async () => ({ characters: [], max: 16 }),
}));

import { BUILTIN_RULES_VERSION, classPointsFor, normalizeRules, registerRules, registrationScore, rulesFor } from '../../data/gearRules';
import { readJson } from '../core/__tests__/testData';
import type { CharacterDoc } from '../model/doc';
import { scoreItems } from '../model/itemScore';
import { docFrom, loadRef, lookup } from '../model/__tests__/testDoc';
import { characterForRegistration, submitBlockReason } from '../registration';

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
/** Повна «Анкета для турнірів» — крок C ще бере грейди з неї (gearFromCharacter). */
const SHEET = { weaponGrade: 'r9', armorSet: 'r9', tract: 'emperor', genie: 'g100', ring1: 'moon', ring2: 'moon' } as const;
function useDoc(doc: CharacterDoc): CharacterDoc {
  api.rec = { id: 'c1', name: doc.name, cls: doc.cls, level: doc.level, revision: 2, updatedAt: '2026-10-01T00:00:00Z', doc };
  return doc;
}

describe('characterForRegistration: скор v2 у заявці', () => {
  // typical-js (лучник 105): 189.01 балів за речі (itemScore.test); клас 8 (3×3), рівень 10, джин g100 з анкети 10 → 217.
  it('itemPoints і розклад за поточною версією; sum = клас (3×3) + рівень + джин, сходиться з registrationScore', async () => {
    const doc = useDoc({ ...docFrom('typical-js'), sheet: SHEET });
    const r = await characterForRegistration('c1');
    const expected = scoreItems(doc, rules, lookup);
    expect(r.itemPoints).toBe(expected.itemPoints);
    expect(r.itemPoints).toBe(189.01);
    expect(r.rulesVersion).toBe(BUILTIN_RULES_VERSION);
    expect(r.blockReason).toBeNull();
    expect(r.result.gear).not.toBeNull();
    const b = r.itemBreakdown;
    expect(b.v).toBe(1);
    expect(b.ver).toBe(BUILTIN_RULES_VERSION);
    expect(b.sum).toEqual({ cls: classPointsFor(rules, 'archer', 3), lvl: rules.level.l105, genie: rules.genie.g100, main: expected.mainTotal, sets: expected.setsCapped, setsRaw: expected.setsRaw, pair: expected.pairBonus });
    expect(b.sum).toMatchObject({ cls: 8, lvl: 10, genie: 10 });
    expect(b.rows.length).toBeGreaterThan(5);
    expect(b.rows.every((row) => row[3] > 0)).toBe(true);
    expect(JSON.stringify(b)).not.toMatch(/NaN|Infinity|undefined/);
    // скор заявки = складові розкладу + бали за речі — і так само його порахує жеребка
    const score = registrationScore({ gear: r.result.gear, itemPoints: r.itemPoints }, rules, 3);
    expect(score).toBe(Math.round(b.sum.cls! + b.sum.lvl! + b.sum.genie! + r.itemPoints));
    expect(score).toBe(217);
    // назви речей для розкладу — з результату ляльки; legacy-сила лишається
    expect(r.items.main.find((row) => row.catId === 1902)?.name).toContain('лук');
    expect(r.power.off).toBeGreaterThan(0);
    expect(r.power.def).toBeGreaterThan(0);
  });

  it('версія турніру й розмір команди: клас — за ними; невідома версія — поточна', async () => {
    useDoc({ ...docFrom('typical-js'), sheet: SHEET });
    const six = normalizeRules({ classPointsBySize: { ...rules.classPointsBySize, '6': { ...rules.classPointsBySize['6'], archer: 2 } } });
    registerRules({ version: 'balance-v9.9', note: 'тест', createdAt: '2026-10-01T00:00:00Z', builtin: false }, six, false);
    const r = await characterForRegistration('c1', { rulesVersion: 'balance-v9.9', teamSize: 6 });
    expect(r.rulesVersion).toBe('balance-v9.9');
    expect(r.itemBreakdown.ver).toBe('balance-v9.9');
    expect(r.itemBreakdown.sum.cls).toBe(2);
    expect(registrationScore({ gear: r.result.gear, itemPoints: r.itemPoints }, six, 6)).toBe(Math.round(2 + 10 + 10 + r.itemPoints));
    const unknown = await characterForRegistration('c1', { rulesVersion: 'balance-v0.0', teamSize: null });
    expect(unknown.rulesVersion).toBe(BUILTIN_RULES_VERSION);
    expect(unknown.itemBreakdown.sum.cls).toBe(8);
  });

  it('без анкети — заявку не подати, але бали за речі й розклад є (джин 0 — не заповнено)', async () => {
    useDoc(docFrom('typical-js'));
    const r = await characterForRegistration('c1');
    expect(r.result.gear).toBeNull();
    expect(r.blockReason).toBe('Заявку не подати: не заповнена анкета: грейд зброї, сет броні, трактат, джин, кільце 1, кільце 2.');
    expect(r.itemPoints).toBe(189.01);
    expect(r.itemBreakdown.sum.genie).toBe(0);
    expect(registrationScore({ gear: r.result.gear, itemPoints: r.itemPoints }, rules, 3)).toBeNull();
    // без зброї в Головному — це перша причина
    const base = docFrom('typical-js');
    const main = { ...base.main };
    delete main.ta;
    useDoc({ ...base, main, sheet: SHEET });
    const noWeapon = await characterForRegistration('c1');
    expect(noWeapon.blockReason).toBe('Заявку не подати: у персонажа немає зброї в Головному.');
    expect(noWeapon.itemPoints).toBeLessThan(189.01);
  });

  it('пошкоджений документ — помилка з поясненням', async () => {
    api.rec = { id: 'c1', name: 'x', cls: 'js', level: 105, revision: 1, updatedAt: '', doc: { v: 99 } };
    await expect(characterForRegistration('c1')).rejects.toThrow(/пошкоджено/);
  });
});

describe('submitBlockReason', () => {
  it('зброя/броня на ляльці — окремо від полів анкети; порожній список — null', () => {
    expect(submitBlockReason([])).toBeNull();
    expect(submitBlockReason(['зброя на ляльці', 'броня на ляльці'])).toBe('Заявку не подати: у персонажа немає зброї і броні в Головному.');
    expect(submitBlockReason(['джин'])).toBe('Заявку не подати: не заповнена анкета: джин.');
    expect(submitBlockReason(['зброя на ляльці', 'грейд зброї', 'джин'])).toBe('Заявку не подати: у персонажа немає зброї в Головному (або не заповнена анкета: грейд зброї, джин).');
  });
});
