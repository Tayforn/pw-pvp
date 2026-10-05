// =========================================================
// Сторінка звірки (/check) без браузера: розбір пачки знімків, знімок усього
// екрана, звіт і його розмітка, перший рендер сторінки. jsdom у проєкті немає,
// тож розмітку перевіряємо через renderToStaticMarkup, а вставку файлів і
// збереження — руками в браузері (див. docs/doll.md).
// =========================================================

import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTestRefData, readJson, testCatalog } from '../../core/__tests__/testData';
import { draftKey } from '../../api/draft';
import { ensureCats } from '../../data/catalog';
import { ensureRefData } from '../../data/refLoader';
import { SLOT_CAT, SLOT_KEYS, validateDoc, type CharacterDoc } from '../../model/doc';
import CheckPage from '../../../pages/CheckPage';
import { scanEquip, slotRect, type EquipScan, type ScanSource } from '../equip';
import type { Raster } from '../raster';
import { applyFix, buildReport } from '../reconcile';
import { readShots } from '../session';
import { scanStats, type StatsScan } from '../stats';
import CheckReport from '../ui/CheckReport';
import dollJson from './fixtures/doll-1.json';
import { fixture, testSource } from './load';

const lookup = testCatalog();
const CATS = [...new Set(SLOT_KEYS.map((s) => SLOT_CAT[s]))];
let src: ScanSource;
let doc: CharacterDoc;
let equipShot: Raster;
let statsShot: Raster;
let equip: EquipScan;
let stats: StatsScan;

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

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}
let store = memoryStorage();

