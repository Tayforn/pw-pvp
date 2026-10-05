// =========================================================
// Сканер скріншотів на трьох парах від різних гравців: equip-1 / stats-1 (лучник,
// масштаб інтерфейсу 1.00), f2 / f1 (страж) і l2 / l1 (містик) — обидві з
// масштабом 1.04. Очікувані іконки звірено очима, числа — зі скріншотів.
// Лялька є лише для лучника, і у фікстурі вона зі «старим» трактатом у сеті:
// звірка має знайти розбіжність, виправити її з інвентаря і після цього
// збігтися з грою по всіх числах.
// =========================================================

import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRefData, testCatalog } from '../../core/__tests__/testData';
import { SLOT_CAT, SLOT_KEYS, validateDoc, type CharacterDoc, type SlotKey } from '../../model/doc';
import { scanEquip, type EquipScan, type ScanSource } from '../equip';
import { resample, type Raster } from '../raster';
import { applyFixes, compareStats, matchConfigs, reconcile } from '../reconcile';
import { scanStats, type StatKey, type StatsScan } from '../stats';
import dollJson from './fixtures/doll-1.json';
import { fixture, testSource } from './load';

const lookup = testCatalog();
let src: ScanSource;
let equipShot: Raster;
let statsShot: Raster;
let doc: CharacterDoc;

beforeAll(async () => {
  loadTestRefData();
  src = await testSource([...new Set(SLOT_KEYS.map((s) => SLOT_CAT[s]))]);
  equipShot = await fixture('equip-1.png');
  statsShot = await fixture('stats-1.png');
  const v = validateDoc(dollJson);
  if (!v.ok) throw new Error('фікстура ляльки не проходить validateDoc');
  doc = v.doc;
});

