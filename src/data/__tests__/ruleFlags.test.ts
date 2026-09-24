import { describe, expect, it } from 'vitest';
import { describeSnapshotBuffs, normalizeRuleFlags, reservePolicyFromFlags, resolveBuffOptions, type TournamentRuleFlags } from '../ruleFlags';
import { rulesFor } from '../gearRules';

const rules = rulesFor().balance;
const flags = (items: TournamentRuleFlags['items']): TournamentRuleFlags => ({ v: 1, items, extra: [] });

describe('resolveBuffOptions: правила турніру → що рахує жеребка', () => {
  it('без правил — бафи від пачки, КХ за замовчуванням зі шкали', () => {
    expect(resolveBuffOptions(rules, null)).toEqual({ source: 'party', kx: 'noKx' });
    expect(resolveBuffOptions(rules, undefined)).toEqual({ source: 'party', kx: 'noKx' });
    expect(resolveBuffOptions({ ...rules, buffs: { ...rules.buffs, defaultKx: 'kx' } }, flags([]))).toEqual({ source: 'party', kx: 'kx' });
  });

  it('рядок «kx» задає колонку лише зі значенням kx | noKx', () => {
    expect(resolveBuffOptions(rules, flags([{ key: 'kx', value: 'kx', text: 'Під КХ' }])).kx).toBe('kx');
    expect(resolveBuffOptions(rules, flags([{ key: 'kx', value: 'noKx', text: 'Без КХ' }])).kx).toBe('noKx');
    expect(resolveBuffOptions(rules, flags([{ key: 'kx', value: 'bogus', text: '' }])).kx).toBe('noKx');
    expect(resolveBuffOptions(rules, flags([{ key: 'kx', on: true, text: '' }])).kx).toBe('noKx');
  });

  it('рядок «party_buffs» знятий → бафи не рахуються; поставлений або відсутній → від пачки', () => {
    expect(resolveBuffOptions(rules, flags([{ key: 'party_buffs', on: false, text: '' }])).source).toBe('none');
    expect(resolveBuffOptions(rules, flags([{ key: 'party_buffs', on: true, text: '' }])).source).toBe('party');
    expect(resolveBuffOptions(rules, flags([{ key: 'party_buffs', text: '' }])).source).toBe('party');
    expect(resolveBuffOptions(rules, flags([{ key: 'kite', on: false, text: '' }])).source).toBe('party');
  });
});

describe('reservePolicyFromFlags', () => {
  it('latest / random з рядка «reserve»; інакше null (UI бере свій дефолт)', () => {
    expect(reservePolicyFromFlags(flags([{ key: 'reserve', value: 'latest', text: '' }]))).toBe('latest');
    expect(reservePolicyFromFlags(flags([{ key: 'reserve', value: 'random', text: '' }]))).toBe('random');
    expect(reservePolicyFromFlags(flags([{ key: 'reserve', value: 'manual', text: '' }]))).toBeNull();
    expect(reservePolicyFromFlags(flags([]))).toBeNull();
    expect(reservePolicyFromFlags(null)).toBeNull();
  });
});

describe('normalizeRuleFlags: JSON з колонки rule_flags', () => {
  it('null, не-об\'єкт, інша версія або без items → null (старий турнір — textarea)', () => {
    expect(normalizeRuleFlags(null)).toBeNull();
    expect(normalizeRuleFlags('x')).toBeNull();
    expect(normalizeRuleFlags({ v: 2, items: [] })).toBeNull();
    expect(normalizeRuleFlags({ v: 1 })).toBeNull();
  });

  it('сміття в items/extra відкидається, текст без значення → порожній рядок', () => {
    const f = normalizeRuleFlags({
      v: 1,
      items: [
        { key: 'kite', on: true, value: 15, text: 'Дозволено до 15 секунд кайта.' },
        { key: 'kx', value: 'kx' },
        { key: '', on: true, text: 'без ключа' },
        'oops', null, { on: true, text: 'без ключа теж' },
        { key: 'reg_block', on: 'yes', value: NaN, text: 42 },
        { key: 'reserve', value: null, text: '' },
      ],
      extra: ['БД вино дозволено.', 7, null],
    });
    expect(f).toEqual({
      v: 1,
      items: [
        { key: 'kite', on: true, value: 15, text: 'Дозволено до 15 секунд кайта.' },
        { key: 'kx', value: 'kx', text: '' },
        { key: 'reg_block', text: '' },
        { key: 'reserve', value: null, text: '' },
      ],
      extra: ['БД вино дозволено.'],
    });
    expect(normalizeRuleFlags({ v: 1, items: [] })).toEqual({ v: 1, items: [], extra: [] });
  });
});

describe('describeSnapshotBuffs — рядок довіри одними словами', () => {
  it('чотири стани', () => {
    expect(describeSnapshotBuffs(undefined, 'balance-v1.13')).toBe('бафи: не рахувались (стара жеребка)');
    // формулювання узгоджене з правилами: у них немає «бафи заборонені» — знято рядок «лише від своєї пачки»
    expect(describeSnapshotBuffs({ enabled: false, source: 'none', kx: 'noKx', bySide: false }, 'balance-v1.14')).toBe('бафи: не рахувались (правила турніру не обмежують бафи своєю пачкою)');
    expect(describeSnapshotBuffs({ enabled: false, source: 'party', kx: 'noKx', bySide: false }, 'balance-v1.13')).toBe('бафи: вимкнено у шкалі balance-v1.13');
    expect(describeSnapshotBuffs({ enabled: true, source: 'party', kx: 'noKx', bySide: false }, 'balance-v1.14')).toBe('бафи: без КХ, своя пачка');
    expect(describeSnapshotBuffs({ enabled: true, source: 'party', kx: 'kx', bySide: true }, 'balance-v1.14')).toBe('бафи: під КХ, своя пачка');
  });
});
