// Сторож даних джина (згенеровано scripts/genie-data.ts із PW Хелпера): таблиця
// правил, позиції іконок у спрайті й тексти вмінь сегментами без HTML.

import { describe, expect, it } from 'vitest';
import { GENIE_SKILLS, INITIAL_REFS, genieSkill } from '../genie';
import { genieIconStyle } from '../genieIcon';
import { GENIE_SKILL_ROWS, GENIE_SYNC_COMMIT } from '../genieSkills';

// Тексти — сирим файлом (не через лінивий завантажувач ляльки): тест бачить
// рівно те, що піде в білд. node:fs у src/** не типізується (@types/node нема).
const RAW = import.meta.glob('../../doll/data/genie/genie-text.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const rawText = Object.values(RAW)[0] ?? '';

type Seg = Record<string, unknown>;
interface SkillText {
  lv: number;
  d: Seg[];
  st: Record<string, string[]>;
}
const TONES = ['label', 'num', 'genie', 'dark', 'warn'];

describe('таблиця вмінь', () => {
  it('91 унікальний ref, 4 початкові — рівно ті, що мають один рівень', () => {
    const refs = GENIE_SKILLS.map((s) => s.ref);
    expect(refs).toHaveLength(91);
    expect(new Set(refs).size).toBe(91);
    expect(INITIAL_REFS.size).toBe(4);
    for (const r of INITIAL_REFS) expect(genieSkill(r)?.levels).toBe(1);
    expect(GENIE_SKILLS.filter((s) => s.levels === 1).map((s) => s.ref).sort()).toEqual([...INITIAL_REFS].sort());
    expect(GENIE_SKILLS.filter((s) => s.levels !== 1).every((s) => s.levels === 10)).toBe(true);
    expect(GENIE_SYNC_COMMIT).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it('рядки цілі: рівень 1..60, 5 стихій, маски, назва без розмітки', () => {
    for (const r of GENIE_SKILL_ROWS) expect(r).toHaveLength(14);
    for (const s of GENIE_SKILLS) {
      expect(Number.isInteger(s.level) && s.level >= 1 && s.level <= 60).toBe(true);
      expect(s.aff).toHaveLength(5);
      expect(s.aff.every((a) => Number.isInteger(a) && a >= 0 && a <= 8)).toBe(true);
      expect(s.cls & ~0x3ff).toBe(0);
      expect(s.ter & ~0x1c000).toBe(0);
      expect(s.name.trim()).toBe(s.name);
      expect(s.name).not.toMatch(/[<>&]/);
    }
  });

  it('позиції іконок унікальні, у порядку дерева; «Жало» — сторінка 1, клітинка (2,0)', () => {
    const cells = GENIE_SKILLS.map((s) => s.page + ':' + s.x + ':' + s.y);
    expect(new Set(cells).size).toBe(91);
    expect(GENIE_SKILLS.every((s) => (s.page === 1 || s.page === 2) && s.x >= 0 && s.x <= 8 && s.y >= 0 && s.y <= 8)).toBe(true);
    const key = (s: (typeof GENIE_SKILLS)[number]) => s.page * 10000 + s.y * 100 + s.x;
    for (let i = 1; i < GENIE_SKILLS.length; i++) expect(key(GENIE_SKILLS[i])).toBeGreaterThan(key(GENIE_SKILLS[i - 1]));
    expect(genieSkill(10001)).toMatchObject({ page: 1, x: 2, y: 0 });
  });

  it('іконка: інлайнові розміри й позиція у спрайті', () => {
    expect(genieIconStyle(10001)).toMatchObject({ width: 32, height: 32, backgroundPosition: '-120px -55px', backgroundRepeat: 'no-repeat' });
    expect(String(genieIconStyle(10001).backgroundImage)).toMatch(/^url\(".*genie2.*\.png"\)$/);
    expect(genieIconStyle(10321).backgroundPosition).toBe('-661px -72px'); // «Помста»: сторінка 2, (2,0)
    expect(genieIconStyle(123)).toEqual({ width: 32, height: 32 });
  });
});

describe('тексти вмінь (genie-text.json)', () => {
  it('файл є і без HTML: жодного «<» чи «>»', () => {
    expect(rawText.length).toBeGreaterThan(10000);
    expect(rawText).not.toMatch(/[<>]/);
  });

  const texts = JSON.parse(rawText || '{}') as Record<string, SkillText>;

  it('ті самі ref, що й у таблиці; кількість рівнів збігається', () => {
    expect(Object.keys(texts).map(Number).sort()).toEqual(GENIE_SKILLS.map((s) => s.ref).sort());
    for (const s of GENIE_SKILLS) expect(texts[String(s.ref)].lv).toBe(s.levels);
  });

  it('сегменти: { t, c? } | { f, c? } | { br: 1 }, тони з дозволеного списку, st — лише потрібні ключі потрібної довжини', () => {
    for (const [ref, sk] of Object.entries(texts)) {
      expect(Object.keys(sk).sort()).toEqual(['d', 'lv', 'st']);
      expect(sk.d.length).toBeGreaterThan(0);
      const used = new Set<string>();
      for (const seg of sk.d) {
        const keys = Object.keys(seg).sort().join(',');
        if ('br' in seg) {
          expect(seg).toEqual({ br: 1 });
          continue;
        }
        expect(['c,t', 't', 'c,f', 'f']).toContain(keys);
        if (seg.c !== undefined) expect(TONES).toContain(seg.c);
        if ('t' in seg) {
          expect(typeof seg.t).toBe('string');
          expect(seg.t).not.toBe('');
        } else {
          const f = String(seg.f);
          used.add(f);
          expect(sk.st[f], `вміння ${ref}: {{${f}}}`).toHaveLength(sk.lv);
          expect(sk.st[f].every((v) => typeof v === 'string')).toBe(true);
        }
      }
      // Плюс '0' (рівень джина) і '1' (дух) по рівнях — для перемикача рівнів у картці вміння.
      for (const k of ['0', '1']) expect(sk.st[k], `вміння ${ref}: st['${k}']`).toHaveLength(sk.lv);
      expect(Object.keys(sk.st).sort()).toEqual([...new Set([...used, '0', '1'])].sort());
    }
  });

  it('«Обмеження» — лише значення, опис з нового рядка; «Миттєве» не злипається з числом', () => {
    const LIMIT = /^(немає|Все профессии|(крім|кроме) \S+|[а-яіїєґ]+(, [а-яіїєґ]+)*)$/u;
    let limits = 0;
    for (const [ref, sk] of Object.entries(texts)) {
      sk.d.forEach((seg, i) => {
        const t = 't' in seg ? String(seg.t) : '';
        if (seg.c === 'label' && /^(Обмеження|Ограничение)/u.test(t)) {
          limits++;
          const v = sk.d[i + 1];
          expect(v && 't' in v && v.c === undefined, `вміння ${ref}: значення обмеження`).toBe(true);
          expect(String(v.t), `вміння ${ref}`).toMatch(LIMIT);
          // далі — кінець тексту або розрив рядка, а не продовження опису в тому ж рядку
          if (sk.d[i + 2]) expect(sk.d[i + 2], `вміння ${ref}: після «${String(v.t)}»`).toEqual({ br: 1 });
        }
        if (/Миттєв|Мгновен/u.test(t)) {
          expect(seg.c, `вміння ${ref}: «${t}»`).toBe('label');
          expect(t.trim()).toBe(t);
          expect(sk.d[i - 1], `вміння ${ref}: перед «${t}»`).toEqual({ br: 1 });
        }
      });
    }
    expect(limits).toBe(90);
    // «Жало»: «Обмеження: немає», порожній рядок, опис; «Стовп полумʼя» — «200», порожній рядок, «Миттєве»
    const sting = texts['10001'].d;
    const at = sting.findIndex((s) => s.t === 'Обмеження:　');
    expect(sting.slice(at + 1, at + 4)).toEqual([{ t: 'немає' }, { br: 1 }, { br: 1 }]);
    expect(String(sting[at + 4].t)).toMatch(/^Вистрілює в супротивника отруєним жалом/);
    const fire = texts['10151'].d;
    const n = fire.findIndex((s) => s.t === '200');
    expect(fire.slice(n + 1, n + 4)).toEqual([{ br: 1 }, { br: 1 }, { t: 'Миттєве', c: 'label' }]);
  });
});
