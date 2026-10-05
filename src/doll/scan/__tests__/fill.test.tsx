// =========================================================
// Заповнення нової ляльки зі скріншотів на трьох парах (лучник, страж, містик):
// речі, клас, стать, рівень, камені й атрибути; пачка знімків у довільному
// порядку; знімок усього екрана; розмітка підказки «гра / лялька». jsdom у
// проєкті немає, тож панель (вставка файлів, кнопка «Заповнити») перевірено
// руками в браузері — див. docs/doll.md.
// =========================================================

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRefData, readJson, testCatalog } from '../../core/__tests__/testData';
import type { Item } from '../../core/types';
import { SLOT_CAT, SLOT_KEYS, attrPointsLeft, emptyDoc, validateDoc, type CharacterDoc, type SlotKey } from '../../model/doc';
import { equip as putOn } from '../../model/ops';
import { compareStats, dollNumbers } from '../compare';
import { scanEquip, type ScanSource } from '../equip';
import { fillFromShots, type FillResult } from '../fill';
import type { Raster } from '../raster';
import { readShots, type ShotRead } from '../session';
import StatsHint from '../ui/StatsHint';
import dollJson from './fixtures/doll-1.json';
import { fixture, testSource } from './load';

const lookup = testCatalog();
const CATS = [...new Set(SLOT_KEYS.map((s) => SLOT_CAT[s]))];
let src: ScanSource;
let items: (cat: string) => readonly Item[] | null;
/** Розпізнані пари: спорядження + вікно «Персонаж». */
const pairs: Record<string, { read: ShotRead[]; fill: FillResult }> = {};

const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
/** Видимий текст розмітки: теги прибрано, пробіли стиснуто. */
const visible = (html: string): string =>
  html.replace(new RegExp(LT + '[^' + GT + ']*' + GT, 'g'), ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** Вставити картинки у великий кадр із шумом — як вікна на знімку всього екрана. */
function screen(w: number, h: number, parts: Array<[Raster, number, number]>): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 4242;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = i % 4 === 3 ? 255 : 40 + ((seed >> 16) % 120);
  }
  for (const [r, ox, oy] of parts) for (let y = 0; y < r.h; y++) data.set(r.data.subarray(y * r.w * 4, (y + 1) * r.w * 4), ((oy + y) * w + ox) * 4);
  return { w, h, data };
}

beforeAll(async () => {
  loadTestRefData();
  src = await testSource(CATS);
  const ob = readJson<Item[]>('ob');
  items = (cat) => (cat === 'ob' ? ob : src.items(cat));
  for (const [key, e, s] of [['archer', 'equip-1.png', 'stats-1.png'], ['seeker', 'f2.png', 'f1.png'], ['mystic', 'l2.png', 'l1.png']]) {
    // спорядження першим: масштаб усе одно береться з вікна «Персонаж»
    const read = readShots([await fixture(e), await fixture(s)], src);
    if (!read[0].equip || !read[1].stats) throw new Error('пару ' + key + ' не розпізнано');
    pairs[key] = { read, fill: fillFromShots({ equip: read[0].equip, stats: read[1].stats, base: { ...emptyDoc(), name: 'Мій перс' }, items }) };
  }
}, 120000);

const picked = (r: FillResult): Partial<Record<SlotKey, number>> => Object.fromEntries(r.picks.map((p) => [p.slot, p.id]));

describe('readShots — пачка знімків у довільному порядку', () => {
  it('сам розбирає, де яке вікно, і бере масштаб з вікна «Персонаж»', () => {
    const { read } = pairs.seeker;
    expect([!!read[0].equip, !!read[0].stats]).toEqual([true, false]);
    expect([!!read[1].equip, !!read[1].stats]).toEqual([false, true]);
    expect(Math.abs((read[0].equip?.scale ?? 0) - 1.04)).toBeLessThan(0.004);
    expect(read[1].stats?.values.hp).toBe(17290);
    expect(read.flatMap((r) => r.reasons)).toEqual([]);
  });

  it('знімок, на якому немає жодного вікна, — причини, а не виняток', () => {
    const [read] = readShots([screen(300, 200, [])], src);
    expect([read.equip, read.stats]).toEqual([null, null]);
    expect(read.reasons).toHaveLength(2);
  }, 30000);
});

