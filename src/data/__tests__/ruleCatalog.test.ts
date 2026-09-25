import { describe, expect, it } from 'vitest';
// Seed міграції — текстом (vite ?raw): тест звіряє його з BUILTIN_RULE_ITEMS.
import seedSql from '../../../supabase/migrations/0027_rule_catalog.sql?raw';
import spivSql from '../../../supabase/migrations/0030_rule_spiv_set.sql?raw';

// Тексти сіду 0027 з поправками пізніших міграцій (0030 — рядок про Спів-сет).
const migrationSql = [seedSql, spivSql].join(String.fromCharCode(10));
import {
  BUILTIN_RULE_ITEMS, REG_BLOCK_LINES, blankRuleItem, catalogTextFor, defaultFlagsFor, drawEffectHint, drawSummary, flagsFromLegacyText, formatLabel, formatOf,
  itemsForFormat, mergeCatalog, newCustomKey, normalizeRuleItem, parseRulesMd, renderRulesMd, renderRulesPoints, stripBullet, textOfItem, type RuleItem,
} from '../ruleCatalog';
import { RULE_KEYS_AFFECTING_DRAW, SYSTEM_RULE_KEYS, resolveBuffOptions, reservePolicyFromFlags } from '../ruleFlags';
import { rulesFor } from '../gearRules';
import { RULE_SECTIONS, standardRulesFor } from '../standardRules';

const COMMON = ['Без 3 ци.', 'Тільки селфи.', 'Вся аптека — дозволена.', 'Дозволено до 15 секунд кайта / інвіза.'];
const PARTY = 'Бафи — лише від своєї пачки; ПА/ПЗ бафи Стража в пачках, де його нема, — не дозволено.';
const SQUADS = 'Склади команд публікуються на сторінці турніру і не змінюються на прохання гравців. Заміни робить лише адмін — у разі неявки або дискваліфікації.';
const RESERVE_LATEST = "Гравці, які не потрапили в команди через кількість (останні за часом реєстрації), утворюють резерв і заміняють тих, хто не з'явився на старт.";
const md = (lines: string[]) => lines.map((l, i) => (i === 0 ? l : `• ${l}`)).join('\n');

describe('golden: текст правил з дефолтів довідника', () => {
  it('1х1 = «1х1» + чотири бойові рядки в порядку старого шаблону', () => {
    const text = renderRulesMd(defaultFlagsFor(BUILTIN_RULE_ITEMS, null, 'fixed'), null, 'fixed');
    expect(text).toBe(md(['1х1', ...COMMON]));
    expect(renderRulesMd(defaultFlagsFor(BUILTIN_RULE_ITEMS, 1, 'fixed'), 1, 'fixed')).toBe(text);
    expect(standardRulesFor(null)).toBe(text);
  });

  it('готові команди 3х3 = ті самі рядки + рядок про пачку', () => {
    expect(renderRulesMd(defaultFlagsFor(BUILTIN_RULE_ITEMS, 3, 'fixed'), 3, 'fixed')).toBe(md(['3х3, готові команди', ...COMMON, PARTY]));
  });

  it('фул-рандом 3х3 = Бій → Реєстрація (5 рядків) → Склади; бойові пункти є (старий дефект :73 виправлено)', () => {
    const text = renderRulesMd(defaultFlagsFor(BUILTIN_RULE_ITEMS, 3, 'balanced_random'), 3, 'balanced_random');
    expect(text).toBe(md(['3х3, балансний фул-рандом', ...COMMON, PARTY, ...REG_BLOCK_LINES, SQUADS, RESERVE_LATEST]));
    expect(standardRulesFor(3, 'balanced_random')).toBe(text);
    // «не згадувати» (БД вино) і «не задано» (КХ) рядків не дають
    expect(text).not.toContain('БД вино');
    expect(text).not.toContain('КХ');
  });

  it('публічна сторінка: три секції з тих самих дефолтів', () => {
    expect(RULE_SECTIONS.map((s) => s.title)).toEqual(['1х1', 'Командні турніри — готові команди (2х2 і більше)', 'Балансний фул-рандом (командний)']);
    expect(RULE_SECTIONS[0].points).toEqual(COMMON);
    expect(RULE_SECTIONS[1].points).toEqual([...COMMON, PARTY]);
    expect(RULE_SECTIONS[2].points).toHaveLength(COMMON.length + 1 + REG_BLOCK_LINES.length + 2);
  });
});

