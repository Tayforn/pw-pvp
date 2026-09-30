import { beforeAll, describe, expect, it } from 'vitest';
import { normalizeRules } from '../../../data/gearRules';
import { readJson } from '../../core/__tests__/testData';
import type { Item } from '../../core/types';
import type { Cat, CharacterDoc } from '../doc';
import { armorPieceOf, armorSetOf, ringGradeOf, tractOf, weaponGradeOf } from '../grades';
import { dollFacts } from '../sheet';
import { docFrom, inst, loadRef, lookup, mkDoc, mkSet } from './testDoc';

beforeAll(() => loadRef());

const rules = normalizeRules({});
/** Річ каталогу за (категорія, id) — тест падає, якщо її в каталозі немає. */
function item(cat: Cat, id: number): Item {
  const it = lookup(cat, id);
  if (!it) throw new Error(`у каталозі ${cat} немає id ${id}`);
  return it;
}
const weapon = (id: number) => weaponGradeOf(item('ta', id));
const ring = (id: number) => ringGradeOf(item('oq', id));
const tract = (id: number) => tractOf(item('qn', id)).grade;
/** Сет броні з id речей у порядку нагрудник, поножі, взуття, наручі (null — порожній слот). */
const armorSet = (rv: number | null, tg: number | null, rx: number | null, mj: number | null) =>
  armorSetOf([rv && item('rv', rv), tg && item('tg', tg), rx && item('rx', rx), mj && item('mj', mj)].map((x) => x || null)).grade;

/** Документ з речами Головного: [слот-категорія, id] (кільця — cr/cd з категорією oq). */
function docWith(main: Array<[slot: string, cat: Cat, id: number]>): CharacterDoc {
  const items = main.map(([slot, cat, id]) => inst(slot, cat, id));
  return mkDoc({ items, main: Object.fromEntries(main.map(([slot]) => [slot, slot])) as CharacterDoc['main'] });
}