describe('знімок усього екрана', () => {
  it('обидва вікна на одному знімку (масштаб 1:1)', async () => {
    const [read] = readShots([screen(1400, 800, [[await fixture('stats-1.png'), 60, 120], [await fixture('equip-1.png'), 700, 300]])], src);
    expect(read.stats?.values.physMin).toBe(10573);
    expect(read.equip?.slots.ta.an).toBe(54);
    expect(read.equip && [read.equip.x, read.equip.y]).toEqual([705, 309]);
  }, 30000);

  it('масштаб 1.04: з підказкою сітку знайдено й вирізано, без підказки — зрозуміла відмова', async () => {
    const big = screen(1400, 800, [[await fixture('l2.png'), 500, 250]]);
    const hinted = scanEquip(big, src, { scale: 1.038, gender: 'f' });
    expect(hinted.ok && hinted.slots.ta.an).toBe(465);
    // сітка — в координатах великого знімка (приведеного до 1:1), а не вирізаного шматка
    expect(hinted.ok && hinted.x > 500 / 1.05 && hinted.x < 520 && hinted.y > 250 / 1.05 + 40 && hinted.y < 320).toBe(true);
    const blind = scanEquip(big, src, { gender: 'f' });
    expect(blind.ok).toBe(false);
    expect(!blind.ok && blind.reason).toContain('вікна «Персонаж»');
  }, 30000);
});

describe('fillFromShots — нова лялька зі скріншотів', () => {
  it('клас, стать і рівень — за речами й вікном «Персонаж»; імʼя лишається', () => {
    expect(Object.entries(pairs).map(([k, p]) => [k, p.fill.doc.cls, p.fill.doc.gender, p.fill.doc.level, p.fill.clsSure, p.fill.levelRead])).toEqual([
      ['archer', 'js', 'm', 104, true, true],
      ['seeker', 'ej', 'f', 105, true, true],
      ['mystic', 'rg', 'f', 103, true, true],
    ]);
    expect(pairs.archer.fill.doc.name).toBe('Мій перс');
  });

  it('лучник: речі ті самі, що у справжній ляльці гравця', () => {
    const { fill } = pairs.archer;
    // зі спільних іконок вибрано комплектні речі (ШГ + Вознєс, сет R8R), а не «сановника» й не пояс із зайвою ПА
    expect(picked(fill)).toMatchObject({ ta: 1816, ft: 83, wy: 40, rv: 373, tg: 340, rx: 304, mj: 293, vx: 157, st: 179, cr: 180, qn: 92, pk: 3, it: 20 });
    const real = validateDoc(dollJson);
    if (!real.ok) throw new Error('фікстура ляльки не проходить validateDoc');
    const worn = putOn(real.doc, 's0000m', 'qn', 'f');
    const set = worn.sets.find((s) => s.id === 's0000m')!;
    for (const slot of ['ta', 'ft', 'wy', 'rv', 'tg', 'rx', 'mj', 'vx', 'st', 'cr', 'qn', 'it'] as const) {
      expect([slot, picked(fill)[slot]]).toEqual([slot, worn.items.find((it) => it.i === set.slots[slot])?.id]);
    }
    // іконки польоту гравця в каталозі для лучника немає — слот лишається порожній, а не з чужою річчю
    expect(fill.unknown).toEqual(['ic']);
    expect(fill.doc.main.ic).toBeUndefined();
  });

  it('страж і містик: комплектна броня свого класу, зброя — та, що на скріншоті', () => {
    expect(picked(pairs.seeker.fill)).toMatchObject({ ta: 1767, rv: 367, tg: 342, rx: 303, mj: 292, ft: 184, st: 180, qn: 91 });
    expect(picked(pairs.mystic.fill)).toMatchObject({ ta: 1743, rv: 353, tg: 336, rx: 309, mj: 290, ft: 83, wy: 40, st: 177, cd: 180 });
    // заглушку каталогу «Не используется» з тією ж іконкою шолома не беремо
    expect(pairs.seeker.fill.picks.find((p) => p.slot === 'ft')?.others).toContain(171);
  });

  it('ляльку можна зберегти: документ валідний, очок атрибутів не більше, ніж дає рівень, усі речі «вдягаються»', () => {
    for (const [key, { fill }] of Object.entries(pairs)) {
      const v = validateDoc(fill.doc);
      expect([key, v.ok, v.ok ? [] : v.errors]).toEqual([key, true, []]);
      expect(attrPointsLeft(fill.doc.level, fill.doc.attrs), key).toBe(0);
      // зброя працює (є атаки за секунду) — отже, вимоги речей до атрибутів дотримано
      expect(dollNumbers(fill.doc, 'main', lookup).aps, key).toBeGreaterThan(0);
    }
  });

  it('речі не дають більше ПА, ПЗ чи криту, ніж у грі; камені лише добирають до чисел гри', () => {
    for (const [key, { read, fill }] of Object.entries(pairs)) {
      const game = read[1].stats!.values;
      const n = dollNumbers(fill.doc, 'main', lookup);
      expect(n.pa, key).toBeLessThanOrEqual(game.pa!);
      expect(n.pz, key).toBeLessThanOrEqual(game.pz!);
      expect(fill.gems.reduce((sum, g) => sum + g.count, 0), key).toBeLessThanOrEqual(26);
    }
    // лучник: надлишок атрибутів пояснено каменями на Тілобудову, решта гнізд — показник захисту
    const { fill, read } = pairs.archer;
    expect(fill.gems.map((g) => [g.stat, g.count, g.total])).toEqual([['lf', 14, 168], ['sx', 10, 20]]);
    // сума Тілобудови в ляльці — як у грі
    const rows = compareStats(fill.doc, 'main', read[1].stats!, lookup);
    expect(rows.find((r) => r.key === 'vit')?.ok).toBe(true);
    expect(fill.attrs).toEqual({ cut: 82 });
    expect(fill.doc.attrs).toEqual({ str: 84, dex: 434, vit: 5, mag: 12 });
  });

  it('без вікна «Персонаж»: лише речі, клас і стать; рівень і атрибути — з поточної ляльки', () => {
    const base: CharacterDoc = { ...emptyDoc('by'), level: 101 };
    const fill = fillFromShots({ equip: pairs.archer.read[0].equip!, stats: null, base, items });
    expect([fill.doc.cls, fill.doc.gender, fill.doc.level, fill.levelRead]).toEqual(['js', 'm', 101, false]);
    expect(fill.attrs).toBeNull();
    expect(fill.gems).toEqual([]);
    expect(fill.doc.attrs).toEqual({ str: 5, dex: 5, vit: 5, mag: 5 });
    expect(picked(fill)).toMatchObject({ ta: 1816, rv: 373, ft: 83 });
    expect(validateDoc(fill.doc).ok).toBe(true);
  });
});