describe('контракт системних ключів (ruleFlags ↔ довідник ↔ seed 0027)', () => {
  it('BUILTIN = рівно системні ключі; affects лише на party_buffs/kx/reserve; значення варіантів — ті, що читає жеребка', () => {
    expect(BUILTIN_RULE_ITEMS.map((i) => i.key).sort()).toEqual([...SYSTEM_RULE_KEYS].sort());
    for (const i of BUILTIN_RULE_ITEMS) {
      expect(i.isSystem).toBe(true);
      expect(i.affects).toBe((RULE_KEYS_AFFECTING_DRAW as readonly string[]).includes(i.key) ? i.key : null);
    }
    const by = new Map(BUILTIN_RULE_ITEMS.map((i) => [i.key, i]));
    expect(by.get('kx')!.options!.map((o) => o.value)).toEqual(['unset', 'kx', 'noKx']);
    expect(by.get('reserve')!.options!.map((o) => o.value)).toEqual(['latest', 'random']);
    expect(by.get('party_buffs')!.kind).toBe('flag');
    // дефолти для фул-рандому дають жеребці «бафи від пачки, КХ зі шкали, резерв за часом»
    const flags = defaultFlagsFor(BUILTIN_RULE_ITEMS, 3, 'balanced_random');
    expect(resolveBuffOptions(rulesFor().balance, flags)).toEqual({ source: 'party', kx: 'noKx' });
    expect(reservePolicyFromFlags(flags)).toBe('latest');
  });

  it('seed у міграції 0027 містить ті самі ключі й тексти, що BUILTIN', () => {
    const sql = migrationSql;
    const esc = (s: string) => s.replace(/'/g, "''");
    for (const i of BUILTIN_RULE_ITEMS) {
      expect(sql, i.key).toContain(`('${i.key}', '${i.grp}', '${i.kind}', '${esc(i.labelAdmin)}'`);
      for (const line of i.textPlayer.split('\n')) if (line) expect(sql, i.key).toContain(esc(line));
      for (const o of i.options ?? []) {
        expect(sql, `${i.key}/${o.value}`).toContain(`"value":"${o.value}","label":"${o.label}","text":"${esc(o.text)}"`);
      }
      expect(sql, i.key).toContain(`'{${i.visibleFor.join(',')}}', ${i.affects ? `'${i.affects}'` : 'null'}, true, ${i.sort})`);
    }
  });
});

describe('normalizeRuleItem: рядок БД → RuleItem', () => {
  it('сміття без ключа → null; невідомі grp/kind → дефолти; доданий рядок не отримує affects', () => {
    expect(normalizeRuleItem(null)).toBeNull();
    expect(normalizeRuleItem('x')).toBeNull();
    expect(normalizeRuleItem({ key: '' })).toBeNull();
    const it1 = normalizeRuleItem({ key: 'c_0a1b2c3d', grp: 'nope', kind: 'weird', label_admin: 'БД вино', text_player: 'БД вино дозволено.', affects: 'kx', is_system: true, sort: 'x', visible_for: ['solo', 'bogus'] })!;
    expect(it1).toEqual({
      key: 'c_0a1b2c3d', grp: 'battle', kind: 'flag', labelAdmin: 'БД вино', textPlayer: 'БД вино дозволено.', options: null, defaultValue: true,
      visibleFor: ['solo'], affects: null, isSystem: false, sort: 0, archived: false,
    });
  });

  it('системний ключ: kind/affects/isSystem — з коду, з БД — підписи, тексти, дефолт, формати, порядок, архів', () => {
    const kx = normalizeRuleItem({
      key: 'kx', grp: 'squads', kind: 'flag', label_admin: 'КХ', text_player: 'ignored', affects: null, is_system: false, sort: 5, archived: true,
      visible_for: ['fixed', 'balanced'], default_value: 'kx',
      options: [{ value: 'kx', label: 'усі стоять під КХ', text: 'Усі під КХ.' }, { value: 'evil', label: 'x', text: 'y' }],
    })!;
    expect(kx.kind).toBe('choice');
    expect(kx.affects).toBe('kx');
    expect(kx.isSystem).toBe(true);
    expect(kx.grp).toBe('squads');
    expect(kx.archived).toBe(true);
    expect(kx.sort).toBe(5);
    expect(kx.visibleFor).toEqual(['fixed', 'balanced']);
    expect(kx.defaultValue).toBe('kx');
    // значення варіантів з коду; підписи й тексти — з БД, чужий варіант відкинуто
    expect(kx.options).toEqual([
      { value: 'unset', label: 'не задано', text: '' },
      { value: 'kx', label: 'усі стоять під КХ', text: 'Усі під КХ.' },
      { value: 'noKx', label: 'без КХ', text: 'Без КХ-бафів.' },
    ]);
    // число: не-число в default_value → дефолт з коду; порожній visible_for → з коду
    const kite = normalizeRuleItem({ key: 'kite', default_value: 'abc', visible_for: [] })!;
    expect(kite.kind).toBe('number');
    expect(kite.defaultValue).toBe(15);
    expect(kite.visibleFor).toEqual(['solo', 'fixed', 'balanced']);
    // вибір без варіантів у БД → варіанти з коду; дефолт поза варіантами → перший
    const potions = normalizeRuleItem({ key: 'potions', default_value: 'ghost' })!;
    expect(potions.options!.map((o) => o.value)).toEqual(['all', 'none']);
    expect(potions.defaultValue).toBe('all');
    // round-trip camelCase (уже нормалізований обʼєкт)
    for (const b of BUILTIN_RULE_ITEMS) expect(normalizeRuleItem(b)).toEqual(b);
  });

  it('mergeCatalog додає системні рядки, яких у БД немає, і сортує по групах', () => {
    const custom = normalizeRuleItem({ key: 'c_11111111', grp: 'battle', kind: 'flag', label_admin: 'x', text_player: 'X.', sort: 5 })!;
    const merged = mergeCatalog([custom]);
    expect(merged).toHaveLength(BUILTIN_RULE_ITEMS.length + 1);
    expect(merged[0].key).toBe('c_11111111');
    expect(merged.map((i) => i.key)).toContain('reserve');
    expect(merged[merged.length - 1].grp).toBe('squads');
    // копії, не самі BUILTIN-обʼєкти — правка в редакторі не псує фолбек
    expect(merged.find((i) => i.key === 'kx')).not.toBe(BUILTIN_RULE_ITEMS.find((i) => i.key === 'kx'));
  });

  it('newCustomKey / blankRuleItem', () => {
    expect(newCustomKey()).toMatch(/^c_[0-9a-f]{8}$/);
    expect(newCustomKey(() => 0.999)).toBe('c_ffffffff');
    const b = blankRuleItem('squads', BUILTIN_RULE_ITEMS, 'c_deadbeef');
    expect(b).toMatchObject({ key: 'c_deadbeef', grp: 'squads', kind: 'flag', defaultValue: true, isSystem: false, affects: null, sort: 30 });
  });
});

describe('формат і текст рядка', () => {
  it('formatOf / formatLabel', () => {
    expect(formatOf(null, 'fixed')).toBe('solo');
    expect(formatOf(1, 'balanced_random')).toBe('solo');
    expect(formatOf(2, 'fixed')).toBe('fixed');
    expect(formatOf(5, 'balanced_random')).toBe('balanced');
    expect(formatLabel(null, 'fixed')).toBe('1х1');
    expect(formatLabel(2, 'fixed')).toBe('2х2, готові команди');
    expect(formatLabel(5, 'balanced_random')).toBe('5х5, балансний фул-рандом');
    expect(itemsForFormat(BUILTIN_RULE_ITEMS, 'solo').map((i) => i.key)).toEqual(['no_spark3', 'self_only', 'potions', 'kite', 'bd_wine']);
    expect(itemsForFormat(BUILTIN_RULE_ITEMS, 'fixed').map((i) => i.key)).toEqual(['no_spark3', 'self_only', 'potions', 'kite', 'party_buffs', 'bd_wine']);
  });

  it('textOfItem: число підставляє {value}, вибір бере текст варіанта, галочка — як є', () => {
    const kite = BUILTIN_RULE_ITEMS.find((i) => i.key === 'kite')!;
    expect(textOfItem(kite, 20)).toBe('Дозволено до 20 секунд кайта / інвіза.');
    const bd = BUILTIN_RULE_ITEMS.find((i) => i.key === 'bd_wine')!;
    expect(textOfItem(bd, 'forbidden')).toBe('БД вино заборонено.');
    expect(textOfItem(bd, 'skip')).toBe('');
    expect(textOfItem(bd, 'nope')).toBe('');
    expect(catalogTextFor(kite, { value: 20 })).toBe('Дозволено до 20 секунд кайта / інвіза.');
    expect(catalogTextFor(kite, {})).toBe('Дозволено до 15 секунд кайта / інвіза.');
  });

  it('renderRulesPoints: зняті рядки і порожній текст пропускаються, багаторядковий текст — по пункту на рядок, «Додатково» без маркерів', () => {
    const flags = defaultFlagsFor(BUILTIN_RULE_ITEMS, 3, 'balanced_random');
    flags.items.find((i) => i.key === 'self_only')!.on = false;
    flags.items.find((i) => i.key === 'bd_wine')!.value = 'allowed';
    flags.items.find((i) => i.key === 'bd_wine')!.text = 'БД вино дозволено.';
    flags.extra = ['• Без 2-ї вспишки.', '- ще пункт', '   ', '– і ще'];
    const points = renderRulesPoints(flags);
    expect(points).not.toContain('Тільки селфи.');
    expect(points).toContain('БД вино дозволено.');
    expect(points.slice(-3)).toEqual(['Без 2-ї вспишки.', 'ще пункт', 'і ще']);
    expect(points.filter((p) => REG_BLOCK_LINES.includes(p))).toHaveLength(5);
  });

  it('stripBullet', () => {
    expect(stripBullet('• Без 3 ци.')).toBe('Без 3 ци.');
    expect(stripBullet('  - - x')).toBe('x');
    expect(stripBullet('– y ')).toBe('y');
    expect(stripBullet('— z')).toBe('z');
    expect(stripBullet('−30 % не маркер')).toBe('−30 % не маркер');
    expect(stripBullet('   ')).toBe('');
  });
});

describe('старий турнір → конструктор, читання тексту назад', () => {
  it('flagsFromLegacyText: дефолти формату + старий текст рядками в «Додатково»', () => {
    const legacy = '• Без 3 ци.\n• Селфи.\n\n- БД вино дозволено.\nПА/ПЗ бафи стражів в пачках де їх нема — не дозволено.';
    const f = flagsFromLegacyText(legacy, BUILTIN_RULE_ITEMS, 2, 'fixed');
    expect(f.items).toEqual(defaultFlagsFor(BUILTIN_RULE_ITEMS, 2, 'fixed').items);
    expect(f.extra).toEqual(['Без 3 ци.', 'Селфи.', 'БД вино дозволено.', 'ПА/ПЗ бафи стражів в пачках де їх нема — не дозволено.']);
    // згенерований раніше текст: рядок формату не потрапляє в «Додатково»
    expect(flagsFromLegacyText('2х2, готові команди\n• x', BUILTIN_RULE_ITEMS, 2, 'fixed').extra).toEqual(['x']);
    expect(flagsFromLegacyText(null, BUILTIN_RULE_ITEMS, null, 'fixed').extra).toEqual([]);
  });

  it('parseRulesMd: згенерований текст → заголовок + пункти; старий вільний текст → лише пункти', () => {
    const text = renderRulesMd(defaultFlagsFor(BUILTIN_RULE_ITEMS, null, 'fixed'), null, 'fixed');
    expect(parseRulesMd(text)).toEqual({ title: '1х1', points: COMMON });
    expect(parseRulesMd('1 на 1\nБез 3 ци\nСелфи')).toEqual({ title: null, points: ['1 на 1', 'Без 3 ци', 'Селфи'] });
    expect(parseRulesMd('• лише пункт')).toEqual({ title: null, points: ['лише пункт'] });
    expect(parseRulesMd('')).toEqual({ title: null, points: [] });
    expect(parseRulesMd(null)).toEqual({ title: null, points: [] });
  });

  it('drawSummary: чіпи лише для рядків, що є у знімку', () => {
    const balanced = defaultFlagsFor(BUILTIN_RULE_ITEMS, 3, 'balanced_random');
    // формулювання — простими словами, як у рядку довіри жеребки («пачка ✓» без слова «бафи» не читалось)
    expect(drawSummary(balanced, BUILTIN_RULE_ITEMS)).toEqual(['бафи: від своєї пачки', 'КХ: не задано (за шкалою)', 'резерв: останні за часом']);
    balanced.items.find((i) => i.key === 'party_buffs')!.on = false;
    balanced.items.find((i) => i.key === 'kx')!.value = 'kx';
    balanced.items.find((i) => i.key === 'reserve')!.value = 'random';
    expect(drawSummary(balanced, BUILTIN_RULE_ITEMS)).toEqual(['бафи: не рахуються', 'КХ: усі під КХ', 'резерв: випадково']);
    expect(drawSummary(defaultFlagsFor(BUILTIN_RULE_ITEMS, null, 'fixed'), BUILTIN_RULE_ITEMS)).toEqual([]);
    expect(drawSummary(null, BUILTIN_RULE_ITEMS)).toEqual([]);
    // невідоме значення — підпис із довідника або саме значення
    const items: RuleItem[] = BUILTIN_RULE_ITEMS;
    expect(drawSummary({ v: 1, items: [{ key: 'kx', value: 'zzz', text: '' }], extra: [] }, items)).toEqual(['КХ: zzz']);
  });

  it('drawEffectHint: ⚙-рядки кажуть, що зробить жеребка в поточному стані; решта — null', () => {
    expect(drawEffectHint({ key: 'party_buffs', on: false, text: '' })).toContain('НЕ рахуватиме');
    expect(drawEffectHint({ key: 'party_buffs', on: true, text: '' })).toContain('сила = гір + бафи');
    expect(drawEffectHint({ key: 'party_buffs', text: '' })).toContain('сила = гір + бафи'); // без on — як поставлена (resolveBuffOptions так само)
    expect(drawEffectHint({ key: 'kx', value: 'kx', text: '' })).toContain('«під КХ»');
    expect(drawEffectHint({ key: 'kx', value: 'noKx', text: '' })).toContain('«без КХ»');
    expect(drawEffectHint({ key: 'kx', value: 'unset', text: '' })).toContain('за замовчуванням');
    expect(drawEffectHint({ key: 'reserve', value: 'random', text: '' })).toContain('випадкові');
    expect(drawEffectHint({ key: 'reserve', value: 'latest', text: '' })).toContain('останні за часом');
    expect(drawEffectHint({ key: 'no_spark3', on: true, text: '' })).toBeNull();
  });
});
