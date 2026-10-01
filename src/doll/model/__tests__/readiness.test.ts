import { beforeAll, describe, expect, it } from 'vitest';
import { BUILTIN_RULES_VERSION, classPointsFor, normalizeRules, registrationScore, tierForWith } from '../../../data/gearRules';
import { emptyDoc, type CharacterDoc } from '../doc';
import { hydrate } from '../hydrate';
import { scoreItems } from '../itemScore';
import { createSet, equip, resetAttrs, setAttr, setLevel } from '../ops';
import { PREVIEW_TEAM_SIZE, dollScorePreview, itemNamesOf, readinessIssues, vitShare } from '../readiness';
import { buildOf, dollFacts, gearFromCharacter, type Sheet } from '../sheet';
import { docFrom, loadRef, lookup } from './testDoc';

beforeAll(() => loadRef());

const rules = normalizeRules({});
/** Стара «Анкета для турнірів» у збереженому персонажі: у бали не йде (крім джина як запасного шляху). */
const OLD_SHEET: Sheet = { weaponGrade: 'other', armorSet: 'other', tract: 't1_3', genie: 'g71_80', ring1: 'r9r1', ring2: 'r9r1' };
/** Готовий до турніру лучник: фікстура + імʼя і шлях (очки фікстури роздано всі); анкета не потрібна. */
const ready = (): CharacterDoc => ({ ...docFrom('typical-js'), name: 'Тайфорн', path: 'rs' });
const issues = (doc: CharacterDoc) => readinessIssues(doc, hydrate(doc, lookup), dollFacts(doc, rules, lookup), scoreItems(doc, rules, lookup));
const preview = (doc: CharacterDoc) => dollScorePreview(doc, rules, BUILTIN_RULES_VERSION, PREVIEW_TEAM_SIZE, lookup);
const noNaN = (o: unknown) => expect(JSON.stringify(o)).not.toMatch(/NaN|Infinity/);

describe('частка Тілобудови і збірка', () => {
  it('нероздані очки — 0, а не NaN; частка — від розданих понад базові 5', () => {
    expect(vitShare(emptyDoc())).toBe(0);
    const doc = { ...emptyDoc(), attrs: { str: 5, dex: 300, vit: 150, mag: 5 } };
    expect(vitShare(doc)).toBeCloseTo(145 / 440, 10);
    expect(vitShare({ ...emptyDoc(), attrs: { str: 5, dex: 5, vit: 305, mag: 5 } })).toBe(1);
  });

  it('buildOf — та сама частка проти порогів шкали (rules.doll.buildVit)', () => {
    const doc = { ...emptyDoc(), attrs: { str: 5, dex: 300, vit: 150, mag: 5 } }; // ≈ 0,33
    expect(buildOf(doc, rules)).toBe('hybrid');
    expect(buildOf(doc, normalizeRules({ doll: { buildVit: { hybrid: 0.1, con: 0.3 } } }))).toBe('con');
    expect(buildOf(doc, normalizeRules({ doll: { buildVit: { hybrid: 0.4, con: 0.6 } } }))).toBe('dd');
    // нічого не роздано — ДД навіть із нульовими порогами
    expect(buildOf(emptyDoc(), normalizeRules({ doll: { buildVit: { hybrid: 0, con: 0 } } }))).toBe('dd');
  });

  it('скинути атрибути — усі по 5, очки знову вільні; без змін — те саме посилання', () => {
    const doc = setAttr(emptyDoc(), 'dex', 300);
    expect(resetAttrs(doc).attrs).toEqual({ str: 5, dex: 5, vit: 5, mag: 5 });
    const clean = emptyDoc();
    expect(resetAttrs(clean)).toBe(clean);
  });
});

