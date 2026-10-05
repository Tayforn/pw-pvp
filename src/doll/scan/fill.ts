// =========================================================
// СКАН СКРІНШОТІВ — заповнити нову ляльку з двох скріншотів гри.
//
// Що видно напевно: речі в слотах (за іконками), рівень, стать (за спрайтами
// броні). Клас визначаємо за класовими обмеженнями впізнаних речей.
//
// Що доводиться вгадувати — і про кожну здогадку результат каже окремо:
//  • річ, коли одна іконка в кількох речей: серед варіантів відкидаємо ті, з
//    якими «Показник атаки» чи «Показник захисту» вийшли б більші, ніж у грі;
//    далі беремо ту, що збирає комплект з іншими слотами, класову, вищого рівня;
//  • камені: їх не видно. Якщо сума атрибутів більша, ніж дає рівень, зайве
//    найправдоподібніше дають камені на Тілобудову в броні — ставимо їх стільки,
//    скільки треба. У гнізда, що лишились, — камені на «Показник захисту» й
//    «Показник атаки», скільки бракує до чисел з вікна «Персонаж»;
//  • базові атрибути: у грі видно лише суми з бонусами речей, а ролів і
//    гравіювань на атрибути не видно зовсім. Беремо суму мінус те, що дають
//    речі й камені; якщо все одно виходить більше, ніж дає рівень, — зменшуємо
//    пропорційно, але не нижче вимог надітих речей, щоб ляльку можна було зберегти.
// Заточки, роли й гравіювання не чіпаємо: їх гравець ставить сам, а таблиця
// «гра / лялька» (compare.ts) показує, де ще різниця.
// =========================================================

import { XZ, maxSockets } from '../core/constants';
import { classRestriction, computeStats, gemDop, num } from '../core/stats';
import type { Item } from '../core/types';
import { CLS_KEYS, SLOT_CAT, SLOT_KEYS, emptyDoc, type CharacterDoc, type ClsKey, type ItemInst, type SlotKey } from '../model/doc';
import { gemOk } from '../model/gemOk';
import { CFG_MAIN, hydrate, toDollState, type ItemLookup } from '../model/hydrate';
import { addFromCatalog, normalizeInst } from '../model/ops';
import { dollNumbers } from './compare';
import type { EquipScan } from './equip';
import type { StatsScan } from './stats';

/** Мінімум кожного атрибута. */
const ATTR_MIN = 5;
/** Слоти, куди ставимо камені, у порядку заповнення. */
const WEAPON: SlotKey = 'ta';
const ARMOR: SlotKey[] = ['rv', 'tg', 'rx', 'mj', 'ft', 'wy'];
/** Скільки поєднань речей зі спільними іконками ще перебираємо проти чисел з гри. */
const MAX_COMBOS = 3000;

type AttrKey = 'str' | 'dex' | 'vit' | 'mag';
const ATTRS: AttrKey[] = ['str', 'dex', 'vit', 'mag'];
/** Атрибут ляльки → код стата в ядрі. */
const ATTR_CODE: Record<AttrKey, string> = { str: 'om', dex: 'uy', vit: 'lf', mag: 'tx' };

export interface FillPick {
  slot: SlotKey;
  /** Вибрана річ каталогу. */
  id: number;
  /** Інші речі з такою самою іконкою, які персонаж теж може носити. */
  others: number[];
}

export interface FillGems {
  /** Камінь каталогу (ob) і скільки таких поставлено. */
  id: number;
  count: number;
  /** Який стат він закриває і на скільки разом. */
  stat: 'ad' | 'sx' | 'lf';
  total: number;
}

export interface FillResult {
  doc: CharacterDoc;
  /** Чи клас визначено за речами (false — лишився клас поточної ляльки). */
  clsSure: boolean;
  /** Чи рівень прочитано з вікна «Персонаж». */
  levelRead: boolean;
  picks: FillPick[];
  /** Слоти, де щось лежить, але в каталозі такої речі для цього класу немає. */
  unknown: SlotKey[];
  gems: FillGems[];
  /** Атрибути: null — без вікна «Персонаж» не чіпали; cut — скільки очок довелося зрізати, щоб улізти в рівень. */
  attrs: { cut: number } | null;
}

