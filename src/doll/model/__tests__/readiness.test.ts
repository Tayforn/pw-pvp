import { beforeAll, describe, expect, it } from 'vitest';
import { classPointsFor, dollGearScoreWith, normalizeRules, shgVoznesScore, tierForWith } from '../../../data/gearRules';
import { emptyDoc, type CharacterDoc } from '../doc';
import { hydrate } from '../hydrate';
import { resetAttrs, setAttr, setLevel } from '../ops';
import { PREVIEW_TEAM_SIZE, dollScorePreview, gearFromFacts, readinessIssues, vitShare } from '../readiness';
import { buildOf, dollFacts, type Sheet } from '../sheet';
import { docFrom, loadRef, lookup } from './testDoc';

beforeAll(() => loadRef());

const rules = normalizeRules({});
/** Повна анкета для турнірів: поки заявка бере грейди й джина з неї, без неї персонаж «не готовий». */
const SHEET: Sheet = { weaponGrade: 'r9r2', armorSet: 'r9', tract: 't8', genie: 'g71_80', ring1: 'r9', ring2: 'r9' };
/** Готовий до турніру лучник: фікстура + імʼя, шлях і анкета (очки фікстури роздано всі). */
const ready = (): CharacterDoc => ({ ...docFrom('typical-js'), name: 'Тайфорн', path: 'rs', sheet: SHEET });
const issues = (doc: CharacterDoc) => readinessIssues(doc, hydrate(doc, lookup), dollFacts(doc, rules, lookup), rules);
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

describe('попередній скор з ляльки', () => {
  it('вбудована шкала (еталонів немає): скору, тиру й множників немає — і жодного NaN', () => {
    const doc = ready();
    const p = dollScorePreview(doc, dollFacts(doc, rules, lookup), rules, PREVIEW_TEAM_SIZE, lookup);
    expect(p.mode).toBe('off');
    expect(p.power?.off).toBeGreaterThan(0);
    expect(p.ref).toBeNull();
    expect(p.offMult).toBeNull();
    expect(p.defMult).toBeNull();
    expect(p.score).toBeNull();
    expect(p.tier).toBeNull();
    noNaN(p);
  });

  it('порожня чернетка — без винятків і без NaN', () => {
    const doc = emptyDoc('js');
    const p = dollScorePreview(doc, dollFacts(doc, rules, lookup), rules, PREVIEW_TEAM_SIZE, lookup);
    expect(p.score).toBeNull();
    noNaN(p);
  });

  it('еталон, рівний персонажу: множники 1, скор = бали еталона + клас (3×3) + джин + ШГ/Вознєс', () => {
    const doc = ready();
    const facts = dollFacts(doc, rules, lookup);
    const own = dollScorePreview(doc, facts, rules, PREVIEW_TEAM_SIZE, lookup).power!;
    const r = normalizeRules({
      dollScore: { mode: 'shadow', refs: { archer: { off: own.off, def: own.def, base: 150, label: 'еталон', wpa: own.wpa, ...(own.abil ? { abil: own.abil } : {}) } } },
    });
    const p = dollScorePreview(doc, facts, r, 3, lookup);
    expect(p.mode).toBe('shadow');
    expect(p.offMult).toBe(1);
    expect(p.defMult).toBe(1);
    const gear = gearFromFacts(doc, facts, r.setsFromDoll);
    expect(gear.genie).toBe(SHEET.genie); // джин — з анкети, як у заявці
    expect(p.score).toBe(Math.round(150 + classPointsFor(r, 'archer', 3) + r.genie[SHEET.genie!] + shgVoznesScore(gear, r)));
    expect(p.score).toBe(dollGearScoreWith(gear, p.power!, r, 3));
    expect(p.tier).toBe(tierForWith(p.score!, r));
    // удвічі сильніший еталон — множники 0,5
    const weaker = normalizeRules({ dollScore: { refs: { archer: { off: own.off * 2, def: own.def * 2, base: 150 } } } });
    const half = dollScorePreview(doc, facts, weaker, 3, lookup);
    expect(half.offMult).toBeCloseTo(0.5, 6);
    expect(half.defMult).toBeCloseTo(0.5, 6);
  });

  it('джин — як у заявці зараз: з анкети; без неї — з блоку джина за удачею; ніде не заповнено — «до 60»', () => {
    const base = docFrom('typical-js');
    const withGenie = { ...base, genie: { level: 105, luck: 100, skills: [] } };
    expect(gearFromFacts(withGenie, dollFacts(withGenie, rules, lookup), true).genie).toBe('g100');
    // анкета поки головніша за блок джина (у заявку йде вона)
    const withSheet: CharacterDoc = { ...withGenie, sheet: { genie: 'g81_90' } };
    expect(gearFromFacts(withSheet, dollFacts(withSheet, rules, lookup), true).genie).toBe('g81_90');
    expect(gearFromFacts(base, dollFacts(base, rules, lookup), true).genie).toBe('g60');
  });
});