describe('попередній скор v2 з ляльки', () => {
  // typical-js (лучник 105): 189.01 балів за речі (itemScore.test); клас 8 (3×3), рівень 10, джин не заповнено — 0 → 207.
  it('клас (3×3) + рівень + джин + бали за речі — як registrationScore у заявці; тир зі шкали; розклад із назвами', () => {
    const doc = ready();
    const p = preview(doc);
    const items = scoreItems(doc, rules, lookup);
    expect(p.parts).toEqual({ cls: classPointsFor(rules, 'archer', 3), lvl: rules.level.l105, genie: 0, items: items.itemPoints });
    expect(p.parts).toEqual({ cls: 8, lvl: 10, genie: 0, items: 189.01 });
    expect(p.score).toBe(207);
    expect(p.tier).toBe(tierForWith(207, rules));
    expect(p.genie).toBe('g60');
    expect(p.genieFilled).toBe(false);
    // те саме число, що складе заявка з legacy-колонок і itemPoints
    const gear = gearFromCharacter(doc, dollFacts(doc, rules, lookup), { setsFromDoll: rules.setsFromDoll }, lookup).gear;
    expect(registrationScore({ gear, itemPoints: items.itemPoints }, rules, 3)).toBe(p.score);
    // розклад — як у заявці: версія, складові, лише зараховані рядки
    expect(p.breakdown.ver).toBe(BUILTIN_RULES_VERSION);
    expect(p.breakdown.sum).toMatchObject({ cls: 8, lvl: 10, genie: 0, main: items.mainTotal, sets: items.setsCapped });
    expect(p.breakdown.rows.length).toBeGreaterThan(5);
    expect(p.breakdown.rows.every((r) => r[3] > 0)).toBe(true);
    // назви речей для розкладу — зі scoreItems
    const name = itemNamesOf(p.items);
    expect(name(1902, 'ta')).toBe('Небесний лук');
    expect(name(1902, 'qn')).toBeNull();
    noNaN(p);
  });

  it('джин — з блоку джина за удачею; без нього — зі старої анкети; ніде не заповнено — «до 60» (0 балів)', () => {
    const base = ready();
    const withGenie: CharacterDoc = { ...base, genie: { level: 105, luck: 100, skills: [] } };
    const p = preview(withGenie);
    expect(p.genie).toBe('g100');
    expect(p.genieFilled).toBe(true);
    expect(p.parts.genie).toBe(rules.genie.g100);
    expect(p.score).toBe(217);
    // блок джина головніший за стару анкету; стара анкета — запасний шлях
    expect(preview({ ...withGenie, sheet: OLD_SHEET }).genie).toBe('g100');
    const old = preview({ ...base, sheet: OLD_SHEET });
    expect(old.genie).toBe('g71_80');
    expect(old.genieFilled).toBe(true);
    expect(old.score).toBe(207 + rules.genie.g71_80);
  });

  it('стара анкета з іншими грейдами на бали не впливає — грейди з речей', () => {
    const doc = ready();
    const a = preview(doc);
    const b = preview({ ...doc, sheet: { ...OLD_SHEET, genie: undefined } });
    expect(b.parts).toEqual(a.parts);
    expect(b.score).toBe(a.score);
  });

  it('порожня чернетка — лише клас і рівень, без винятків і без NaN', () => {
    const p = preview(emptyDoc('js'));
    expect(p.parts).toEqual({ cls: 8, lvl: 10, genie: 0, items: 0 });
    expect(p.score).toBe(18);
    expect(p.breakdown.rows).toEqual([]);
    noNaN(p);
  });
});

