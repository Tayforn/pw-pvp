import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// rulesStore тягне клієнт Supabase; збереження версії тут підміняємо.
vi.mock('../../app/supabaseClient', () => ({ supabase: {} }));
const saveRulesVersionMock = vi.fn<(rules: unknown, note: string) => Promise<string>>();
vi.mock('../rulesStore', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../rulesStore')>();
  return { ...orig, saveRulesVersion: (rules: unknown, note: string) => saveRulesVersionMock(rules, note) };
});

import { normalizeRules, registerRules, serializeRules, type GearRules } from '../gearRules';
import {
  _resetRulesDraftForTests, draftTiersValid, followCurrentVersion, getRulesDraft, loadDraftVersion, patchBuffs, patchComposition, patchDraft,
  resetDraft, saveDraft, setDraftNote,
} from '../rulesDraftStore';

/** Копія рядка balance_rules «balance-v1.13» (створено 18.09.2026) — версія, якою
 * рахується живий турнір. Збережено ДО появи полів buffs / pairsRule, тож golden
 * перевіряє і те, що normalize старого запису нічого в ньому не змінює. */
const V113_RAW = {
  shg: 15,
  gems: { pa: 26, g10: 4, g11: 8, camp: 40, g0_9: 0, xuan: 14, xuan_pa: 20, xuan_camp: 33 },
  genie: { g60: 0, g100: 10, g61_70: 2, g71_80: 4, g81_90: 6, g91_99: 8 },
  level: { l101: 1, l102: 2, l103: 4, l104: 7, l105: 10, l90_100: 0 },
  rings: { r9: 12, pks: 4, moon: 0, r9r1: 16, silver: 8 },
  tiers: [{ min: 225, tier: 'S' }, { min: 175, tier: 'A' }, { min: 130, tier: 'B' }, { min: 85, tier: 'C' }, { min: null, tier: 'D' }],
  tract: { t6: 5, t7: 8, t8: 15, t1_3: 0, t4_5: 2, emperor: 20 },
  voznes: 10,
  balance: {
    T0: 6,
    T1: 0.05,
    topN: 10,
    roleOf: { archer: 'ranged', cleric: 'support', mystic: 'support', seeker: 'melee', wizard: 'ranged', psychic: 'ranged', assassin: 'melee', barbarian: 'tank', venomancer: 'control', blademaster: 'melee' },
    epsilon: 5,
    weights: { dup: 1000, top: 0.25, role: 3, total: 1 },
    composition: {
      weights: { killer: 30, kpRange: 10, topSupport: 40, twoThreats: 10, topSecondDd: 60 },
      profiles: {
        archer: { amp: 0, kill: 1 }, cleric: { amp: 0.5, kill: 0.2 }, mystic: { amp: 0.5, kill: 0.3 }, seeker: { amp: 0.1, kill: 0.3 }, wizard: { amp: 0, kill: 1 },
        psychic: { amp: 0, kill: 1 }, assassin: { amp: 0, kill: 1 }, barbarian: { amp: 0.5, kill: 0.5 }, venomancer: { amp: 1, kill: 0.2 }, blademaster: { amp: 0.3, kill: 0.5 },
      },
      secondDd: 0.5,
      buildKill: { dd: 1, con: 0.4, hybrid: 0.7 },
      threatMinKill: 0.5,
      topDdMinScore: 225,
      topSupportAllow: 0.6,
    },
  },
  armorSet: { r9: 35, r8r: 22, other: 0, nirvana: 5, nirvana_r8_mix: 14 },
  weaponPz: 15,
  ratingCap: 20,
  armorRefine: { a5: 3, a6: 7, a7: 11, a8: 17, a9: 23, a10: 27, a11: 29, a12: 30, a0_4: 0 },
  specialSets: { pa: 12, pz: 15, aspd: 8 },
  weaponGrade: { r9: 32, cgd: 25, r8r: 10, r9r1: 40, r9r2: 60, rcgd: 45, other: 0, nirvana: 5 },
  ratingWeight: 5,
  weaponRefine: { w10: 12, w11: 18, w12: 25, w0_5: 0, w6_7: 4, w8_9: 8 },
  shgVoznesBonus: 5,
  specialSetsCap: 20,
  hiddenArmorSets: ['r9'],
  specialSetsExtra: 5,
  classPointsBySize: Object.fromEntries(['2', '3', '4', '5', '6'].map((s) => [s, {
    archer: 10, cleric: 10, mystic: 10, seeker: 10, wizard: 10, psychic: 10, assassin: 10, barbarian: 10, venomancer: 10, blademaster: 10,
  }])),
  shgRefinePerLevel: 1,
  specialSetGemsCap: 20,
  ringRefinePerLevel: 1,
  weaponGradeByClass: {
    archer: { r9: 36, cgd: 30, r9r1: 55, r9r2: 80, rcgd: 55 },
    cleric: { r9: 30, cgd: 30, r9r1: 43, r9r2: 80, rcgd: 55 },
    mystic: { r9: 30, cgd: 30, r9r1: 43, r9r2: 80, rcgd: 55 },
    seeker: { r9: 36, cgd: 30, r9r1: 55, r9r2: 80, rcgd: 55 },
    wizard: { r9: 36, cgd: 30, r9r1: 55, r9r2: 80, rcgd: 55 },
    psychic: { r9: 33, cgd: 30, r9r1: 49, r9r2: 80, rcgd: 55 },
    assassin: { r9: 36, cgd: 30, r9r1: 55, r9r2: 80, rcgd: 55 },
    barbarian: { r9: 36, cgd: 30, r9r1: 55, r9r2: 80, rcgd: 55 },
    venomancer: { r9: 30, cgd: 30, r9r1: 43, r9r2: 80, rcgd: 55 },
    blademaster: { r9: 36, cgd: 30, r9r1: 55, r9r2: 80, rcgd: 55 },
  },
  specialSetGemsFactor: 0.5,
  voznesRefinePerLevel: 1,
};