describe('грейди з речей каталогу', () => {
  it('зброя: репутація, ранг, зірки, комплект, фіксований ПА, pw_id Нірвани', () => {
    expect(weapon(1900).grade).toBe('r9'); // 300к, ранг 16, дві зірки
    expect(weapon(1922).grade).toBe('r9r1'); // три зірки в комплекті з бронею
    expect(weapon(1923).grade).toBe('r9r2'); // три зірки без комплекту (ПА 40+25)
    expect(weapon(1927).grade).toBe('r9r2'); // ПА 70 — теж без комплекту
    expect(weapon(1767).grade).toBe('r8r'); // 200к, ранг 15
    expect(weapon(1167).grade).toBe('cgd'); // 80 рів., ранг 16, дві зірки, ПА 50
    expect(weapon(1187).grade).toBe('rcgd'); // три зірки, ПА 65
    expect(weapon(1836).grade).toBe('nirvana'); // перший каст: ранг 13, pw_id з діапазону
    expect(weapon(1830).grade).toBe('nirvana'); // обрізана назва — правило без назв
    expect(weapon(1865).grade).toBe('nirvana'); // другий каст: ранг 15, дві зірки
    expect(weapon(1743).grade).toBe('nirvana'); // третій каст: ранг 16, tv 21
    expect(weapon(1755)).toEqual({ grade: 'other', suspicious: false }); // ранг 13 поза списком Нірвани
    // R8 без перековки (200к, ранг 14) — «інше», але з репутацією: попередити.
    expect(weapon(1753)).toEqual({ grade: 'other', suspicious: true });
    for (const id of [1900, 1922, 1923, 1767, 1167, 1187, 1836, 1743]) expect(weapon(id).suspicious).toBe(false);
  });

  it('кільця: репутація 300к, id Срібного місяця й ПКС, решта й порожній слот — Луна', () => {
    expect(ring(174).grade).toBe('pks');
    expect(ring(177).grade).toBe('pks');
    expect(ring(180).grade).toBe('silver');
    expect(ring(181).grade).toBe('silver');
    expect(ring(184).grade).toBe('r9');
    expect(ring(193).grade).toBe('r9r1');
    // Кільце 17-го рангу (ПА 4, ПЗ 4) — у шкалу не лягає: Луна з попередженням.
    expect(ring(284)).toEqual({ grade: 'moon', suspicious: true });
    expect(ringGradeOf(null)).toEqual({ grade: 'moon', suspicious: false });
    for (const id of [174, 177, 180, 181, 184, 193]) expect(ring(id).suspicious).toBe(false);
  });

  it('трактат: за рангом книги; без рангу й порожній слот — t1_3', () => {
    expect(tract(105)).toBe('t6');
    expect(tract(56)).toBe('t6');
    expect(tract(38)).toBe('t7');
    expect(tract(107)).toBe('t8'); // «Тысячи лет», ранг 8
    expect(tract(108)).toBe('t8');
    expect(tract(109)).toBe('emperor');
    expect(tract(111)).toBe('t1_3'); // «Свиток» гільдії без рангу
    expect(tractOf(null)).toEqual({ grade: 't1_3', suspicious: false });
  });

  it('сет броні: рівень більшості з 4 речей', () => {
    expect(armorSet(391, 366, 325, 317)).toBe('r9'); // 4 × R9
    expect(armorSet(373, 340, 304, 293)).toBe('r8r'); // R8R лучника
    expect(armorSet(373, 340, 310, 284)).toBe('nirvana_r8_mix'); // 2 R8R + 2 Нірвани
    expect(armorSet(351, 344, 310, 284)).toBe('nirvana'); // 4 × Нірвана
    expect(armorSet(312, 305, 276, 259)).toBe('other'); // ТТ99
    // 3 + 1
    expect(armorSet(391, 366, 325, 259)).toBe('r9');
    expect(armorSet(391, 366, 304, 259)).toBe('r8r'); // 2 R9 + R8R = 3 речі R8R і вище
    expect(armorSet(373, 305, 310, 284)).toBe('nirvana_r8_mix'); // 1 R8R + 2 Нірвани
    expect(armorSet(373, 305, 276, 284)).toBe('other'); // 1 R8R + 1 Нірвана
    expect(armorSet(351, 344, 310, 259)).toBe('nirvana'); // 3 Нірвани
    // порожні слоти — як «інше»
    expect(armorSet(391, 366, 325, null)).toBe('r9');
    expect(armorSet(391, 366, null, null)).toBe('nirvana_r8_mix');
    expect(armorSet(null, null, null, null)).toBe('other');
    expect(armorSetOf([]).grade).toBe('other');
  });

  it('річ броні: грейд і «підозріла» річ', () => {
    expect(armorPieceOf(item('rv', 391)).grade).toBe('r9');
    expect(armorPieceOf(item('rv', 373)).grade).toBe('r8r');
    expect(armorPieceOf(item('rx', 310)).grade).toBe('nirvana');
    expect(armorPieceOf(item('rv', 312))).toEqual({ grade: 'other', suspicious: false });
    // 101 рів., ранг 15 («Полуденный зной») — під правило не лягає, але схожа на топову.
    expect(armorPieceOf(item('tg', 363))).toEqual({ grade: 'other', suspicious: true });
    // «томления» 80 рівня рангу 10 з репутацією 300 000 — не R9, а підозріле «інше».
    expect(armorPieceOf(item('tg', 230))).toEqual({ grade: 'other', suspicious: true });
    const s = armorSetOf([item('rv', 391), item('tg', 363), item('rx', 325), item('mj', 317)]);
    expect(s.grade).toBe('r9');
    expect(s.suspicious.map((it) => it.id)).toEqual([363]);
  });

  // Знімок покриття каталогу: оновлення JSON (новий каталог із Хелпера) не
  // має мовчки змінити грейди. Якщо тест упав — переглянь правила в
  // model/grades.ts і розділ «Грейди з надітих речей» у docs/doll.md, а тоді
  // онови числа.
  it('знімок: скільки речей каталогу дає кожен грейд', () => {
    const count = <G extends string>(cat: string, f: (it: Item) => { grade: G; suspicious: boolean }) => {
      const out: Record<string, number> = {};
      for (const it of readJson<Item[]>(cat)) {
        const g = f(it);
        out[g.grade] = (out[g.grade] ?? 0) + 1;
        if (g.suspicious) out.suspicious = (out.suspicious ?? 0) + 1;
      }
      return out;
    };
    expect(count('ta', weaponGradeOf)).toEqual({ other: 2366, nirvana: 114, r8r: 32, cgd: 19, rcgd: 62, r9: 14, r9r1: 14, r9r2: 29, suspicious: 430 });
    expect(count('rv', armorPieceOf)).toEqual({ other: 416, nirvana: 15, r8r: 28, r9: 74, suspicious: 56 });
    // Броня «томления» 80 рівня рангу 10 з репутацією 300 000 (tg 224/230, rx 177, mj 184/189) — не R9, а підозріле «інше».
    expect(count('tg', armorPieceOf)).toEqual({ other: 404, nirvana: 15, r8r: 28, r9: 70, suspicious: 39 });
    expect(count('rx', armorPieceOf)).toEqual({ other: 350, nirvana: 15, r8r: 28, r9: 70, suspicious: 39 });
    expect(count('mj', armorPieceOf)).toEqual({ other: 334, nirvana: 15, r8r: 28, r9: 70, suspicious: 39 });
    expect(count('oq', ringGradeOf)).toEqual({ moon: 248, pks: 2, silver: 2, r9: 1, r9r1: 42, suspicious: 49 });
    expect(count('qn', tractOf)).toEqual({ t1_3: 46, t4_5: 26, t6: 16, t7: 23, t8: 24, emperor: 1 });
  });
});