/** Вставити картинку в більший кадр із шумом — як вікно на знімку всього екрана. */
function embed(r: Raster, w: number, h: number, ox: number, oy: number): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 12345;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = i % 4 === 3 ? 255 : 40 + (seed >> 16) % 120;
  }
  for (let y = 0; y < r.h; y++) data.set(r.data.subarray(y * r.w * 4, (y + 1) * r.w * 4), ((oy + y) * w + ox) * 4);
  return { w, h, data };
}

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error('скан не вдався: ' + JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

/** Іконки еталонного скріншота: слот → індекс у спрайті; null — слот порожній. */
const ICONS: Icons = {
  ft: 25, vx: 53, wy: 13, qn: 91, rv: 41, gv: null, mj: 23, st: 57, pp: null, tg: 29, ta: 54, cr: 57, cd: 59, pk: 3, rx: 21, it: 18,
};
type Icons = Partial<Record<SlotKey, number | null>>;
function expectIcons(scan: EquipScan, icons: Icons = ICONS): void {
  for (const [slot, an] of Object.entries(icons) as Array<[SlotKey, number | null]>) {
    const s = scan.slots[slot];
    if (an === null) expect(s.state, slot).toBe('empty');
    else expect([slot, s.state, s.an]).toEqual([slot, 'item', an]);
  }
}

describe('scanEquip', () => {
  it('знаходить сітку і впізнає речі', () => {
    const scan = ok(scanEquip(equipShot, src, { cls: 'js', level: 104 }));
    expect([scan.scale, scan.x, scan.y, scan.cells, scan.gender]).toEqual([1, 5, 9, 24, 'm']);
    expectIcons(scan);
    // однозначні іконки дають одну річ каталогу
    expect(scan.slots.vx.ids).toEqual([157]);
    expect(scan.slots.qn.ids).toEqual([92]);
    expect(scan.slots.pk.ids).toEqual([3]);
    expect(scan.slots.it.ids).toEqual([20]);
    // спільна іконка — кілька кандидатів, справжня річ серед них
    expect(scan.slots.ta.ids).toContain(1816);
    expect(scan.slots.rv.ids).toContain(373);
    expect(scan.slots.cd.ids).toEqual(expect.arrayContaining([184, 195]));
    // чужі класу речі відкинуто: з усіх R9-кілець лишились загальне і кільце лучника
    expect(scan.slots.cd.ids).toHaveLength(2);
    // перефарбована на сервері іконка «Срібного місяця» — збіг є, але не впевнений
    expect(scan.slots.cr.ids).toEqual([180]);
    expect(scan.slots.cr.sure).toBe(false);
    expect(scan.slots.st.sure).toBe(true);
  });

  it('не залежить від місця вікна в кадрі', () => {
    const scan = ok(scanEquip(embed(equipShot, 640, 400, 213, 97), src, { gender: 'm' }));
    expect([scan.x, scan.y]).toEqual([218, 106]);
    expectIcons(scan);
  });

  it('впізнає речі на збільшеному скріншоті', () => {
    for (const k of [1.25, 1.5, 2]) {
      const scan = ok(scanEquip(resample(equipShot, k), src, { gender: 'm' }));
      expect(scan.scale).toBe(k);
      expectIcons(scan);
    }
  }, 30000);

  it('впізнає речі при масштабі інтерфейсу 1.04 — сам і з підказкою масштабу', async () => {
    const pairs: Array<[string, Icons]> = [
      ['f2.png', { ft: 50, vx: 49, wy: 21, qn: 90, rv: 42, gv: null, mj: 21, st: 58, pp: null, tg: 30, ta: 476, cr: 55, cd: 56, pk: 3, rx: 23, it: null }],
      ['l2.png', { ic: 29, ft: 25, vx: 51, wy: 13, qn: 90, rv: 43, gv: null, mj: 22, st: 55, pp: null, tg: 31, ta: 465, cr: 54, cd: 57, pk: 3, rx: 22, it: null }],
    ];
    for (const [name, icons] of pairs) {
      const shot = await fixture(name);
      // без підказки масштаб перебирається (довше) — досить перевірити на одному скріншоті
      for (const scale of name === 'f2.png' ? [undefined, 1.038] : [1.038]) {
        const scan = ok(scanEquip(shot, src, { scale }));
        expect(Math.abs(scan.scale - 1.04)).toBeLessThan(0.004);
        expect([scan.cells, scan.gender]).toEqual([24, 'f']);
        expectIcons(scan, icons);
        // іконки польоту стража в каталозі немає — «не впізнано», а не чужа річ
        if (name === 'f2.png') expect(scan.slots.ic.state).toBe('unknown');
      }
    }
  }, 30000);

  it('без сітки слотів — зрозуміла відмова', () => {
    expect(scanEquip(statsShot, src).ok).toBe(false);
  }, 30000);
});

const GAME: Record<StatKey, number> = {
  level: 104, hp: 14622, mp: 3031, vit: 218, str: 111, mag: 15, dex: 502,
  physMin: 10573, physMax: 16054, magMin: 646, magMax: 646, crit: 34, aps: 0.71, acc: 6672, pa: 35, cast: 12, stealth: 0, mobDmg: 0,
  physDef: 7273, magDef: 9256, critDmg: 200, speed: 5.5, eva: 3984, pz: 59, soul: 22248, detect: 104, mobDef: 0,
};

const GAME_F: Record<StatKey, number> = {
  level: 105, hp: 17290, mp: 2169, vit: 310, str: 404, mag: 33, dex: 182,
  physMin: 10860, physMax: 13022, magMin: 439, magMax: 439, crit: 24, aps: 1.11, acc: 3355, pa: 25, cast: 6, stealth: 0, mobDmg: 0,
  physDef: 12096, magDef: 7840, critDmg: 200, speed: 5, eva: 2348, pz: 65, soul: 24640, detect: 105, mobDef: 0,
};
const GAME_L: Record<StatKey, number> = {
  level: 103, hp: 11537, mp: 7914, vit: 282, str: 99, mag: 304, dex: 5,
  physMin: 3111, physMax: 3496, magMin: 11498, magMax: 13643, crit: 13, aps: 1.25, acc: 449, pa: 55, cast: 23, stealth: 0, mobDmg: 0,
  physDef: 8640, magDef: 12796, critDmg: 200, speed: 5.1, eva: 850, pz: 23, soul: 34460, detect: 103, mobDef: 0,
};

describe('scanStats', () => {
  it('читає всі числа вікна «Персонаж»', () => {
    const scan = ok(scanStats(statsShot));
    expect(scan.unread).toEqual([]);
    expect(scan.values).toEqual(GAME);
    expect(scan.scale).toBeCloseTo(1, 2);
  });

  it('читає вікно з масштабом інтерфейсу 1.04 (інші гравці, інші класи)', async () => {
    for (const [name, game] of [['f1.png', GAME_F], ['l1.png', GAME_L]] as const) {
      const scan = ok(scanStats(await fixture(name)));
      expect(scan.unread).toEqual([]);
      expect(scan.values).toEqual(game);
      expect(Math.abs(scan.scale - 1.04)).toBeLessThan(0.01);
    }
  });

  it('не залежить від місця вікна в кадрі', () => {
    const scan = ok(scanStats(embed(statsShot, 700, 600, 151, 43)));
    expect(scan.values).toEqual(GAME);
  });

  it('на розмитому скріншоті не вигадує чисел: відмова або лише точні числа', () => {
    const scan = scanStats(resample(resample(statsShot, 1.25), 0.8));
    if (!scan.ok) return;
    expect(scan.unread.length).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(scan.values)) expect([k, v]).toEqual([k, GAME[k as StatKey]]);
  });

  it('без вікна «Персонаж» — зрозуміла відмова', () => {
    expect(scanStats(equipShot).ok).toBe(false);
  });
});