export interface FillInput {
  equip: EquipScan;
  stats: StatsScan | null;
  /** Поточна лялька: звідси імʼя, а також клас і рівень, якщо їх не вдалося визначити. */
  base: CharacterDoc;
  /** Каталог категорії (усі слоти й камені `ob`). */
  items(cat: string): readonly Item[] | null;
}

const SM_CLS: Record<number, ClsKey> = Object.fromEntries(CLS_KEYS.map((c) => [XZ[c], c]));
/** Назва-заглушка невикористаної речі каталогу — такі беремо лише коли іншого вибору немає. */
const UNUSED_RE = /не используется|не використовується/i;

/** Клас за впізнаними речами: кожен слот голосує за класи, яким дозволена хоч одна з його речей;
 * річ лише для одного класу важить більше, ніж річ для девʼяти. */
function detectClass(cands: Map<SlotKey, Item[]>): ClsKey | null {
  const score = new Map<ClsKey, number>();
  for (const list of cands.values()) {
    const vote = new Map<ClsKey, number>();
    for (const it of list) {
      const only = classRestriction(it);
      if (!only) continue;
      for (const sm of only) {
        const cls = SM_CLS[sm];
        if (cls) vote.set(cls, Math.max(vote.get(cls) ?? 0, 1 / only.length));
      }
    }
    for (const [cls, v] of vote) score.set(cls, (score.get(cls) ?? 0) + v);
  }
  const ranked = [...score].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) return null;
  return ranked[0][0];
}

function wearable(it: Item, cls: ClsKey, level: number): boolean {
  const only = classRestriction(it);
  return (!only || only.includes(XZ[cls])) && num(it.oj) <= level;
}

/** Речі зі спільною іконкою від найімовірнішої (див. шапку файла). */
function rank(slot: SlotKey, list: Item[], cands: Map<SlotKey, Item[]>, cls: ClsKey): Item[] {
  const mates = (it: Item): number => {
    if (it.ps == null) return 0;
    let n = 0;
    for (const [other, items] of cands) if (other !== slot && items.some((o) => o.ps === it.ps)) n++;
    return n;
  };
  const own = (it: Item): number => (classRestriction(it)?.includes(XZ[cls]) ? 1 : 0);
  const real = (it: Item): number => (UNUSED_RE.test(String(it.name)) ? 0 : 1);
  return [...list].sort(
    (a, b) =>
      real(b) - real(a) || mates(b) - mates(a) || own(b) - own(a) || num(b.oj) - num(a.oj) || num(b.hf) - num(a.hf) || Number(a.id) - Number(b.id),
  );
}

