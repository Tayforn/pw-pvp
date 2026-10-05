// =========================================================
// Сканер скріншотів з командного рядка — щоб перевірити розпізнавання на нових
// скріншотах без інтерфейсу. Друкує, які речі впізнано, які числа прочитано і
// (якщо дано ляльку) звірку з нею.
//
// Запуск:
//   npx vite-node scripts/doll-scan.ts -- --equip спорядження.png --stats персонаж.png --doll лялька.json
// Будь-який з трьох аргументів можна пропустити. Скріншоти — PNG у рідному
// масштабі; лялька — документ персонажа або відповідь /api/pvp/characters/<id>.
// =========================================================

import fs from 'node:fs';
import { SLOTS } from '../src/doll/core/constants';
import { loadTestRefData, testCatalog } from '../src/doll/core/__tests__/testData';
import { SLOT_CAT, SLOT_KEYS, validateDoc, type CharacterDoc } from '../src/doll/model/doc';
import { scanEquip, type EquipScan } from '../src/doll/scan/equip';
import { reconcile, type StatRow } from '../src/doll/scan/reconcile';
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
const instName = (doc: CharacterDoc, iid: string | null): string => {
  const inst = iid ? doc.items.find((it) => it.i === iid) : undefined;
  return inst ? itemName(inst.cat, inst.id) + (inst.r ? ' +' + inst.r : '') : 'порожньо';
};

function printStats(title: string, rows: StatRow[]): void {
  const bad = rows.filter((r) => r.ok === false);
  const unread = rows.filter((r) => r.ok === null);
  console.log(`${title}: збігається ${rows.length - bad.length - unread.length} з ${rows.length}` + (unread.length ? `, не прочитано ${unread.length}` : ''));
  for (const r of bad) console.log(`    ${r.label}: гра ${r.game}, лялька ${r.doll}`);
}

async function main(): Promise<void> {
  loadTestRefData();
  const dollPath = arg('doll');
  let doc: CharacterDoc | null = null;
  if (dollPath) {
    const raw = JSON.parse(fs.readFileSync(dollPath, 'utf8')) as { doc?: unknown };
    const v = validateDoc(raw.doc ?? raw);
    if (!v.ok) throw new Error('лялька не проходить перевірку: ' + JSON.stringify(v.errors));
    doc = v.doc;
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

  let equip: EquipScan | null = null;
  const equipPath = arg('equip');
  if (equipPath) {
    const src = await testSource([...new Set(SLOT_KEYS.map((s) => SLOT_CAT[s]))]);
    const scan = scanEquip(await loadPng(equipPath), src, { scale: stats?.scale, ...(doc ? { gender: doc.gender, cls: doc.cls, level: doc.level } : {}) });
    if (!scan.ok) console.log('Спорядження: ' + scan.reason);
    else {
      equip = scan;
      console.log(`Спорядження: масштаб ${scan.scale}, видно клітинок ${scan.cells} з 24`);
      for (const slot of SLOT_KEYS) {
        const s = scan.slots[slot];
        const what =
          s.state === 'empty' ? 'порожньо' : s.state === 'unknown' ? 'не впізнано' : s.ids.map((id) => itemName(SLOT_CAT[slot], id)).join(' або ') + (s.sure ? '' : '  (?)');
        console.log(`  ${(SLOT_LABEL[slot] ?? slot).padEnd(18)} ${what}`);
      }
    }
  }

  if (!doc || (!equip && !stats)) return;
  const rec = reconcile(doc, equip, stats, lookup);
  console.log(`Звірка з лялькою «${doc.name}»: надіто «${rec.cfg.name}»` + (equip ? ` — збіглося слотів ${rec.cfg.same} з ${rec.cfg.slots.length}` : ''));
  for (const d of rec.cfg.slots) {
    if (d.status === 'same') continue;
    const label = SLOT_LABEL[d.slot] ?? d.slot;
    const seen = d.seen.ids.map((id) => itemName(SLOT_CAT[d.slot], id)).join(' або ');
    if (d.status === 'unsure') console.log(`  ${label}: на скріншоті не розібрати; у ляльці ${instName(doc, d.dollIid)}`);
    else if (d.status === 'extra') console.log(`  ${label}: у грі порожньо, у ляльці ${instName(doc, d.dollIid)}`);
    else {
      const fix = d.fixIids.length === 1 ? 'в інвентарі є — можна замінити' : d.fixIids.length ? `в інвентарі ${d.fixIids.length} такі речі — вибрати вручну` : 'в інвентарі такої немає';
      console.log(`  ${label}: у грі ${seen}, у ляльці ${instName(doc, d.dollIid)}; ${fix}`);
    }
  }
  if (rec.stats) printStats('Числа (лялька як є)', rec.stats);
  if (rec.statsFixed) printStats(`Числа після заміни (${rec.applied.map((s) => SLOT_LABEL[s] ?? s).join(', ')})`, rec.statsFixed);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