describe('StatsHint — підказка «гра / лялька»', () => {
  const render = (doc: CharacterDoc, key = 'archer', cfgId = 'main'): string =>
    renderToStaticMarkup(<StatsHint doc={doc} cfgId={cfgId} stats={pairs[key].read[1].stats!} onClose={() => {}} lookup={lookup} />);

  it('щойно заповнена лялька: розбіжності згори, повна таблиця — під «Усі числа»', () => {
    const html = render(pairs.archer.fill.doc);
    const text = visible(html);
    expect(text).toMatch(/Числа з гри збігається \d+ з 26/);
    // згори — компактний перелік розбіжностей «гра → лялька»
    expect(html).toMatch(/<li><span>ЖС<\/span><b>14622 → \d+<\/b><i>−\d+<\/i><\/li>/);
    expect(html).toMatch(/<tr class="is-bad"><td>ЖС<\/td><td>14622<\/td><td>\d+<\/td><td>−\d+<\/td>/);
    expect(text).toContain('Усі числа (26)');
    // у повній таблиці є й рядки, що збігаються
    expect(html).toMatch(/<tr class=""><td>Тіло<\/td><td>218<\/td><td>218<\/td><td><\/td>/);
    expect(text).not.toMatch(/NaN|undefined|Infinity|\[object/);
  });

  it('справжня лялька гравця в сеті, що надітий у грі, — усе збігається', () => {
    const real = validateDoc(dollJson);
    if (!real.ok) throw new Error('фікстура ляльки не проходить validateDoc');
    const text = visible(render(putOn(real.doc, 's0000m', 'qn', 'f'), 'archer', 's0000m'));
    expect(text).toContain('збігається 26 з 26');
    expect(text).toContain('дає ті самі числа');
  });

  it('невідомий комплект (сет видалили) — рахує Головний, а не падає', () => {
    expect(visible(render(pairs.archer.fill.doc, 'archer', 'gone'))).toContain('Числа з гри');
  });
});
