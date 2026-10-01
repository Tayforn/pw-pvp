// =========================================================
// Картка гравця (PlayerPopover): рядки анкети (gearRows) і «Розклад по речах»
// (CardBreakdown) для заявки персонажем — публічно без чисел скору, адміну з
// балами; назви сетів зі знімка (setNamesOf); джин зі знімка — рядок «удача N ·
// K вмінь» (genieLine) та іконки вмінь (CardGenieSkills), видно всім. Сам попап —
// портал у body, тому рендеримо складові через renderToStaticMarkup (jsdom у
// проєкті нема).
// =========================================================

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GENIE_SKILLS, genieFromSnapshot } from '../../data/genie';
import type { ItemBreakdown, PlayerGear } from '../../data/types';
import { CardBreakdown, CardGenieSkills, gearRows, genieLine, type PlayerCardInfo } from '../PlayerPopover';
import { setNamesOf } from '../ScoreBreakdown';

const visible = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

const GEAR: PlayerGear = {
  charClass: 'archer', charLevel: 'l104', build: 'dd', weaponGrade: 'r9r2', weaponRefine: 'w12', weaponPz: true, armorSet: 'r8r', armorRefine: 'a10',
  gems: 'camp', specialSets: [], specialSetGems: {}, tract: 't6', genie: 'g100', shg: true, shgRefine: 9, voznes: true, voznesRefine: 9,
  ring1: 'silver', ring1Refine: null, ring2: 'r9', ring2Refine: null,
};
const BD: ItemBreakdown = {
  v: 1, ver: 'balance-v1.0',
  sum: { cls: 8, lvl: 7, genie: 10, main: 251.85, sets: 11.83, setsRaw: 31, pair: 5 },
  rows: [[0, 'ta', 1927, 101.17, 'r9r2 60 · +12 25 · кам 1.2 · ka 15'], [1, 'wy', 54, 3.83, '+9 3.8']],
};
const info = (over: Partial<PlayerCardInfo> = {}): PlayerCardInfo => ({ nickname: 'Tayforn', gear: GEAR, tier: 'S', breakdown: BD, setNames: ['Спів'], ...over });
const admin = { score: 294, gearScore: 294, adjust: 0, rating: 0, adjustNote: null, attackLevel: null, defenseLevel: null, version: 'balance-v1.0' };

describe('CardBreakdown — розклад по речах у картці гравця', () => {
  it('публічно: слоти й назви сетів, жодного числа скору (бали за речі теж)', () => {
    const t = visible(renderToStaticMarkup(<CardBreakdown info={info()} />));
    expect(t).toContain('Спорядження з ляльки');
    expect(t).toContain('Головний');
    expect(t).toContain('Сет «Спів»');
    expect(t).toContain('Зброя');
    expect(t).toContain('Накидка');
    for (const n of ['101.17', '3.83', '268.68', '251.85', 'клас 8', 'джин 10']) expect(t).not.toContain(n);
  });

  it('адміну — з балами й підсумком; назви речей — лише через resolver (каталог в адмінці)', () => {
    const noNames = visible(renderToStaticMarkup(<CardBreakdown info={info({ admin })} />));
    expect(noNames).toContain('268.68');
    expect(noNames).toContain('101.17');
    expect(noNames).toContain('клас 8');
    expect(noNames).not.toContain('Комплект твердині');
    const named = visible(renderToStaticMarkup(<CardBreakdown info={info({ admin, itemName: (catId, slot) => (slot === 'ta' && catId === 1927 ? 'Комплект твердині' : null) })} />));
    expect(named).toContain('Комплект твердині');
  });

  it('без розкладу (стара анкета) — нічого', () => {
    expect(renderToStaticMarkup(<CardBreakdown info={info({ breakdown: null })} />)).toBe('');
    expect(renderToStaticMarkup(<CardBreakdown info={info({ breakdown: undefined })} />)).toBe('');
  });
});

