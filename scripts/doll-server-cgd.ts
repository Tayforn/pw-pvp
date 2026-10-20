// =========================================================
// ЦГД / РЦГД на сервері (скріни власника 20.10.2026): під кожною з 15 назв у
// грі є рівно дві речі — ЦГД (★, ПА 30) і РЦГД (★★): ті самі стати, швидкість,
// дальність, вимоги й абілка, лише ПА 50. Каталог mypers (новіша версія гри)
// натомість має під цими назвами 3–5 записів, частина — «переків» зі статами,
// яких на сервері немає (+70 / +130 / Сила +19 / ЖС +350), частина — копії з
// хибною швидкістю. Скрипт (ідемпотентний):
//   • ЦГД: дописує «Думкам Брахми» час активації −3% (ci 3) і виправляє
//     обмеження за класом (hi) так, як показує гра;
//   • кожен інший запис під цією назвою переписує на ЦГД + ПА 50 (свої id,
//     pw_id, іконка лишаються) — ляльки, де вже надіто «переків», отримують
//     серверні стати, а не зникають;
//   • у пікері лишає один РЦГД на назву: решта id ховається через
//     HIDDEN_FROM_PICK (src/doll/data/catalog.ts бере CGD_HIDDEN з тієї самої
//     таблиці src/doll/data/serverCgd.ts).
// Після каталогу з Хелпера: npx vite-node scripts/doll-server-cgd.ts, далі
// npx vite-node scripts/doll-data-ver.ts і npm test.
// =========================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CGD_ROWS } from '../src/doll/data/serverCgd';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TA = join(ROOT, 'src', 'doll', 'data', 'json', 'ta.json');

const CGD_PA = 30;
const RCGD_PA = 50;
const RCGD_TV = 43;
/** Поля запису, які лишаються своїми при переписуванні на РЦГД: ідентичність і іконка. */
const OWN_KEYS = ['id', 'pw_id', 'an', 'mi', 'pg'] as const;

type Item = Record<string, unknown> & { id: number; name: string; nw?: { wu?: Array<{ type: string; val: unknown }> } };

const paOf = (it: Item) => (it.nw?.wu ?? []).filter((w) => w.type === 'ad').reduce((s, w) => s + Number(w.val), 0);

function main(): void {
  const raw = readFileSync(TA, 'utf8');
  const items = JSON.parse(raw) as Item[];
  const byId = new Map(items.map((it, i) => [it.id, i]));
  const get = (id: number, name: string): Item => {
    const i = byId.get(id);
    if (i === undefined) throw new Error(`немає id ${id} («${name}»)`);
    if (items[i].name !== name) throw new Error(`id ${id}: «${items[i].name}», очікував «${name}»`);
    return items[i];
  };
  let changed = 0;
  const put = (id: number, next: Item) => {
    const i = byId.get(id)!;
    if (JSON.stringify(items[i]) !== JSON.stringify(next)) changed++;
    items[i] = next;
  };

  for (const row of CGD_ROWS) {
    const cgd = get(row.cgd, row.name);
    if (paOf(cgd) !== CGD_PA) throw new Error(`${row.name} (${row.cgd}): ПА ${paOf(cgd)}, очікував ${CGD_PA}`);
    // ЦГД: доповнення статів і обмеження за класом.
    const wu = [...(cgd.nw?.wu ?? [])];
    for (const add of row.addWu ?? []) if (!wu.some((w) => w.type === add.type && Number(w.val) === add.val)) wu.push(add);
    const fixed: Item = { ...cgd, nw: { ...cgd.nw, wu } };
    if (row.hi === null) delete fixed.hi;
    else if (row.hi) fixed.hi = row.hi;
    put(row.cgd, fixed);
    // РЦГД: ЦГД цілком, ПА 50, свої id / pw_id / іконка.
    for (const id of [row.rcgd, ...row.hidden]) {
      const own = get(id, row.name);
      const next: Item = { ...fixed, tv: RCGD_TV, nw: { wu: wu.map((w) => (w.type === 'ad' ? { type: 'ad', val: RCGD_PA } : { ...w })) } };
      for (const k of OWN_KEYS) {
        if (own[k] !== undefined) next[k] = own[k];
        else delete next[k];
      }
      // Порядок ключів — як у ЦГД: однаковий JSON для однакових речей.
      put(id, next);
    }
  }

  const out = JSON.stringify(items);
  const check = process.argv.includes('--check');
  if (check) {
    if (changed) {
      console.error(`ta.json: ${changed} записів ЦГД/РЦГД не збігаються з сервером — запусти без --check`);
      process.exit(1);
    }
    console.log('ta.json: ЦГД/РЦГД як на сервері');
    return;
  }
  if (out !== raw) writeFileSync(TA, out);
  console.log(`ta.json: змінено записів — ${changed}`);
}

main();