describe('грейди в dollFacts', () => {
  it('typical-by і typical-js: повний R9, Імператор, кільця 17-го рангу — Луна з попередженням', () => {
    for (const name of ['typical-by', 'typical-js']) {
      const f = dollFacts(docFrom(name), rules, lookup);
      expect([f.weaponGrade, f.armorSet, f.tract, f.ring1, f.ring2]).toEqual(['r9', 'r9', 'emperor', 'moon', 'moon']);
      expect(f.gradeNotes).toEqual([
        'Кільце 1: лялька не розпізнала «Блукання в забутті (ж )» — зараховано як «Луна і нижче»',
        'Кільце 2: лялька не розпізнала «Неприв\'язана човен (ж )» — зараховано як «Луна і нижче»',
      ]);
    }
  });

  it('еталон власника (Маг): Нірвана, ТТ99, Юболо, дві ПКС — без попереджень', () => {
    const f = dollFacts(docWith([
      ['ta', 'ta', 1743], ['rv', 'rv', 312], ['tg', 'tg', 305], ['rx', 'rx', 276], ['mj', 'mj', 259],
      ['cr', 'oq', 174], ['cd', 'oq', 174], ['qn', 'qn', 38],
    ]), rules, lookup);
    expect([f.weaponGrade, f.armorSet, f.tract, f.ring1, f.ring2]).toEqual(['nirvana', 'other', 't7', 'pks', 'pks']);
    expect(f.gradeNotes).toEqual([]);
  });

  it('грейд — лише за записом каталогу: «свої роли», заточка й камені екземпляра не впливають', () => {
    // ЦГД з ПА сервера 30 замість каталожних 50 (роли замінюють базу) і РЦГД з ПА 50 замість 65.
    const cgd = inst('ta', 'ta', 1167, { xr: true, x: [{ t: 'ad', v: 30 }], r: 12 });
    const rcgd = inst('ta', 'ta', 1187, { xr: true, x: [{ t: 'ad', v: 50 }] });
    expect(dollFacts(mkDoc({ items: [cgd], main: { ta: 'ta' } }), rules, lookup).weaponGrade).toBe('cgd');
    expect(dollFacts(mkDoc({ items: [rcgd], main: { ta: 'ta' } }), rules, lookup).weaponGrade).toBe('rcgd');
    // Кільце без каталожних стат (роли замінюють базу) — однаково ПКС за id.
    const pks = inst('cr', 'oq', 174, { xr: true, x: [], r: 5 });
    expect(dollFacts(mkDoc({ items: [pks], main: { cr: 'cr' } }), rules, lookup).ring1).toBe('pks');
  });

  it('порожня лялька: зброї немає (null), решта — найнижчі грейди', () => {
    const f = dollFacts(mkDoc(), rules, lookup);
    expect([f.weaponGrade, f.armorSet, f.tract, f.ring1, f.ring2]).toEqual([null, 'other', 't1_3', 'moon', 'moon']);
    expect(f.gradeNotes).toEqual([]);
  });

  it('трактат — найкращий з Головного й усіх сетів; решта — лише з Головного', () => {
    const items = [inst('b7', 'qn', 38), inst('b9', 'qn', 109), inst('b6', 'qn', 105), inst('w', 'ta', 1900), inst('r', 'oq', 184)];
    const inSet = dollFacts(mkDoc({ items, main: { qn: 'b7' }, sets: [mkSet('s1', { qn: 'b9', ta: 'w', cr: 'r' })] }), rules, lookup);
    expect(inSet.tract).toBe('emperor');
    // Зброя й кільце лише в сеті — у грейди не йдуть.
    expect([inSet.weaponGrade, inSet.ring1]).toEqual([null, 'moon']);
    expect(dollFacts(mkDoc({ items, main: { qn: 'b7' }, sets: [mkSet('s1', { qn: 'b6' })] }), rules, lookup).tract).toBe('t7');
    expect(dollFacts(mkDoc({ items, sets: [mkSet('s1', { qn: 'b6' })] }), rules, lookup).tract).toBe('t6');
    // Заявка власника 25.09: у Головному «Феникс летит к рассвету» (6), у Спів-сеті «Девять кудзу» (7) —
    // за правилом турніру («найкращий, який береш») зараховується 7.
    const own = [inst('q6', 'qn', 56), inst('q7', 'qn', 92)];
    expect(dollFacts(mkDoc({ items: own, main: { qn: 'q6' }, sets: [mkSet('s1', { qn: 'q7' })] }), rules, lookup).tract).toBe('t7');
  });

  it('попередження: підозріла зброя й річ броні — з назвою речі й зарахованим грейдом', () => {
    const f = dollFacts(docWith([
      ['ta', 'ta', 1753], ['rv', 'rv', 391], ['tg', 'tg', 363], ['rx', 'rx', 325], ['mj', 'mj', 317],
    ]), rules, lookup);
    expect([f.weaponGrade, f.armorSet]).toEqual(['other', 'r9']);
    expect(f.gradeNotes).toEqual([
      'Зброя: лялька не розпізнала «Клинок Безсмертного короля» — зараховано як «Інше / нижче Нірвани»',
      'Броня: лялька не розпізнала «Поножі полуденної спеки» — зараховано як річ «Інше / нижче Нірвани» (сет броні — «R9»)',
    ]);
  });
});