describe('reconcile', () => {
  let equip: EquipScan;
  let stats: StatsScan;
  beforeAll(() => {
    equip = ok(scanEquip(equipShot, src, { gender: doc.gender, cls: doc.cls, level: doc.level }));
    stats = ok(scanStats(statsShot));
  });

  it('визначає надітий сет і знаходить не ту річ', () => {
    const rec = reconcile(doc, equip, stats, lookup);
    expect(rec.cfg.name).toBe('ПЗ');
    const diffs = rec.cfg.slots.filter((d) => d.status !== 'same');
    expect(diffs.map((d) => [d.slot, d.status, d.fixIids])).toEqual([['qn', 'swap', ['f']]]);
    // Головний відрізняється ще й зброєю
    const main = rec.configs.find((c) => c.cfgId === 'main');
    expect(main?.slots.filter((d) => d.status !== 'same').map((d) => d.slot).sort()).toEqual(['qn', 'ta']);
  });

  it('до виправлення числа розходяться, після — збігаються всі', () => {
    const rec = reconcile(doc, equip, stats, lookup);
    expect(rec.stats?.filter((r) => r.ok === false).map((r) => r.key)).toEqual(
      expect.arrayContaining(['hp', 'vit', 'str', 'dex', 'physMin', 'physDef', 'magDef', 'acc', 'eva']),
    );
    expect(rec.applied).toEqual(['qn']);
    expect(rec.fixed?.sets.find((s) => s.name === 'ПЗ')?.slots.qn).toBe('f');
    expect(rec.statsFixed?.filter((r) => r.ok !== true)).toEqual([]);
    // сам документ не змінено
    expect(doc.sets.find((s) => s.name === 'ПЗ')?.slots.qn).toBe('3');
  });

  it('без скріншота спорядження вибирає конфігурацію за числами', () => {
    const fixed = applyFixes(doc, matchConfigs(doc, equip, lookup)[2]).doc;
    const rec = reconcile(fixed, null, stats, lookup);
    expect(rec.cfg.name).toBe('ПЗ');
    expect(rec.stats?.every((r) => r.ok)).toBe(true);
    expect(rec.fixed).toBeNull();
  });

  it('кільця на руках навхрест — не розбіжність', () => {
    const swapped: CharacterDoc = { ...doc, sets: doc.sets.map((s) => (s.name === 'ПЗ' ? { ...s, slots: { ...s.slots, cr: s.slots.cd, cd: s.slots.cr } } : s)) };
    const cfg = matchConfigs(swapped, equip, lookup).find((c) => c.name === 'ПЗ');
    expect(cfg?.slots.filter((d) => d.slot === 'cr' || d.slot === 'cd').map((d) => d.status)).toEqual(['same', 'same']);
  });

  it('порожній у грі слот проти зайнятого в ляльці — «зайва річ»', () => {
    const scan: EquipScan = { ...equip, slots: { ...equip.slots, wy: { ...equip.slots.wy, state: 'empty', ids: [] } } };
    const cfg = matchConfigs(doc, scan, lookup).find((c) => c.name === 'ПЗ');
    expect(cfg?.slots.find((d) => d.slot === 'wy')?.status).toBe('extra');
  });

  it('не впізнано однозначно, але найсхожіша іконка — та, що в ляльці: збіг', () => {
    const vague = { ...equip.slots.wy, state: 'unknown' as const, ids: [] };
    const cfg = (scan: EquipScan) => matchConfigs(doc, scan, lookup).find((c) => c.name === 'ПЗ')?.slots.find((d) => d.slot === 'wy')?.status;
    expect(cfg({ ...equip, slots: { ...equip.slots, wy: vague } })).toBe('same');
    expect(cfg({ ...equip, slots: { ...equip.slots, wy: { ...vague, an: 12 } } })).toBe('unsure');
  });

  it('compareStats: непрочитане число не вважається розбіжністю', () => {
    const partial: StatsScan = { ...stats, values: { ...stats.values, hp: undefined }, unread: ['hp'] };
    const row = compareStats(doc, 's0000m', partial, lookup).find((r) => r.key === 'hp');
    expect([row?.game, row?.ok]).toEqual([null, null]);
  });
});