describe('gearRows / setNamesOf', () => {
  it('джин в анкеті — за удачею', () => {
    const rows = gearRows(GEAR);
    expect(rows.find((r) => r.label === 'Джин')?.value).toBe('удача 100');
    expect(gearRows({ ...GEAR, genie: 'g60' }).find((r) => r.label === 'Джин')?.value).toBe('удача до 60');
    expect(gearRows({ ...GEAR, genie: 'g71_80' }).find((r) => r.label === 'Джин')?.value).toBe('71–80');
    // ключі рядків — для особливого рендеру (під «Джин» іконки вмінь)
    expect(rows.map((r) => r.key)).toEqual(['level', 'build', 'weapon', 'armor', 'gems', 'sets', 'tract', 'genie', 'shg', 'rings']);
  });

  it('назви сетів зі знімка — без перевірки документа; зламане — порожньо', () => {
    expect(setNamesOf({ v: 2, sets: [{ name: 'Спів' }, { name: 'ПЗ' }] })).toEqual(['Спів', 'ПЗ']);
    expect(setNamesOf({ sets: [{ name: 5 }, null, 'x', { name: 'ПА' }] })).toEqual(['', '', '', 'ПА']);
    expect(setNamesOf({ sets: 'nope' })).toEqual([]);
    expect(setNamesOf(null)).toEqual([]);
    expect(setNamesOf(undefined)).toEqual([]);
    expect(setNamesOf('str')).toEqual([]);
  });
});

describe('джин зі знімка ляльки в картці гравця', () => {
  // вісім звичайних (не початкових) вмінь у порядку дерева — як їх зберігає документ
  const refs = GENIE_SKILLS.filter((s) => s.levels === 10).slice(0, 8).map((s) => s.ref);
  const nameOf = (ref: number) => GENIE_SKILLS.find((s) => s.ref === ref)!.name;
  const genie = genieFromSnapshot({ v: 2, genie: { level: 105, luck: 95, skills: refs } })!;

  it('рядок «Джин» — «удача N · K вмінь» зі знімка замість діапазону анкети; без знімка — діапазон', () => {
    expect(genie.skills).toEqual(refs);
    expect(gearRows(GEAR, undefined, genie).find((r) => r.key === 'genie')?.value).toBe('удача 95 · 8 вмінь');
    expect(gearRows(GEAR, undefined, null).find((r) => r.key === 'genie')?.value).toBe('удача 100');
    expect(gearRows(GEAR, undefined, undefined).find((r) => r.key === 'genie')?.value).toBe('удача 100');
    // відмінки: 1 вміння, 2–4 вміння, 5+ вмінь, жодного — «без вмінь»
    expect(genieLine({ level: 60, luck: 51, skills: refs.slice(0, 1) })).toBe('удача 51 · 1 вміння');
    expect(genieLine({ level: 60, luck: 60, skills: refs.slice(0, 3) })).toBe('удача 60 · 3 вміння');
    expect(genieLine({ level: 60, luck: 60, skills: refs.slice(0, 4) })).toBe('удача 60 · 4 вміння');
    expect(genieLine({ level: 80, luck: 71, skills: refs.slice(0, 5) })).toBe('удача 71 · 5 вмінь');
    expect(genieLine({ level: 10, luck: 0, skills: [] })).toBe('удача 0 · без вмінь');
  });

  it('іконки вмінь — усім, і без admin: до 8 штук 32×32 зі спрайта, назва вміння в title', () => {
    const html = renderToStaticMarkup(<CardGenieSkills genie={genie} />);
    expect(html.match(/class="player-pop-genie-ico"/g)).toHaveLength(8);
    expect(html).toContain('aria-label="Вміння джина"');
    for (const ref of refs) expect(html).toContain(`title="${nameOf(ref)}"`);
    // розміри й спрайт — інлайном (у попапі CSS ляльки немає), позиція — клітинка вміння
    expect(html.match(/width:32px;height:32px;background-image:url\([^)]*genie2[^)]*\);background-position:-\d+px -\d+px/g)).toHaveLength(8);
    expect(visible(html)).toBe('');
  });

  it('без джина чи без вмінь — іконок немає', () => {
    expect(renderToStaticMarkup(<CardGenieSkills genie={null} />)).toBe('');
    expect(renderToStaticMarkup(<CardGenieSkills genie={undefined} />)).toBe('');
    expect(renderToStaticMarkup(<CardGenieSkills genie={{ level: 50, luck: 40, skills: [] }} />)).toBe('');
    // знімок без блоку джина (стара заявка персонажем) — null, рядок лишається з анкети
    expect(genieFromSnapshot({ v: 2, name: 'x' })).toBeNull();
  });
});