/** Зі скану спорядження і (якщо є) вікна «Персонаж» — нова лялька й перелік здогадок. */
export function fillFromShots({ equip, stats, base, items }: FillInput): FillResult {
  const byId = new Map<string, Map<number, Item>>();
  const lookup: ItemLookup = (cat, id) => {
    let m = byId.get(cat);
    if (!m) {
      m = new Map((items(cat) ?? []).map((it) => [Number(it.id), it]));
      byId.set(cat, m);
    }
    return m.get(id);
  };

  // Усі речі каталогу з впізнаною іконкою, по слотах.
  const seen = new Map<SlotKey, Item[]>();
  for (const slot of SLOT_KEYS) {
    const s = equip.slots[slot];
    if (s.state !== 'item') continue;
    const list = s.ids.map((id) => lookup(SLOT_CAT[slot], id)).filter((it): it is Item => !!it);
    if (list.length) seen.set(slot, list);
  }

  const detected = detectClass(seen);
  const cls = detected ?? base.cls;
  const game = stats?.values ?? {};
  const level = game.level ?? base.level;
  const total = (k: AttrKey): number => game[k] ?? ATTR_MIN;

  // Лише те, що цей клас на цьому рівні може носити; у кожному слоті — від найімовірнішої.
  const wear = new Map<SlotKey, Item[]>();
  const unknown: SlotKey[] = [];
  for (const slot of SLOT_KEYS) {
    const list = (seen.get(slot) ?? []).filter((it) => wearable(it, cls, level));
    if (list.length) wear.set(slot, list);
    else if (equip.slots[slot].state !== 'empty') unknown.push(slot);
  }
  const cands = new Map<SlotKey, Item[]>([...wear].map(([slot, list]) => [slot, rank(slot, list, wear, cls)]));
  const slots = [...cands.keys()];

  /** Лялька з вибраною річчю в кожному слоті (choice[i] — номер варіанта слота slots[i]). */
  const build = (choice: number[]): CharacterDoc => {
    let d: CharacterDoc = { ...emptyDoc(cls), gender: equip.gender, level, name: base.name };
    // Доки базові атрибути невідомі — беремо суми з гри: їх точно досить, щоб речі «вдяглися».
    if (stats) d = { ...d, attrs: { str: total('str'), dex: total('dex'), vit: total('vit'), mag: total('mag') } };
    slots.forEach((slot, i) => {
      const it = cands.get(slot)![choice[i]];
      const pw = num(it.pw_id);
      d = addFromCatalog(d, SLOT_CAT[slot], Number(it.id), { equipTo: { cfgId: CFG_MAIN, slot }, p: pw || undefined }).doc;
    });
    return d;
  };

  // Вибір серед речей зі спільною іконкою: показник атаки, показник захисту і крит від
  // самих речей не можуть бути більші, ніж у грі (камені й роли лише додають), — це
  // відсіює, скажімо, пояс із зайвими +5 ПА чи +1 % криту.
  let choice = slots.map(() => 0);
  const combos = slots.reduce((n, slot) => n * cands.get(slot)!.length, 1);
  if (game.pa !== undefined && game.pz !== undefined && combos > 1 && combos <= MAX_COMBOS) {
    const pa = game.pa;
    const pz = game.pz;
    // Крит від речей у грі: показаний шанс мінус базовий 1 % і 1 % за кожні 20 Спритності.
    const crit = game.crit !== undefined && game.dex !== undefined ? game.crit - 1 - Math.floor(game.dex / 20) : Infinity;
    let best = Infinity;
    const cur = slots.map(() => 0);
    const walk = (i: number): void => {
      if (i === slots.length) {
        const t = computeStats(toDollState(hydrate(build(cur), lookup), CFG_MAIN)).t;
        const ad = t.ad || 0;
        const sx = t.sx || 0;
        // Більше, ніж у грі, — штраф ×1000; нестача — ×1 (її закриють камені й роли); далі — «імовірність» варіантів.
        const overshoot = Math.max(0, ad - pa) + Math.max(0, sx - pz) + Math.max(0, (t.ed || 0) - crit);
        const cost = 1000 * overshoot + Math.max(0, pa - ad) + Math.max(0, pz - sx) + cur.reduce((n, v) => n + v, 0) / 100;
        if (cost < best) {
          best = cost;
          choice = [...cur];
        }
        return;
      }
      for (let v = 0; v < cands.get(slots[i])!.length; v++) {
        cur[i] = v;
        walk(i + 1);
      }
    };
    walk(0);
  }

  let doc = build(choice);
  const picks: FillPick[] = slots.map((slot, i) => {
    const list = cands.get(slot)!;
    return { slot, id: Number(list[choice[i]].id), others: list.filter((_, k) => k !== choice[i]).map((o) => Number(o.id)) };
  });
  if (!stats) return { doc, clsSure: !!detected, levelRead: false, picks, unknown, gems: [], attrs: null };

  // ── Камені ──
  const instOf = (slot: SlotKey): ItemInst | undefined => doc.items.find((it) => it.i === doc.main[slot]);
  const free = (slot: SlotKey): number => {
    const inst = instOf(slot);
    return inst ? maxSockets(inst.cat) - (inst.g ? inst.g.length : 0) : 0;
  };
  const gemPool = items('ob') ?? [];
  /** Найсильніший дозволений камінь на стат, не більший за потребу. */
  const bestGem = (slot: SlotKey, stat: string, need: number): { id: number; val: number } | null => {
    const inst = instOf(slot);
    const host = inst && lookup(inst.cat, inst.id);
    if (!inst || !host) return null;
    let best: { id: number; val: number } | null = null;
    for (const g of gemPool) {
      if (!gemOk(g, inst.cat, host)) continue;
      const dop = gemDop(g, slot === WEAPON);
      if (!dop || dop[0] !== stat || dop[1] <= 0 || dop[1] > need) continue;
      if (!best || dop[1] > best.val) best = { id: Number(g.id), val: dop[1] };
    }
    return best;
  };
  const gems: FillGems[] = [];
  const place = (order: SlotKey[], stat: 'ad' | 'sx' | 'lf', want: number): void => {
    let need = want;
    for (const slot of order) {
      while (need > 0 && free(slot) > 0) {
        const g = bestGem(slot, stat, need);
        if (!g) break;
        const iid = doc.main[slot];
        doc = { ...doc, items: doc.items.map((it) => (it.i === iid ? normalizeInst({ ...it, g: [...(it.g ?? []), g.id] }) : it)) };
        need -= g.val;
        const row = gems.find((r) => r.id === g.id && r.stat === stat);
        if (row) {
          row.count++;
          row.total += g.val;
        } else gems.push({ id: g.id, count: 1, stat, total: g.val });
      }
    }
  };

  // Вимоги надітих речей: нижче за них атрибут не опускаємо, інакше річ «не вдягнеться».
  const need: Record<AttrKey, number> = { str: 0, dex: 0, vit: 0, mag: 0 };
  for (const slot of slots) {
    const inst = instOf(slot);
    const it = inst && lookup(inst.cat, inst.id);
    if (!it) continue;
    need.str = Math.max(need.str, num(it.om_uo));
    need.dex = Math.max(need.dex, num(it.uy_uo));
    need.mag = Math.max(need.mag, num((it as Record<string, unknown>).tx_uo));
  }
  const budget = ATTR_MIN * ATTRS.length + 5 * Math.max(0, level - 1);
  let floor: Record<AttrKey, number> = { str: ATTR_MIN, dex: ATTR_MIN, vit: ATTR_MIN, mag: ATTR_MIN };
  /** Базові атрибути як «сума з гри мінус те, що дають речі й камені ляльки». */
  const baseOf = (): Record<AttrKey, number> => {
    const g = computeStats(toDollState(hydrate(doc, lookup), CFG_MAIN)).gearAttr;
    floor = Object.fromEntries(ATTRS.map((k) => [k, Math.max(ATTR_MIN, need[k] - (g[ATTR_CODE[k]] || 0))])) as Record<AttrKey, number>;
    return Object.fromEntries(ATTRS.map((k) => [k, Math.max(floor[k], total(k) - (g[ATTR_CODE[k]] || 0))])) as Record<AttrKey, number>;
  };
  const sum = (a: Record<AttrKey, number>): number => ATTRS.reduce((n, k) => n + a[k], 0);

  // 1) Очок більше, ніж дає рівень, — найімовірніше, це камені на Тілобудову в броні.
  let attrs = baseOf();
  const over = sum(attrs) - budget;
  if (over > 0) place(ARMOR, 'lf', Math.min(over, attrs.vit - ATTR_MIN));
  // 2) У гнізда, що лишились, — камені на показники захисту й атаки, скільки бракує до гри.
  const now = dollNumbers(doc, CFG_MAIN, lookup);
  if (game.pz !== undefined) place(ARMOR, 'sx', game.pz - now.pz);
  if (game.pa !== undefined) place([WEAPON, ...ARMOR], 'ad', game.pa - now.pa);

  // ── Атрибути ──
  attrs = baseOf();
  const cut = Math.max(0, sum(attrs) - budget);
  let left = cut;
  const take = (k: AttrKey, n: number, min: number): void => {
    const part = Math.max(0, Math.min(n, attrs[k] - min));
    attrs[k] -= part;
    left -= part;
  };
  if (left > 0) {
    const slack = ATTRS.reduce((n, k) => n + attrs[k] - floor[k], 0);
    const share = left;
    if (slack > 0) for (const k of ATTRS) take(k, Math.floor((share * (attrs[k] - floor[k])) / slack), floor[k]);
    // Залишок від округлення — з того, де найбільший запас; якщо вимоги речей самі не влазять у рівень — і нижче вимог.
    for (const min of [floor, null]) {
      for (const k of [...ATTRS].sort((x, y) => attrs[y] - floor[y] - (attrs[x] - floor[x]))) take(k, left, min ? min[k] : ATTR_MIN);
    }
  }
  doc = { ...doc, attrs };

  return { doc, clsSure: !!detected, levelRead: game.level !== undefined, picks, unknown, gems, attrs: { cut } };
}
