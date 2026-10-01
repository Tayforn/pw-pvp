// =========================================================
// ЛЯЛЬКА — заявка персонажем (registration.ts): разом із legacy-колонками
// грейдів (з ляльки, без ручної анкети) іде скор v2 — itemPoints і
// item_breakdown за версією шкали турніру, з класом за розміром команди,
// рівнем і джином; складові розкладу сходяться з registrationScore. Заявку
// блокують лише відсутня зброя й порожній слот броні. Бекенд персонажів і
// Supabase — заглушки, каталоги й довідники — з диска через fetch (як у
// димовому тесті сторінки).
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
import { DRAFT_ID, characterForRegistration, draftCharacter, draftForRegistration, submitBlockReason } from '../registration';
import { draftKey } from '../api/draft';

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
/** Блок джина з удачею 100 — 10 балів. */
const GENIE_100 = { level: 105, luck: 100, skills: [] as number[] };
function useDoc(doc: CharacterDoc): CharacterDoc {
  api.rec = { id: 'c1', name: doc.name, cls: doc.cls, level: doc.level, revision: 2, updatedAt: '2026-10-01T00:00:00Z', doc };
  return doc;
}

describe('characterForRegistration: скор v2 у заявці', () => {
  // typical-js (лучник 105): 189.01 балів за речі (itemScore.test); клас 8 (3×3), рівень 10, джин з удачею 100 — 10 → 217.
  it('itemPoints і розклад за поточною версією; sum = клас (3×3) + рівень + джин, сходиться з registrationScore', async () => {
    const doc = useDoc({ ...docFrom('typical-js'), genie: GENIE_100 });
    const r = await characterForRegistration('c1');
    const expected = scoreItems(doc, rules, lookup);
    expect(r.itemPoints).toBe(expected.itemPoints);
    expect(r.itemPoints).toBe(189.01);
    expect(r.rulesVersion).toBe(BUILTIN_RULES_VERSION);
    expect(r.blockReason).toBeNull();
    // legacy-колонки — з ляльки: грейди з речей, джин з блоку джина
    expect(r.result.gear).toMatchObject({ charClass: 'archer', weaponGrade: 'r9', armorSet: 'r9', tract: 'emperor', ring1: 'moon', ring2: 'moon', genie: 'g100' });
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
    useDoc({ ...docFrom('typical-js'), genie: GENIE_100 });
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

  it('без блоку джина заявка подається з джином 0; старий doc.sheet.genie — запасний шлях', async () => {
    useDoc(docFrom('typical-js'));
    const r = await characterForRegistration('c1');
    expect(r.blockReason).toBeNull();
    expect(r.result.gear?.genie).toBe('g60');
    expect(r.itemPoints).toBe(189.01);
    expect(r.itemBreakdown.sum.genie).toBe(0);
    expect(registrationScore({ gear: r.result.gear, itemPoints: r.itemPoints }, rules, 3)).toBe(207);
    // стара анкета: лише джин, грейди в ній ігноруються
    useDoc({ ...docFrom('typical-js'), sheet: { weaponGrade: 'other', armorSet: 'other', tract: 't1_3', genie: 'g81_90', ring1: 'r9r1', ring2: 'r9r1' } });
    const old = await characterForRegistration('c1');
    expect(old.result.gear).toMatchObject({ weaponGrade: 'r9', armorSet: 'r9', tract: 'emperor', ring1: 'moon', ring2: 'moon', genie: 'g81_90' });
    expect(old.itemBreakdown.sum.genie).toBe(rules.genie.g81_90);
    expect(old.itemPoints).toBe(189.01);
  });

  it('блокують лише відсутня зброя (ніде) і порожній слот броні Головного; бали за речі й розклад є і тоді', async () => {
    const base = docFrom('typical-js');
    const main = { ...base.main };
    delete main.ta;
    useDoc({ ...base, main });
    const noWeapon = await characterForRegistration('c1');
    expect(noWeapon.result.gear).toBeNull();
    expect(noWeapon.blockReason).toBe('Заявку не подати: у персонажа немає зброї (ні в Головному, ні в сеті).');
    expect(noWeapon.blockReason).not.toContain('анкет');
    expect(noWeapon.itemPoints).toBeLessThan(189.01);
    expect(noWeapon.itemBreakdown.rows.length).toBeGreaterThan(5);
    expect(registrationScore({ gear: noWeapon.result.gear, itemPoints: noWeapon.itemPoints }, rules, 3)).toBeNull();
    // зброя лише в сеті — заявку подати можна
    useDoc({ ...base, main, sets: [{ id: 's0000a', name: 'ПЗ', kind: 'pz', slots: { ta: base.main.ta! } }] });
    expect((await characterForRegistration('c1')).blockReason).toBeNull();
    // порожній слот броні Головного
    const noArmor = { ...base.main };
    delete noArmor.rv;
    useDoc({ ...base, main: noArmor });
    expect((await characterForRegistration('c1')).blockReason).toBe('Заявку не подати: у Головному порожній слот броні: нагрудник.');
  });

  it('пошкоджений документ — помилка з поясненням', async () => {
    api.rec = { id: 'c1', name: 'x', cls: 'js', level: 105, revision: 1, updatedAt: '', doc: { v: 99 } };
    await expect(characterForRegistration('c1')).rejects.toThrow(/пошкоджено/);
  });
});

describe('чернетка цього браузера (гість без Discord-ролі)', () => {
  /** localStorage-подібне сховище з чернеткою під ключем сторінки /characters/new. */
  function storeWith(doc: unknown) {
    const m = new Map<string, string>();
    if (doc !== undefined) m.set(draftKey('anon', DRAFT_ID), typeof doc === 'string' ? doc : JSON.stringify(doc));
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  }

  it('скор чернетки — той самий, що в збереженого персонажа з тим самим документом', async () => {
    const doc = { ...docFrom('typical-js'), genie: GENIE_100 };
    useDoc(doc);
    const saved = await characterForRegistration('c1');
    const draft = await draftForRegistration({}, storeWith(doc));
    expect(draft.source).toBe('draft');
    expect(saved.source).toBe('saved');
    expect(draft.rec).toMatchObject({ id: DRAFT_ID, name: doc.name, cls: doc.cls, level: doc.level, revision: 0 });
    expect(draft.itemPoints).toBe(saved.itemPoints);
    expect(draft.itemPoints).toBe(189.01);
    expect(draft.itemBreakdown).toEqual(saved.itemBreakdown);
    expect(draft.result.gear).toEqual(saved.result.gear);
    expect(draft.blockReason).toBeNull();
    // версія й розмір команди турніру — так само
    const six = await draftForRegistration({ teamSize: 6 }, storeWith(doc));
    expect(six.itemBreakdown.sum.cls).toBe(classPointsFor(rules, 'archer', 6));
  });

  it('draftCharacter: імʼя, клас, рівень для вибору; порожня, відсутня чи зламана чернетка — null', () => {
    const doc = docFrom('typical-js');
    expect(draftCharacter(storeWith(doc))).toMatchObject({ id: DRAFT_ID, name: doc.name, cls: 'js', level: doc.level, items: doc.items.length });
    expect(draftCharacter(storeWith(undefined))).toBeNull();
    expect(draftCharacter(storeWith('{не json'))).toBeNull();
    expect(draftCharacter(null)).toBeNull();
    expect(draftCharacter(storeWith({ ...doc, name: '', items: [], sets: [], main: {} }))).toBeNull();
  });

  it('без чернетки чи зі зламаною — помилка з поясненням, куди йти', async () => {
    await expect(draftForRegistration({}, storeWith(undefined))).rejects.toThrow(/немає чернетки персонажа/);
    await expect(draftForRegistration({}, storeWith('{"v":99}'))).rejects.toThrow(/пошкоджено/);
  });
});

describe('submitBlockReason', () => {
  it('рядки dollMissing → одне речення без слова «анкета»; порожній список — null', () => {
    expect(submitBlockReason([])).toBeNull();
    expect(submitBlockReason(['зброя'])).toBe('Заявку не подати: у персонажа немає зброї (ні в Головному, ні в сеті).');
    expect(submitBlockReason(['порожній слот броні: нагрудник'])).toBe('Заявку не подати: у Головному порожній слот броні: нагрудник.');
    expect(submitBlockReason(['зброя', 'порожні слоти броні: нагрудник, поножі'])).toBe(
      'Заявку не подати: у персонажа немає зброї (ні в Головному, ні в сеті); у Головному порожні слоти броні: нагрудник, поножі.',
    );
  });
});