beforeAll(async () => {
  loadTestRefData();
  src = await testSource(CATS);
  equipShot = await fixture('equip-1.png');
  statsShot = await fixture('stats-1.png');
  const v = validateDoc(dollJson);
  if (!v.ok) throw new Error('фікстура ляльки не проходить validateDoc');
  doc = v.doc;
  const st = scanStats(statsShot);
  const eq = scanEquip(equipShot, src, { gender: doc.gender, cls: doc.cls, level: doc.level });
  if (!st.ok || !eq.ok) throw new Error('еталонні скріншоти не розпізнано');
  stats = st;
  equip = eq;
  // Сторінка бере каталог і довідники тим самим кодом застосунку — лише fetch віддає JSON з диска.
  vi.stubGlobal('fetch', async (url: string) => {
    const name = String(url).split('/').pop()!.replace(/[?#].*$/, '').replace(/\.json$/, '');
    return { ok: true, status: 200, json: async () => readJson(name) };
  });
  await ensureRefData();
  await ensureCats([...CATS, 'ob', 'wdf', 'crystal']);
}, 60000);
beforeEach(() => {
  store = memoryStorage();
  vi.stubGlobal('localStorage', store);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('readShots — пачка знімків у довільному порядку', () => {
  it('сам розбирає, де яке вікно, і бере масштаб з вікна «Персонаж»', async () => {
    const reads = readShots([await fixture('f2.png'), await fixture('f1.png')], src);
    expect([!!reads[0].equip, !!reads[0].stats]).toEqual([true, false]);
    expect([!!reads[1].equip, !!reads[1].stats]).toEqual([false, true]);
    expect(Math.abs((reads[0].equip?.scale ?? 0) - 1.04)).toBeLessThan(0.004);
    expect(reads[1].stats?.values.hp).toBe(17290);
    expect(reads.flatMap((r) => r.reasons)).toEqual([]);
  }, 30000);

  it('знімок, на якому немає жодного вікна, — причини, а не виняток', () => {
    const noise = screen(300, 200, []);
    const [read] = readShots([noise], src);
    expect([read.equip, read.stats]).toEqual([null, null]);
    expect(read.reasons).toHaveLength(2);
  }, 30000);
});

describe('знімок усього екрана', () => {
  it('обидва вікна на одному знімку (масштаб 1:1)', () => {
    const [read] = readShots([screen(1400, 800, [[statsShot, 60, 120], [equipShot, 700, 300]])], src, { gender: 'm' });
    expect(read.stats?.values.physMin).toBe(10573);
    expect(read.equip?.slots.ta.an).toBe(54);
    expect(read.equip && [read.equip.x, read.equip.y]).toEqual([705, 309]);
  }, 30000);

  it('масштаб 1.04: з підказкою сітку знайдено й вирізано, без підказки — зрозуміла відмова', async () => {
    const big = screen(1400, 800, [[await fixture('l2.png'), 500, 250]]);
    const hinted = scanEquip(big, src, { scale: 1.038, gender: 'f' });
    expect(hinted.ok && hinted.slots.ta.an).toBe(465);
    // клітинка зброї в координатах великого знімка лежить усередині вставленого вікна
    const r = hinted.ok ? slotRect(hinted, 'ta') : { x: 0, y: 0, w: 0, h: 0 };
    expect(r.x > 500 && r.x + r.w < 500 + 336 && r.y > 250 && r.y + r.h < 250 + 246).toBe(true);
    const blind = scanEquip(big, src, { gender: 'f' });
    expect(blind.ok).toBe(false);
    expect(!blind.ok && blind.reason).toContain('вікна «Персонаж»');
  }, 30000);
});

describe('buildReport і applyFix', () => {
  it('сам визначає комплект; ручний вибір його перекриває', () => {
    const auto = buildReport(doc, equip, stats, null, lookup);
    expect([auto.autoCfgId, auto.cfg.name]).toEqual(['s0000m', 'ПЗ']);
    const manual = buildReport(doc, equip, stats, 'main', lookup);
    expect([manual.autoCfgId, manual.cfg.name]).toEqual(['s0000m', 'Головний']);
    // невідомий id (сет тим часом видалили) — знову автоматичний
    expect(buildReport(doc, equip, stats, 'nope', lookup).cfg.name).toBe('ПЗ');
  });

  it('заміна з інвентаря лягає в сет, а джин — у Головний', () => {
    const fixed = applyFix(doc, 's0000m', 'qn', 'f');
    expect(fixed.sets.find((s) => s.id === 's0000m')?.slots.qn).toBe('f');
    expect(buildReport(fixed, equip, stats, null, lookup).stats?.every((r) => r.ok)).toBe(true);
    const withGenie: CharacterDoc = { ...doc, items: [...doc.items, { i: 'zz', cat: 'pk', id: 1 }] };
    expect(applyFix(withGenie, 's0000m', 'pk', 'zz').main.pk).toBe('zz');
  });
});

describe('CheckReport — розмітка звіту', () => {
  const render = (d: CharacterDoc, eq: EquipScan | null, st: StatsScan | null, cfgId: string | null = null): string =>
    renderToStaticMarkup(<CheckReport doc={d} equip={eq} stats={st} cfgId={cfgId} onCfg={() => {}} onFix={() => {}} lookup={lookup} />);

  it('без скріншотів нічого не малює', () => {
    expect(render(doc, null, null)).toBe('');
  });

  it('розбіжність у книзі: що в грі, що в ляльці, кнопка заміни й числа', () => {
    const html = render(doc, equip, stats);
    const text = visible(html);
    expect(html).toMatch(/class="chk-cfg is-on"[^>]*><span>ПЗ<\/span><span class="chk-cfg-n">15\/16</);
    expect(text).toContain('збіглося 15 з 16');
    expect(html).toMatch(/data-slot="qn"/);
    expect(text).toMatch(/у грі .*Девять кудзу .*у ляльці .*Феникс летит к рассвету .*Надіти: .*Девять кудзу/);
    expect(text).toContain('Збігаються (15)');
    expect(text).toContain('збігається 15 з 26');
    expect(html).toMatch(/<tr class="is-bad"><td>ЖС<\/td><td>14622<\/td><td>14418<\/td><td>−204<\/td>/);
    expect(html).toMatch(/<tr class=""><td>Атак\/сек<\/td><td>0\.71<\/td><td>0\.71<\/td><td><\/td>/);
    expect(text).not.toMatch(/NaN|undefined|Infinity|\[object/);
  });

  it('після заміни — усе зелене', () => {
    const text = visible(render(applyFix(doc, 's0000m', 'qn', 'f'), equip, stats));
    expect(text).toContain('Усі речі комплекту «ПЗ» збігаються зі скріншотом.');
    expect(text).toContain('Числа ляльки в комплекті «ПЗ» збігаються з грою.');
    expect(text).toContain('збігається 26 з 26');
  });

  it('лише вікно «Персонаж»: комплект за числами, блоку речей немає', () => {
    const text = visible(render(applyFix(doc, 's0000m', 'qn', 'f'), null, stats));
    expect(text).toContain('комплект підібрано за числами');
    expect(text).not.toContain('Речі');
    expect(text).toContain('збігається 26 з 26');
  });

  it('непрочитане число видно як «не прочитано» і розбіжністю не вважається', () => {
    const partial: StatsScan = { ...stats, values: { ...stats.values, hp: undefined }, unread: ['hp'] };
    const html = render(applyFix(doc, 's0000m', 'qn', 'f'), equip, partial);
    expect(html).toMatch(/<tr class="is-mute"><td>ЖС<\/td><td>не прочитано<\/td>/);
    expect(visible(html)).toContain('збігається 25 з 25');
    expect(visible(html)).toContain('не прочитано 1');
  });
});

describe('CheckPage — перший рендер', () => {
  it('/check: до зʼясування входу — перевірка, без винятків', () => {
    const text = visible(renderToStaticMarkup(<CheckPage id={null} />));
    expect(text).toContain('Звірка зі скріншотами');
    expect(text).toContain('Перевірка входу');
  });

  it('/check/new з чернеткою: смужка персонажа, зона скріншотів, підказки', () => {
    store.setItem(draftKey('anon', 'new'), JSON.stringify(doc));
    const html = renderToStaticMarkup(<CheckPage id="new" />);
    const text = visible(html);
    expect(text).toContain('Tayforn');
    expect(text).toContain('Лучник · рівень 104 · чернетка в цьому браузері');
    expect(text).toContain('Ctrl + V');
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*multiple/);
    expect(text).toContain('Вікно спорядження ще немає');
    expect(text).toContain('Вікно «Персонаж» ще немає');
    expect(text).toContain('Знімай без бафів');
    // змін ще немає — кнопки збереження немає
    expect(text).not.toContain('Зберегти в ляльку');
    expect(text).not.toMatch(/NaN|undefined|Infinity|\[object/);
  });

  it('/check/new без чернетки: пояснення і дорога назад', () => {
    const text = visible(renderToStaticMarkup(<CheckPage id="new" />));
    expect(text).toContain('У цьому браузері немає чернетки персонажа.');
    expect(text).toContain('До вибору персонажа');
  });

  it('/check/<id> збереженого персонажа: спершу завантаження', () => {
    expect(visible(renderToStaticMarkup(<CheckPage id="k7" />))).toContain('Завантажую персонажа');
  });
});