describe('готовність до турніру', () => {
  it('порожня чернетка: бракує імені, очок, шляху, зброї й слотів броні — без анкети; порожні необовʼязкові слоти і джин — лише нагадування', () => {
    const { blockers, notes } = issues(emptyDoc());
    expect(blockers).toEqual([
      'імʼя персонажа',
      'вільні очки атрибутів: 520',
      'шлях (Мудрець чи Демон) — з 89 рівня',
      'зброя',
      'порожні слоти броні: нагрудник, поножі, взуття, браслети',
    ]);
    expect(blockers.join(' ')).not.toContain('анкет');
    expect(notes).toEqual(['порожні слоти: шолом, накидка, намисто, пояс, кільце (л), кільце (п)', 'джина не заповнено — за нього 0 балів']);
  });

  it('заповнений персонаж — жодного блокера без анкети; стара анкета нічого не додає; шлях до 89 рівня не потрібен', () => {
    expect(issues(ready()).blockers).toEqual([]);
    expect(issues({ ...ready(), sheet: OLD_SHEET }).blockers).toEqual([]);
    const low = { ...emptyDoc(), name: 'x', level: 1 };
    expect(issues(low).blockers.some((b) => b.startsWith('шлях'))).toBe(false);
  });

  it('зброя: блокує лише коли її немає ніде; зброя тільки в сеті — нагадування, що рахується вона', () => {
    const base = ready();
    const main = { ...base.main };
    delete main.ta;
    const noWeapon = issues({ ...base, main });
    expect(noWeapon.blockers).toEqual(['зброя']);
    expect(noWeapon.blockers.join(' ')).not.toContain('на ляльці');
    // та сама зброя лише в сеті: заявку подати можна, у плашці — примітка скору
    const { doc: withSet, setId } = createSet({ ...base, main }, 'pz');
    const inSet = equip(withSet, setId!, 'ta', base.main.ta!);
    const r = issues(inSet);
    expect(r.blockers).toEqual([]);
    expect(r.notes).toContain('зброї в Головному немає — рахується зброя із сету «ПЗ»');
  });

  it('броня — за порожніми слотами rv/tg/rx/mj Головного, а не за середньою точкою', () => {
    const base = ready();
    const main = { ...base.main };
    delete main.rv;
    const one = { ...base, main };
    expect(dollFacts(one, rules, lookup).armorRefine).not.toBeNull(); // решта речей із точкою на місці
    expect(issues(one).blockers).toEqual(['порожній слот броні: нагрудник']);
    delete main.mj;
    expect(issues({ ...base, main }).blockers).toEqual(['порожні слоти броні: нагрудник, браслети']);
    // намисто чи пояс — не броня: порожній слот лише в нагадуваннях
    const opt = { ...base.main };
    delete opt.vx;
    delete opt.st;
    const { blockers, notes } = issues({ ...base, main: opt });
    expect(blockers).toEqual([]);
    expect(notes).toContain('порожні слоти: намисто, пояс');
  });

  it('речі, що не вдягаються, і зайві очки', () => {
    const doc = setLevel(ready(), 60); // речі 100+ рівня на 60-му не вдягаються, очок роздано забагато
    const { blockers } = issues(doc);
    const bad = blockers.find((b) => b.startsWith('речі, що не вдягаються: «'));
    expect(bad).toBeDefined();
    expect(bad).toContain('(Головний)');
    expect(bad).toMatch(/і ще \d+$/);
    expect(blockers.some((b) => b.startsWith('зайві очки атрибутів'))).toBe(true);
  });

  it('нагадування: попередження джина, стара галочка ШГ без речі', () => {
    const base = ready();
    // шолом і накидку знято: ні «Шлема героя», ні «Плаща вознесения» на ляльці
    const main = { ...base.main };
    delete main.ft;
    delete main.wy;
    const doc: CharacterDoc = { ...base, main, genie: { level: 10, luck: 0, skills: [10001, 10151] }, sheet: { ...OLD_SHEET, shg: true } };
    const { blockers, notes } = issues(doc);
    expect(blockers).toEqual([]);
    expect(notes).toContain('порожні слоти: шолом, накидка');
    expect(notes).not.toContain('джина не заповнено — за нього 0 балів');
    expect(notes).toContain('джин: у джина буває лише одне початкове вміння');
    expect(notes.some((n) => n.startsWith('у старій анкеті стояла галочка ШГ'))).toBe(true);
    expect(notes.some((n) => n.startsWith('у старій анкеті стояла галочка Вознєс'))).toBe(false); // галочки Вознєса не було
    // «Шлем героя» надіто (фікстура) — нагадування немає
    const worn = { ...base, sheet: { ...OLD_SHEET, shg: true, voznes: true } };
    expect(issues(worn).notes.some((n) => n.includes('галочка'))).toBe(false);
  });

  it('нерозпізнані речі (gradeNotes) і примітки скору — у нагадуваннях, без дублів', () => {
    const doc = ready();
    const facts = dollFacts(doc, rules, lookup);
    // кільця фікстури (ранг 17) лялька не впізнає — зараховано «Луна і нижче»: з DollFacts, а не вдруге зі scoreItems
    const { notes } = issues(doc);
    const rings = notes.filter((n) => n.includes('не розпізнала'));
    expect(rings).toEqual(facts.gradeNotes);
    expect(rings).toHaveLength(2);
    expect(rings[0]).toMatch(/^Кільце 1: лялька не розпізнала «.+» — зараховано як «Луна і нижче»$/);
    // інші примітки скору (не про грейди) — теж, кожна один раз
    const items = { ...scoreItems(doc, rules, lookup), warn: ['«Шлем героя» у 2 екземплярах', '«Шлем героя» у 2 екземплярах'] };
    const dup = readinessIssues(doc, hydrate(doc, lookup), facts, items).notes.filter((n) => n.includes('екземплярах'));
    expect(dup).toEqual(['«Шлем героя» у 2 екземплярах']);
    // без результату скору — лише gradeNotes
    expect(readinessIssues(doc, hydrate(doc, lookup), facts).notes.filter((n) => n.includes('не розпізнала'))).toEqual(facts.gradeNotes);
  });
});