describe('готовність до турніру', () => {
  it('порожня чернетка: бракує імені, очок, шляху, зброї, слотів броні й анкети; порожні необовʼязкові слоти і джин — лише нагадування', () => {
    const { blockers, notes } = issues(emptyDoc());
    expect(blockers).toEqual([
      'імʼя персонажа',
      'вільні очки атрибутів: 520',
      'шлях (Мудрець чи Демон) — з 89 рівня',
      'зброя в Головному',
      'порожні слоти: нагрудник, поножі, взуття, браслети',
      'анкета для турнірів: бракує грейд зброї, сет броні, трактат, джин, кільце 1, кільце 2',
    ]);
    expect(notes).toEqual(['порожні слоти: шолом, накидка, намисто, пояс, кільце (л), кільце (п)', 'джина не заповнено — за нього 0 балів']);
  });

  it('заповнений персонаж — жодного блокера; шлях до 89 рівня не потрібен', () => {
    expect(issues(ready()).blockers).toEqual([]);
    const low = { ...emptyDoc(), name: 'x', level: 1 };
    expect(issues(low).blockers.some((b) => b.startsWith('шлях'))).toBe(false);
  });

  it('анкета для турнірів: без неї «не готовий» — бракує лише незаповнених полів; «зброя/броня на ляльці» не дублюються', () => {
    const bare: CharacterDoc = { ...docFrom('typical-js'), name: 'Тайфорн', path: 'rs' };
    const all = issues(bare).blockers;
    expect(all).toEqual(['анкета для турнірів: бракує грейд зброї, сет броні, трактат, джин, кільце 1, кільце 2']);
    const part = issues({ ...bare, sheet: { weaponGrade: 'r9', tract: 't6', ring1: 'moon', ring2: 'moon' } }).blockers;
    expect(part).toEqual(['анкета для турнірів: бракує сет броні, джин']);
    // зброю знято: «зброя в Головному» — один раз, без «зброя на ляльці» з анкети
    const main = { ...bare.main };
    delete main.ta;
    const noWeapon = issues({ ...bare, main }).blockers;
    expect(noWeapon.filter((b) => b.includes('зброя'))).toEqual(['зброя в Головному']);
    expect(noWeapon.join(' ')).not.toContain('на ляльці');
  });

  it('броня — за порожніми слотами rv/tg/rx/mj Головного, а не за середньою точкою', () => {
    const base = ready();
    const main = { ...base.main };
    delete main.rv;
    const one = { ...base, main };
    expect(dollFacts(one, rules, lookup).armorRefine).not.toBeNull(); // решта речей із точкою на місці
    expect(issues(one).blockers).toEqual(['порожній слот: нагрудник']);
    delete main.mj;
    expect(issues({ ...base, main }).blockers).toEqual(['порожні слоти: нагрудник, браслети']);
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
    const doc: CharacterDoc = { ...base, main, genie: { level: 10, luck: 0, skills: [10001, 10151] }, sheet: { ...SHEET, shg: true } };
    const { blockers, notes } = issues(doc);
    expect(blockers).toEqual([]);
    expect(notes).toContain('порожні слоти: шолом, накидка');
    expect(notes).not.toContain('джина не заповнено — за нього 0 балів');
    expect(notes).toContain('джин: у джина буває лише одне початкове вміння');
    expect(notes.some((n) => n.startsWith('в анкеті стояла галочка ШГ'))).toBe(true);
    expect(notes.some((n) => n.startsWith('в анкеті стояла галочка Вознєс'))).toBe(false); // галочки Вознєса не було
    // «Шлем героя» надіто (фікстура) — нагадування немає
    const worn = { ...base, sheet: { ...SHEET, shg: true, voznes: true } };
    expect(issues(worn).notes.some((n) => n.includes('галочка'))).toBe(false);
  });

  it('gradeNotes («зараховано як …») поки не показуються — у заявку йдуть грейди з анкети', () => {
    const doc = ready();
    const facts = dollFacts(doc, rules, lookup);
    const { notes } = readinessIssues(doc, hydrate(doc, lookup), { ...facts, gradeNotes: ['Зброя: лялька не розпізнала «x» — зараховано як «y»'] }, rules);
    expect(notes.join(' ')).not.toContain('зараховано як');
  });
});
