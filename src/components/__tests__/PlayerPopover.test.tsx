// =========================================================
// Картка гравця (PlayerPopover): рядки анкети (gearRows) і «Розклад по речах»
// (CardBreakdown) для заявки персонажем — публічно без чисел скору, адміну з
// балами; назви сетів зі знімка (setNamesOf). Сам попап — портал у body, тому
// рендеримо складові через renderToStaticMarkup (jsdom у проєкті нема).
// =========================================================

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ItemBreakdown, PlayerGear } from '../../data/types';
import { CardBreakdown, gearRows, type PlayerCardInfo } from '../PlayerPopover';
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
