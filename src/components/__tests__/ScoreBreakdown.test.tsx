// =========================================================
// «Розклад по речах» (ScoreBreakdown): рядки item_breakdown за конфігураціями
// (Головний → сети), підписи слотів без каталогу ляльки, назви через resolver,
// бали лише з showPoints, підсумок і примітки; порожній розклад — рядок про це.
// Рендер у рядок через renderToStaticMarkup (jsdom у проєкті нема).
// =========================================================

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SLOTS } from '../../doll/core/constants';
import { SLOT_LABELS, slotLabel } from '../../data/slotLabels';
import type { ItemBreakdown } from '../../data/types';
import ScoreBreakdown, { cfgLabel, fmtPoints, groupRows, sumLine } from '../ScoreBreakdown';

/** Видимий текст розмітки: без тегів, пробіли стиснуто. */
const visible = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/** Розклад заявки власника (itemScore.test): Головний, сет «Спів» (1) і сет «ПЗ» (2) зі свап-луком у mainPoints. */
const B: ItemBreakdown = {
  v: 1, ver: 'balance-v1.0',
  sum: { cls: 8, lvl: 7, genie: 10, main: 251.85, sets: 11.83, setsRaw: 31, pair: 5 },
  rows: [
    [0, 'ta', 1927, 101.17, 'r9r2 60 · +12 25 · кам 1.2 · ka 15'],
    [2, 'ta', 1816, 21, 'свап: ПЗ 21'],
    [0, 'qn', 56, 5, 't6 5'],
    [1, 'wy', 54, 3.83, '+9 3.8'],
    [1, 'qn', 92, 8],
  ],
  warn: ['«Шлем героя» у 2 екземплярах'],
};
const NAMES: Record<string, string> = { 'ta:1927': 'Комплект твердині', 'ta:1816': 'Вітер мисливця-тіні', 'qn:56': 'Феникс', 'wy:54': 'Плащ тишины', 'qn:92': 'Девять кудзу' };
const resolver = (catId: number, slot: string): string | null => NAMES[slot + ':' + catId] ?? null;
const SETS = ['Спів', 'ПЗ'];

const render = (props: Partial<Parameters<typeof ScoreBreakdown>[0]> = {}) => renderToStaticMarkup(<ScoreBreakdown breakdown={B} resolver={resolver} setNames={SETS} {...props} />);
/** Позиції підрядків у тексті — для перевірки порядку. */
const order = (t: string, parts: string[]): number[] => parts.map((p) => { const i = t.indexOf(p); if (i < 0) throw new Error('нема «' + p + '» у: ' + t); return i; });
const ascending = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