const V113 = 'balance-v1.13';
const json = (r: GearRules) => JSON.stringify(serializeRules(r));

/** Кожне значення сирого запису має бути на своєму місці у серіалізованій версії
 * (нові поля, яких у записі нема, — дозволені: їх додає normalize). */
function expectContains(actual: unknown, raw: unknown, path = ''): void {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    expect(actual, path).toBeTypeOf('object');
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) expectContains((actual as Record<string, unknown>)[k], v, `${path}.${k}`);
  } else {
    expect(actual, path).toEqual(raw);
  }
}

beforeEach(() => {
  registerRules({ version: V113, note: null, createdAt: '2026-09-18T14:16:33Z', builtin: false }, normalizeRules(V113_RAW), true);
  _resetRulesDraftForTests();
  saveRulesVersionMock.mockReset();
});
afterEach(() => _resetRulesDraftForTests());

describe('golden: чернетка з balance-v1.13 серіалізується так само, як сама версія', () => {
  it('normalize(v1.13) зберігає кожне число запису; нові поля отримують дефолти (бафи вимкнено, пари — legacy)', () => {
    const r = normalizeRules(V113_RAW);
    const out = serializeRules(r) as Record<string, unknown>;
    expectContains(out, V113_RAW);
    expect(r.balance.buffs.enabled).toBe(false);
    expect(r.balance.composition.pairsRule).toBe('legacy');
    expect(r.balance.composition.weights.topSupport).toBe(40); // не переписано на рекомендовані 100
    // і жодних зайвих полів: збережений JSON = запис + рівно три нові поля (setsFromDoll, buffs, pairsRule)
    const keys = (o: unknown) => Object.keys(o as object).sort();
    expect(keys(out)).toEqual([...keys(V113_RAW), 'setsFromDoll'].sort());
    expect(r.setsFromDoll).toBe(false); // сети з ляльки — лише коли адмін увімкне
    expect(keys(out.balance)).toEqual([...keys(V113_RAW.balance), 'buffs'].sort());
    expect(keys((out.balance as Record<string, unknown>).composition)).toEqual([...keys(V113_RAW.balance.composition), 'pairsRule'].sort());
  });

  it('стор стартує з поточної версії, і JSON чернетки = JSON версії біт-у-біт', () => {
    const s = getRulesDraft();
    expect(s.base).toBe(V113);
    expect(s.dirty).toBe(false);
    expect(json(s.draft)).toBe(json(normalizeRules(V113_RAW)));
    // чернетка — копія, а не та сама версія з реєстру: правка чернетки версію не чіпає
    patchDraft({ weaponPz: 99 });
    expect(json(normalizeRules(V113_RAW))).toBe(json(normalizeRules(V113_RAW)));
    expect(getRulesDraft().draft.weaponPz).toBe(99);
    resetDraft();
    expect(json(getRulesDraft().draft)).toBe(json(normalizeRules(V113_RAW)));
  });

  it('loadDraftVersion → та сама серіалізація; вбудована v1.0 теж завантажується', () => {
    loadDraftVersion('balance-v1.0');
    expect(getRulesDraft().base).toBe('balance-v1.0');
    loadDraftVersion(V113);
    expect(getRulesDraft().dirty).toBe(false);
    expect(json(getRulesDraft().draft)).toBe(json(normalizeRules(V113_RAW)));
  });
});

