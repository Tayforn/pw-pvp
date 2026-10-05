// =========================================================
// Сканер скріншотів з командного рядка — щоб перевірити розпізнавання на нових
// скріншотах без інтерфейсу. Друкує, які речі впізнано, які числа прочитано,
// якою лялькою сторінка заповнила б нового персонажа і наскільки її числа
// розходяться з грою. З --doll порівнює з грою ще й готову ляльку.
//
// Запуск:
//   npx vite-node scripts/doll-scan.ts -- --equip спорядження.png --stats персонаж.png [--doll лялька.json]
// Скріншоти — PNG у рідному масштабі; лялька — документ персонажа або
// відповідь /api/pvp/characters/<id>.
// =========================================================

import fs from 'node:fs';
import { SLOTS } from '../src/doll/core/constants';
import { loadTestRefData, readJson, testCatalog } from '../src/doll/core/__tests__/testData';
import type { Item } from '../src/doll/core/types';
import { SLOT_CAT, SLOT_KEYS, emptyDoc, validateDoc, type CharacterDoc } from '../src/doll/model/doc';
import { compareStats, type StatRow } from '../src/doll/scan/compare';
import { scanEquip, type EquipScan } from '../src/doll/scan/equip';
import { fillFromShots } from '../src/doll/scan/fill';
import { scanStats, type StatsScan } from '../src/doll/scan/stats';
import { loadPng, testSource } from '../src/doll/scan/__tests__/load';

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};

const lookup = testCatalog();
const SLOT_LABEL: Record<string, string> = Object.fromEntries(SLOTS.map((s) => [s.slot, s.label]));
const itemName = (cat: string, id: number): string => `«${String(lookup(cat, id)?.name ?? '?')}» (${cat} ${id})`;

function printStats(title: string, rows: StatRow[]): void {
  const bad = rows.filter((r) => r.ok === false);
  const unread = rows.filter((r) => r.ok === null);
  console.log(`${title}: збігається ${rows.length - bad.length - unread.length} з ${rows.length}` + (unread.length ? `, не прочитано ${unread.length}` : ''));
  for (const r of bad) console.log(`    ${r.label}: гра ${r.game}, лялька ${r.doll}`);
}

async function main(): Promise<void> {
  loadTestRefData();
  const dollPath = arg('doll');
  let doll: CharacterDoc | null = null;
  if (dollPath) {
    const raw = JSON.parse(fs.readFileSync(dollPath, 'utf8')) as { doc?: unknown };
    const v = validateDoc(raw.doc ?? raw);
    if (!v.ok) throw new Error('лялька не проходить перевірку: ' + JSON.stringify(v.errors));
    doll = v.doc;
  }

  // Спершу характеристики: вони дають масштаб інтерфейсу, з яким сітку спорядження шукати швидше.
  let stats: StatsScan | null = null;
  const statsPath = arg('stats');
  if (statsPath) {
    const scan = scanStats(await loadPng(statsPath));
    if (!scan.ok) console.log('Характеристики: ' + scan.reason);
    else {
      stats = scan;
      console.log(
        `Характеристики: масштаб ${scan.scale.toFixed(3)}, прочитано ${Object.keys(scan.values).length}` + (scan.unread.length ? ', не прочитано: ' + scan.unread.join(', ') : ''),
      );
      console.log('  ' + JSON.stringify(scan.values));
    }
  }

  const src = await testSource([...new Set(SLOT_KEYS.map((s) => SLOT_CAT[s]))]);
  let equip: EquipScan | null = null;
  const equipPath = arg('equip');
  if (equipPath) {
    // Без класу й статі — як на сторінці: їх визначає заповнення ляльки.
    const scan = scanEquip(await loadPng(equipPath), src, { scale: stats?.scale });
    if (!scan.ok) console.log('Спорядження: ' + scan.reason);
    else {
      equip = scan;
      const seen = SLOT_KEYS.filter((s) => scan.slots[s].state === 'item').length;
      console.log(`Спорядження: масштаб ${scan.scale}, видно клітинок ${scan.cells} з 24, впізнано речей ${seen}`);
    }
  }

  if (equip) {
    const ob = readJson<Item[]>('ob');
    const fill = fillFromShots({ equip, stats, base: doll ?? emptyDoc(), items: (cat) => (cat === 'ob' ? ob : src.items(cat)) });
    const d = fill.doc;
    console.log(
      `Лялька зі скріншотів: клас ${d.cls}${fill.clsSure ? '' : ' (не визначено)'}, стать ${d.gender}, рівень ${d.level}${fill.levelRead ? '' : ' (не прочитано)'}`,
    );
    for (const p of fill.picks) {
      const others = p.others.length ? '  — ще з такою іконкою: ' + p.others.join(', ') : '';
      console.log(`  ${(SLOT_LABEL[p.slot] ?? p.slot).padEnd(18)} ${itemName(SLOT_CAT[p.slot], p.id)}${others}`);
    }
    if (fill.unknown.length) console.log('  не впізнано: ' + fill.unknown.map((s) => SLOT_LABEL[s] ?? s).join(', '));
    if (fill.attrs) {
      console.log('  камені (припущення): ' + (fill.gems.map((g) => `${g.count} × ${itemName('ob', g.id)} = +${g.total} ${g.stat}`).join(', ') || 'немає'));
      console.log(`  атрибути (оцінка): ${JSON.stringify(d.attrs)}, зрізано ${fill.attrs.cut}`);
    }
    if (stats) printStats('Числа (заповнена лялька, Головний)', compareStats(d, 'main', stats, lookup));
  }

  if (doll && stats) {
    for (const cfg of [{ id: 'main', name: 'Головний' }, ...doll.sets]) printStats(`Числа (лялька «${doll.name}», ${cfg.name})`, compareStats(doll, cfg.id, stats, lookup));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