describe('ScoreBreakdown', () => {
  it('рядки за конфігураціями: Головний перед сетами, сети — за номером; свап-лук із сету «ПЗ» під своїм сетом', () => {
    const t = visible(render());
    expect(ascending(order(t, ['Головний', 'Комплект твердині', 'Феникс', 'Сет «Спів»', 'Плащ тишины', 'Девять кудзу', 'Сет «ПЗ»', 'Вітер мисливця-тіні']))).toBe(true);
    // підписи слотів — без каталогу ляльки, «Книга» тут «Трактат»
    expect(t).toContain('Зброя');
    expect(t).toContain('Трактат');
    expect(t).toContain('Накидка');
    // бали й «чому»
    expect(t).toContain('101.17');
    expect(t).toContain('3.83');
    expect(t).toContain('r9r2 60 · +12 25 · кам 1.2 · ka 15');
    expect(t).toContain('свап: ПЗ 21');
    // підсумок картки: бали за речі = main + sets + pair; сума конфігурації; складові; примітка
    expect(t).toContain('Розклад по речах · 268.68 б.');
    expect(t).toContain('Головний 106.17 б.');
    expect(t).toContain('Головний 251.85 · сети 11.83 (до стелі 31) · ШГ + Вознєс 5 · клас 8 · рівень 7 · джин 10');
    expect(t).toContain('«Шлем героя» у 2 екземплярах');
    expect(t).not.toMatch(/NaN|undefined|Infinity|\[object/);
  });

  it('типово згорнуто; open — розгорнуто; свій заголовок', () => {
    expect(render()).toMatch(/^<details class="score-bd">/);
    expect(render({ open: true })).toMatch(/^<details class="score-bd" open/);
    expect(visible(render({ title: 'Що зарахувала лялька' }))).toContain('Що зарахувала лялька · 268.68 б.');
  });

  it('showPoints=false — публічний вигляд: слоти й назви без жодного числа скору', () => {
    const t = visible(render({ showPoints: false }));
    expect(t).toContain('Комплект твердині');
    expect(t).toContain('Зброя');
    expect(t).toContain('Сет «Спів»');
    for (const n of ['101.17', '268.68', '251.85', '3.83', 'клас 8', 'джин 10']) expect(t).not.toContain(n);
    expect(t).toContain('свап: ПЗ 21'); // «чому» лишається — це не число скору
  });

  it('без resolver і назв сетів — слот, бали, «Сет N»; невідомий слот — як є', () => {
    const t = visible(renderToStaticMarkup(<ScoreBreakdown breakdown={{ ...B, rows: [...B.rows, [3, 'zz', 1, 1]] }} />));
    expect(t).not.toContain('Комплект твердині');
    expect(t).toContain('Зброя');
    expect(t).toContain('Сет 1');
    expect(t).toContain('Сет 2');
    expect(t).toContain('Сет 3');
    expect(t).toContain('zz');
  });

  it('порожній розклад — «Зарахованих речей немає», без примітки й до стелі; null — нічого', () => {
    const t = visible(renderToStaticMarkup(<ScoreBreakdown breakdown={{ v: 1, ver: 'balance-v1.0', sum: { main: 0, sets: 0, setsRaw: 0, pair: 0 }, rows: [] }} />));
    expect(t).toContain('Зарахованих речей немає');
    expect(t).toContain('Розклад по речах · 0 б.');
    expect(t).toContain('Головний 0 · сети 0');
    expect(t).not.toContain('до стелі');
    expect(renderToStaticMarkup(<ScoreBreakdown breakdown={null} />)).toBe('');
  });

  it('помічники: групування, підписи конфігурацій, формат балів, рядок складових', () => {
    expect(groupRows(B.rows).map((g) => [g.cfg, g.rows.length])).toEqual([[0, 2], [1, 2], [2, 1]]);
    expect(groupRows([])).toEqual([]);
    expect(cfgLabel(0, SETS)).toBe('Головний');
    expect(cfgLabel(1, SETS)).toBe('Сет «Спів»');
    expect(cfgLabel(3, SETS)).toBe('Сет 3');
    expect(cfgLabel(2)).toBe('Сет 2');
    expect(fmtPoints(21)).toBe('21');
    expect(fmtPoints(3.8333)).toBe('3.83');
    expect(fmtPoints(0.5)).toBe('0.5');
    expect(sumLine({ main: 10, sets: 2, setsRaw: 2, pair: 0 })).toBe('Головний 10 · сети 2');
    expect(sumLine({ cls: 5, lvl: 0, genie: 0, main: 10, sets: 2, setsRaw: 9, pair: 5 })).toBe('Головний 10 · сети 2 (до стелі 9) · ШГ + Вознєс 5 · клас 5 · рівень 0 · джин 0');
  });

  it('підписи слотів головного бандла збігаються з core SLOTS ляльки (крім «Книга» → «Трактат»)', () => {
    expect(Object.keys(SLOT_LABELS).sort()).toEqual(SLOTS.map((s) => s.slot).sort());
    for (const s of SLOTS) expect(SLOT_LABELS[s.slot], s.slot).toBe(s.slot === 'qn' ? 'Трактат' : s.label);
    expect(slotLabel('ta')).toBe('Зброя');
    expect(slotLabel('nope')).toBe('nope');
  });
});