describe('патчі чернетки', () => {
  it('patchDraft: верхній рівень зливається, решта не змінюється, dirty = true', () => {
    const before = getRulesDraft().draft;
    patchDraft({ weaponPz: 20 });
    const s = getRulesDraft();
    expect(s.dirty).toBe(true);
    expect(s.savedAs).toBeNull();
    expect(s.draft.weaponPz).toBe(20);
    expect(s.draft.gems).toEqual(before.gems);
    expect(s.draft.balance).toBe(before.balance); // не чіпали — той самий об'єкт
  });

  it('patchBuffs / patchComposition: правлять лише свій блок, сусіди лишаються', () => {
    const before = getRulesDraft().draft.balance;
    patchBuffs({ enabled: true, cap: 35 });
    let b = getRulesDraft().draft.balance;
    expect(b.buffs.enabled).toBe(true);
    expect(b.buffs.cap).toBe(35);
    expect(b.buffs.pct).toBe(before.buffs.pct);
    expect(b.composition).toBe(before.composition);
    patchComposition({ pairsRule: 'noSecondDd' });
    b = getRulesDraft().draft.balance;
    expect(b.composition.pairsRule).toBe('noSecondDd');
    expect(b.composition.profiles).toBe(before.composition.profiles);
    expect(b.buffs.enabled).toBe(true);
    // серіалізація містить нові поля — саме їх збереже нова версія
    const out = serializeRules(getRulesDraft().draft) as { balance: { buffs: { enabled: boolean }; composition: { pairsRule: string } } };
    expect(out.balance.buffs.enabled).toBe(true);
    expect(out.balance.composition.pairsRule).toBe('noSecondDd');
  });

  it('resetDraft повертає копію базової версії і знімає dirty', () => {
    patchBuffs({ enabled: true });
    patchDraft({ shg: 1 });
    resetDraft();
    const s = getRulesDraft();
    expect(s.dirty).toBe(false);
    expect(json(s.draft)).toBe(json(normalizeRules(V113_RAW)));
  });

  it('followCurrentVersion: чисту чернетку переводить на нову поточну, брудну — ні', () => {
    registerRules({ version: 'balance-v1.14', note: null, createdAt: '2026-09-25T00:00:00Z', builtin: false }, normalizeRules({ ...V113_RAW, shg: 16 }), true);
    followCurrentVersion('balance-v1.14');
    expect(getRulesDraft().base).toBe('balance-v1.14');
    expect(getRulesDraft().draft.shg).toBe(16);
    patchDraft({ shg: 2 });
    followCurrentVersion(V113);
    expect(getRulesDraft().base).toBe('balance-v1.14');
    expect(getRulesDraft().draft.shg).toBe(2);
  });
});

describe('збереження як нова версія', () => {
  it('пороги tier не спадають → помилка, saver не викликається', async () => {
    patchDraft({ tiers: getRulesDraft().draft.tiers.map((t) => (t.tier === 'A' ? { ...t, min: 300 } : t)) });
    expect(draftTiersValid()).toBe(false);
    const v = await saveDraft();
    expect(v).toBeNull();
    expect(getRulesDraft().err).toMatch(/спадати/);
    expect(getRulesDraft().dirty).toBe(true);
    expect(saveRulesVersionMock).not.toHaveBeenCalled();
  });

  it('успіх: saver отримує чернетку й нотатку, база = нова версія, dirty знято, нотатка очищена', async () => {
    saveRulesVersionMock.mockResolvedValue('balance-v1.14');
    patchBuffs({ enabled: true });
    setDraftNote('увімкнули бафи');
    const draft = getRulesDraft().draft;
    const v = await saveDraft();
    expect(v).toBe('balance-v1.14');
    expect(saveRulesVersionMock).toHaveBeenCalledWith(draft, 'увімкнули бафи');
    const s = getRulesDraft();
    expect(s.base).toBe('balance-v1.14');
    expect(s.savedAs).toBe('balance-v1.14');
    expect(s.dirty).toBe(false);
    expect(s.note).toBe('');
    expect(s.busy).toBe(false);
  });

  it('помилка збереження → err, чернетка й dirty лишаються', async () => {
    saveRulesVersionMock.mockRejectedValue(new Error('boom'));
    patchDraft({ shg: 7 });
    const v = await saveDraft();
    expect(v).toBeNull();
    const s = getRulesDraft();
    expect(s.err).toBeTruthy();
    expect(s.dirty).toBe(true);
    expect(s.draft.shg).toBe(7);
    expect(s.busy).toBe(false);
  });
});
