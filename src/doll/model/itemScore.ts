// =========================================================
// ЛЯЛЬКА — скор v2 «від речей»: бали за кожен надітий екземпляр Головного й
// сетів, без еталонів, порогів сетів і табличних кошиків (рішення власника
// 30.09.2026; правила — docs/doll.md, «Скор v2 — від речей»).
//  • Кожен екземпляр рахується один раз: дедуп за iid і за slotKey
//    (hydrate.ts) — копія, яку мовчки робить правка з вкладки сету, це та сама
//    річ; два справді різні екземпляри (інша точка чи камені) — дві речі, з
//    жовтою приміткою. Порожній слот сету добирається з Головного — це річ
//    Головного, вона вже порахована.
//  • Зброя: найдорожча за v2 серед УСІХ надітих — «головна» (грейд за класом +
//    точка + абілка + камені), де б вона не лежала; решта — свап: лише ПЗ, який
//    вона дає (ефективні стати екземпляра: каталог + роли sx, плюс ПЗ-камені),
//    за курсом ПЗ-каменів, усі разом не більше weaponPzCap. Зброя рангу 17+
//    (речі новіших версій гри, костюми) — 0 із приміткою.
//  • ШГ і Вознєс — по одному разу (екземпляр із найбільшою точкою): shg/voznes +
//    точка × perLevel + камені, БЕЗ armorRefine/6 (їхня таблиця вже за точку);
//    бонус, якщо надіті обидві хоч десь.
//  • Кільця — лише два найкращі з усіх надітих; решта — 0.
//  • Броня rv/tg/rx/mj і звичайні шолом/накидка: armorSet[грейд речі]/4 (для
//    ft/wy — 0) + armorRefine[кошик точки]/6 + камені.
//  • Камені: ПЗ/ПА — u × значення допа (u = doll.gemPoints.pz1, «1 ПЗ = 1 бал»;
//    у зброї — за стороною зброї), решта — doll.gemPoints за рівнем.
//  • Трактат — у кожному сеті свій екземпляр: tract[грейд].
//  • Свап-сети: сума балів власних речей кожного сету під спільною стелею
//    swapTotalCap; зброя, ШГ/Вознєс і кільця з сетів ідуть у mainPoints (поза
//    стелею). Ручні роли, гравіювання й «свої стати» на бали не впливають
//    (виняток — ПЗ свап-зброї).
// Каталоги мають бути завантажені (ensureCats) — довідники не потрібні.
// Викликають: заявка (registration.ts), перерахунок зі знімка в адмінці
// (recompute.ts) і картка «Готовність до турніру» (readiness.ts).
// =========================================================

import {
  ARMOR_SET_LABELS, ITEM_REFINE_MAX, RING_LABELS, WEAPON_GRADE_LABELS, weaponGradeScore, type ScoringRules,
} from '../../data/gearRules';
import type { WeaponGrade } from '../../data/types';
import { flattenItemStats, gemDop } from '../core/stats';
import type { Item } from '../core/types';
import { SET_SLOT_KEYS, SLOT_CAT, SLOT_KEYS, docSizeBytes, type CharacterDoc, type SlotKey } from './doc';
import { armorPieceOf, ringGradeOf, tractOf, weaponGradeOf } from './grades';
import { hydrate, instStats, slotKey, type CharacterModel, type HydratedInst, type ItemLookup } from './hydrate';
import { CLS_CHAR, SHG_ITEM, VOZNES_ITEM, armorRefineBucket, gemGradeClass, weaponRefineBucket } from './sheet';

/** Один зарахований (чи нульовий) екземпляр. */
export interface ItemRow {
  /** Де надіто: 0 — Головний, n — індекс сету + 1. Куди зараховано — каже список (main чи sets[k].rows). */
  cfg: number;
  slot: SlotKey;
  iid: string;
  catId: number;
  name: string;
  /** Бали, 2 знаки. */
  points: number;
  /** Розклад коротко, до 40 символів: «r9r2 60 · +12 25 · кам 1.2 · ka 15». */
  why: string;
}

export interface SetScore {
  /** Індекс у doc.sets. */
  idx: number;
  name: string;
  /** Власні речі сету, не пораховані раніше (у Головному чи в попередньому сеті). */
  rows: ItemRow[];
  total: number;
}

export interface ItemScore {
  /** Рядки mainPoints: речі Головного, а також зброя (головна і свап), ШГ/Вознєс і кільця з сетів. */
  main: ItemRow[];
  sets: SetScore[];
  mainTotal: number;
  /** Сума балів свап-сетів до й після стелі swapTotalCap. */
  setsRaw: number;
  setsCapped: number;
  /** Бонус за ШГ і Вознєс разом. */
  pairBonus: number;
  /** mainTotal + setsCapped + pairBonus, 2 знаки — те, що піде в заявку (item_points). */
  itemPoints: number;
  /** Жовті примітки: ранг 17+, зброя в сеті дорожча, N екземплярів, нерозпізнані речі. */
  warn: string[];
}

/** Слоти броні з грейдом речі (сет броні як ціле більше не потрібен). */
const ARMOR_PIECE_SLOTS: ReadonlySet<SlotKey> = new Set<SlotKey>(['rv', 'tg', 'rx', 'mj']);
/** Шолом і накидка: ШГ/Вознєс — окремо, решта — лише точка й камені. */
const CAPE_SLOTS: ReadonlySet<SlotKey> = new Set<SlotKey>(['ft', 'wy']);
const RING_SLOTS: ReadonlySet<SlotKey> = new Set<SlotKey>(['cr', 'cd']);
/** Зброя рангу hf від цього — не з сервера (новіші версії гри, костюми): 0 балів. */
export const WEAPON_HF_NOT_ON_SERVER = 17;
/** Кілець у бали — не більше двох (дві руки). */
const RINGS_COUNTED = 2;
export const WHY_MAX = 40;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const lvl = (r: number | undefined): number => Math.max(0, Math.min(ITEM_REFINE_MAX, Math.round(r ?? 0)));
const itemName = (it: Item): string => String(it.name).replace(/\s+/g, ' ').trim();
const hfOf = (it: Item): number => Number(it.hf) || 0;
/** Число для «чому»: до одного знака, без хвостових нулів. */
const fmt = (n: number): string => String(Number(n.toFixed(1)));

/** «a · b · c» не довше WHY_MAX: зайві частини з кінця відкидаються, останній засіб — обрізати. */
function why(parts: Array<string | null | undefined>): string {
  const p = parts.filter((x): x is string => !!x);
  while (p.length > 1 && p.join(' · ').length > WHY_MAX) p.pop();
  return p.join(' · ').slice(0, WHY_MAX);
}

/** Ефективні стати екземпляра: як їх бачить ядро (xr → лише x; порожній x → база каталогу). */
function effStats(h: HydratedInst): Array<{ type: string; val: number }> {
  const own = instStats(h);
  return own.length || h.inst.xr || !h.item ? own : flattenItemStats(h.item);
}

/** Бали за один камінь: ПЗ/ПА — u × значення допа (у зброї — за стороною зброї), решта — за рівнем. */
function gemPoints(g: Item, isWeapon: boolean, rules: ScoringRules, u: number): number {
  const dop = gemDop(g, isWeapon);
  if (dop && (dop[0] === 'sx' || dop[0] === 'ad')) return u * Math.max(0, dop[1]);
  return rules.doll.gemPoints[gemGradeClass(g)];
}

interface Worn {
  cfg: number;
  slot: SlotKey;
  iid: string;
  h: HydratedInst;
  item: Item;
  key: string;
}

/**
 * Надіті екземпляри в порядку конфігурацій (Головний, потім сети як у документі),
 * кожна річ один раз. Дедуп за iid, а також за slotKey: скільки справді речей із
 * таким ключем — найбільше в одній конфігурації (два однакові кільця в Головному —
 * дві речі; та сама річ чи її незмінена копія в сеті — одна). Невідома річ чи
 * річ не своєї категорії — як порожній слот (так само її не бачить ядро).
 */
function wornItems(doc: CharacterDoc, model: CharacterModel): Worn[] {
  const cfgs: Array<{ cfg: number; slots: Partial<Record<SlotKey, string>>; keys: readonly SlotKey[] }> = [
    { cfg: 0, slots: doc.main, keys: SLOT_KEYS },
    ...doc.sets.map((s, i) => ({ cfg: i + 1, slots: s.slots, keys: SET_SLOT_KEYS })),
  ];
  const byCfg: Worn[][] = cfgs.map(({ cfg, slots, keys }) => {
    const out: Worn[] = [];
    const seen = new Set<string>();
    for (const slot of keys) {
      const iid = slots[slot];
      const h = iid ? model.items.get(iid) : undefined;
      if (!iid || !h?.item || h.inst.cat !== SLOT_CAT[slot] || seen.has(iid)) continue;
      seen.add(iid);
      out.push({ cfg, slot, iid, h, item: h.item, key: slotKey(h) });
    }
    return out;
  });
  const capacity = new Map<string, number>();
  for (const list of byCfg) {
    const n = new Map<string, number>();
    for (const w of list) n.set(w.key, (n.get(w.key) ?? 0) + 1);
    for (const [k, c] of n) capacity.set(k, Math.max(capacity.get(k) ?? 0, c));
  }
  const seenIid = new Set<string>();
  const usedKey = new Map<string, number>();
  const out: Worn[] = [];
  for (const list of byCfg) {
    for (const w of list) {
      if (seenIid.has(w.iid)) continue;
      seenIid.add(w.iid);
      const used = usedKey.get(w.key) ?? 0;
      if (used >= (capacity.get(w.key) ?? 0)) continue; // незмінена копія — та сама річ
      usedKey.set(w.key, used + 1);
      out.push(w);
    }
  }
  return out;
}

/** Бали за все надіте. Каталоги мають бути завантажені (або переданий lookup — у тестах з диска). */
export function scoreItems(doc: CharacterDoc, rules: ScoringRules, lookup?: ItemLookup): ItemScore {
  const model = hydrate(doc, lookup);
  const cls = CLS_CHAR[doc.cls];
  // Курс «1 ПЗ = 1 ПА = u бала» — бал за камінь на +1 ПЗ («Каменная броня»); ним
  // рахуються ПЗ/ПА-камені й ПЗ свап-зброї.
  const u = rules.doll.gemPoints.pz1;
  const warn: string[] = [];
  const worn = wornItems(doc, model);

  // Два справді різні екземпляри тієї самої речі каталогу — примітка (кільця
  // парами — звичайна річ, для них не пишемо).
  const byCat = new Map<string, Worn[]>();
  for (const w of worn) {
    if (RING_SLOTS.has(w.slot)) continue;
    const k = w.item.id + ':' + w.h.inst.cat;
    byCat.set(k, [...(byCat.get(k) ?? []), w]);
  }
  for (const list of byCat.values()) if (list.length > 1) warn.push(`«${itemName(list[0].item)}» у ${list.length} екземплярах`);

  const gemsOf = (w: Worn, isWeapon: boolean): number => w.h.gems.reduce((s, g) => (g ? s + gemPoints(g, isWeapon, rules, u) : s), 0);
  const gemPart = (pts: number): string | null => (pts > 0 ? `кам ${fmt(pts)}` : null);
  const unrecognized = (what: string, w: Worn, as: string) => warn.push(`${what}: лялька не розпізнала «${itemName(w.item)}» — зараховано як «${as}»`);

  const main: ItemRow[] = [];
  const sets: SetScore[] = doc.sets.map((s, i) => ({ idx: i, name: s.name, rows: [], total: 0 }));
  const row = (w: Worn, points: number, text: string): ItemRow => ({ cfg: w.cfg, slot: w.slot, iid: w.iid, catId: w.item.id, name: itemName(w.item), points: round2(points), why: text });
  /** Зброя, ШГ/Вознєс і кільця — завжди в mainPoints; решта — туди, де надіто. */
  const toMain = (r: ItemRow) => main.push(r);
  const toCfg = (r: ItemRow) => (r.cfg === 0 ? main : sets[r.cfg - 1].rows).push(r);

  // ── Зброя: найдорожча — головна, решта — свап за ПЗ ──────────────────
  const weapons = worn.filter((w) => w.slot === 'ta');
  interface WeaponFull { points: number; why: string; bad: boolean; suspicious: boolean; grade: WeaponGrade | null }
  const full: WeaponFull[] = weapons.map((w) => {
    if (hfOf(w.item) >= WEAPON_HF_NOT_ON_SERVER) return { points: 0, why: `ранг ${hfOf(w.item)}: не з сервера — 0`, bad: true, suspicious: false, grade: null };
    const g = weaponGradeOf(w.item);
    const gp = weaponGradeScore(cls, g.grade, rules);
    const r = lvl(w.h.inst.r);
    const rp = rules.weaponRefine[weaponRefineBucket(r)];
    const gems = gemsOf(w, true);
    const ac = (w.item as { ac?: unknown }).ac;
    const abil = typeof ac === 'string' && ac ? ac : null;
    // У v2 абілка — абсолютні бали (відʼємне значення лишилось від еталонів — не рахуємо).
    const ap = abil ? Math.max(0, rules.abilityPoints[abil] ?? 0) : 0;
    return {
      points: gp + rp + gems + ap,
      why: why([`${g.grade} ${fmt(gp)}`, r > 0 ? `+${r} ${fmt(rp)}` : null, gemPart(gems), abil ? `${abil} ${fmt(ap)}` : null]),
      bad: false,
      suspicious: g.suspicious,
      grade: g.grade,
    };
  });
  // Головна — найдорожча серед справжніх зброй; речі не з сервера (ранг 17+) — лише коли інших немає.
  let best = -1;
  for (let i = 0; i < weapons.length; i++) if (!full[i].bad && (best < 0 || full[i].points > full[best].points)) best = i;
  if (best < 0 && weapons.length) best = 0;
  const mainHasWeapon = weapons.some((w, i) => w.cfg === 0 && !full[i].bad);
  // Свап-зброя: лише ПЗ (стати екземпляра + ПЗ-камені за стороною зброї). Стеля — на
  // суму; вичерпується від найбільшого ПЗ, щоб у розкладі найкраща свап-зброя стояла
  // повною, а обрізаними — решта.
  const swapPz = (w: Worn): number => {
    let pz = effStats(w.h).reduce((s, st) => (st.type === 'sx' ? s + (Number(st.val) || 0) : s), 0);
    for (const g of w.h.gems) {
      const dop = g && gemDop(g, true);
      if (dop && dop[0] === 'sx') pz += dop[1];
    }
    return Math.max(0, pz);
  };
  const swaps = weapons.map((w, i) => ({ i, pz: i === best || full[i].bad ? 0 : swapPz(w) })).filter((s) => s.i !== best && !full[s.i].bad);
  const swapPts = new Map<number, number>();
  let pzLeft = rules.weaponPzCap;
  for (const s of swaps.slice().sort((a, b) => b.pz - a.pz || a.i - b.i)) {
    const pts = Math.min(s.pz * u, pzLeft);
    pzLeft = Math.max(0, pzLeft - pts);
    swapPts.set(s.i, pts);
  }
  weapons.forEach((w, i) => {
    const f = full[i];
    if (i === best) {
      if (f.bad) warn.push(`зброя «${itemName(w.item)}» рангу ${hfOf(w.item)} — не з сервера, 0 балів`);
      if (f.suspicious && f.grade) unrecognized('зброя', w, WEAPON_GRADE_LABELS[f.grade]);
      if (w.cfg !== 0) warn.push(mainHasWeapon ? 'у сеті зброя дорожча, ніж у Головному' : `зброї в Головному немає — рахується зброя із сету «${doc.sets[w.cfg - 1].name}»`);
      toMain(row(w, f.points, f.why));
      return;
    }
    if (f.bad) {
      warn.push(`зброя «${itemName(w.item)}» рангу ${hfOf(w.item)} — не з сервера, 0 балів`);
      toMain(row(w, 0, f.why));
      return;
    }
    const pz = swapPz(w);
    const pts = swapPts.get(i) ?? 0;
    toMain(row(w, pts, why([`свап: ПЗ ${fmt(pz)}`, pts < pz * u ? `стеля ${fmt(rules.weaponPzCap)}` : null])));
  });

  // ── ШГ і Вознєс: по одному разу, найбільша точка; бонус за обидві ─────
  let pairBonus = 0;
  const special = (it: { slot: 'ft' | 'wy'; id: number }, label: string, base: number, perLevel: number): boolean => {
    const list = worn.filter((w) => w.slot === it.slot && w.item.id === it.id);
    if (!list.length) return false;
    let top = list[0];
    for (const w of list) if (lvl(w.h.inst.r) > lvl(top.h.inst.r)) top = w;
    for (const w of list) {
      if (w !== top) {
        toMain(row(w, 0, `${label} уже зараховано`));
        continue;
      }
      const r = lvl(w.h.inst.r);
      const gems = gemsOf(w, false);
      toMain(row(w, base + perLevel * r + gems, why([`${label} ${fmt(base)}`, r > 0 ? `+${r} ${fmt(perLevel * r)}` : null, gemPart(gems)])));
    }
    return true;
  };
  const hasShg = special(SHG_ITEM, 'ШГ', rules.shg, rules.shgRefinePerLevel);
  const hasVoznes = special(VOZNES_ITEM, 'Вознєс', rules.voznes, rules.voznesRefinePerLevel);
  if (hasShg && hasVoznes) pairBonus = rules.shgVoznesBonus;

  // ── Кільця: два найкращі з усіх надітих ──────────────────────────────
  const rings = worn
    .filter((w) => RING_SLOTS.has(w.slot))
    .map((w) => {
      const g = ringGradeOf(w.item);
      const r = g.grade === 'r9r1' ? lvl(w.h.inst.r) : 0;
      const rp = rules.ringRefinePerLevel * r;
      return { w, g, points: rules.rings[g.grade] + rp, why: why([`${g.grade} ${fmt(rules.rings[g.grade])}`, r > 0 ? `+${r} ${fmt(rp)}` : null]) };
    });
  const order = rings.map((_, i) => i).sort((a, b) => rings[b].points - rings[a].points || a - b);
  const counted = new Set(order.slice(0, RINGS_COUNTED));
  rings.forEach((x, i) => {
    if (!counted.has(i)) {
      toMain(row(x.w, 0, 'третє кільце: 0'));
      return;
    }
    if (x.g.suspicious) unrecognized('кільце', x.w, RING_LABELS[x.g.grade]);
    toMain(row(x.w, x.points, x.why));
  });

  // ── Решта — туди, де надіто ──────────────────────────────────────────
  for (const w of worn) {
    if (w.slot === 'ta' || RING_SLOTS.has(w.slot)) continue;
    if (CAPE_SLOTS.has(w.slot) && ((w.slot === SHG_ITEM.slot && w.item.id === SHG_ITEM.id) || (w.slot === VOZNES_ITEM.slot && w.item.id === VOZNES_ITEM.id))) continue;
    const r = lvl(w.h.inst.r);
    if (ARMOR_PIECE_SLOTS.has(w.slot) || CAPE_SLOTS.has(w.slot)) {
      let gp = 0;
      let gradeText: string | null = null;
      if (ARMOR_PIECE_SLOTS.has(w.slot)) {
        const p = armorPieceOf(w.item);
        gp = rules.armorSet[p.grade] / 4;
        gradeText = `${p.grade} ${fmt(gp)}`;
        if (p.suspicious) unrecognized('броня', w, ARMOR_SET_LABELS.other);
      }
      const rp = rules.armorRefine[armorRefineBucket(r)] / 6;
      const gems = gemsOf(w, false);
      toCfg(row(w, gp + rp + gems, why([gradeText, r > 0 ? `+${r} ${fmt(rp)}` : null, gemPart(gems)]) || '0'));
      continue;
    }
    if (w.slot === 'qn') {
      const t = tractOf(w.item).grade;
      toCfg(row(w, rules.tract[t], `${t} ${fmt(rules.tract[t])}`));
      continue;
    }
    // Намисто, пояс, збірник, боєприпаси, джин, тома, політ: лише камені (гнізда є тільки у збірника).
    const gems = gemsOf(w, false);
    toCfg(row(w, gems, w.h.gems.length ? gemPart(gems) ?? 'каменів немає' : ''));
  }

  const sum = (rows: ItemRow[]) => round2(rows.reduce((s, r) => s + r.points, 0));
  for (const s of sets) s.total = sum(s.rows);
  const mainTotal = sum(main);
  const setsRaw = round2(sets.reduce((s, x) => s + x.total, 0));
  const setsCapped = rules.swapTotalCap == null ? setsRaw : round2(Math.min(rules.swapTotalCap, setsRaw));
  return { main, sets, mainTotal, setsRaw, setsCapped, pairBonus, itemPoints: Math.max(0, round2(mainTotal + setsCapped + pairBonus)), warn };
}

// ── item_breakdown для заявки (jsonb ≤ 2048 Б у базі, клієнт тримає ≤ 2000) ──

export const ITEM_BREAKDOWN_V = 1;
/** Межа розміру на клієнті (CHECK у базі — 2048 Б, з запасом). */
export const ITEM_BREAKDOWN_MAX_BYTES = 2000;
const WARN_ROWS = 2;
const WARN_LEN = 80;
const WARN_ORDER = [/не розпізнала/, /не з сервера/, /дорожча, ніж у Головному|рахується зброя із сету/, /екземплярах/];
const warnRank = (w: string): number => {
  const i = WARN_ORDER.findIndex((re) => re.test(w));
  return i < 0 ? WARN_ORDER.length : i;
};

/** [cfg, слот, id каталогу, бали, «чому»]; «чому» прибирається, коли не вміщається. */
export type BreakdownRow = [cfg: number, slot: SlotKey, catId: number, points: number, why?: string];

export interface ItemBreakdown {
  v: typeof ITEM_BREAKDOWN_V;
  /** Версія шкали, якою рахували. */
  ver: string;
  /** Складові: клас (за розміром команди), рівень і джин — коли їх передано (заявка), решта — з розкладу. */
  sum: { cls?: number; lvl?: number; genie?: number; main: number; sets: number; setsRaw: number; pair: number };
  /** Лише зараховані рядки (бали > 0), Головний перед сетами. */
  rows: BreakdownRow[];
  /** До двох приміток по 80 символів. */
  warn: string[];
}

/** Розмір так, як його порахує CHECK octet_length(jsonb::text) — з пробілами після ком і двокрапок. */
export function breakdownBytes(b: ItemBreakdown): number {
  return docSizeBytes(b);
}

/**
 * Розклад для заявки з результату scoreItems. Якщо понад ITEM_BREAKDOWN_MAX_BYTES —
 * спершу без «чому», потім без рядків < 1 бала, і наостанок — без найдешевших
 * рядків, доки не вміститься (на 5 сетах по 13 речей до цього не доходить).
 */
export function itemBreakdown(res: ItemScore, ver: string, extra: { cls?: number; lvl?: number; genie?: number } = {}): ItemBreakdown {
  const all = [...res.main, ...res.sets.flatMap((s) => s.rows)].filter((r) => r.points > 0);
  const sum: ItemBreakdown['sum'] = {
    ...(extra.cls !== undefined ? { cls: extra.cls } : {}),
    ...(extra.lvl !== undefined ? { lvl: extra.lvl } : {}),
    ...(extra.genie !== undefined ? { genie: extra.genie } : {}),
    main: res.mainTotal,
    sets: res.setsCapped,
    setsRaw: res.setsRaw,
    pair: res.pairBonus,
  };
  // Дві примітки — найважливіші: нерозпізнана річ, річ не з сервера, зброя в сеті, і лише потім дублі екземплярів.
  const warn = [...new Set(res.warn)]
    .sort((a, b) => warnRank(a) - warnRank(b))
    .slice(0, WARN_ROWS)
    .map((w) => w.slice(0, WARN_LEN));
  const toRow = (r: ItemRow, withWhy: boolean): BreakdownRow =>
    withWhy && r.why ? [r.cfg, r.slot, r.catId, r.points, r.why.slice(0, WHY_MAX)] : [r.cfg, r.slot, r.catId, r.points];
  const build = (rows: ItemRow[], withWhy: boolean): ItemBreakdown => ({ v: ITEM_BREAKDOWN_V, ver, sum, rows: rows.map((r) => toRow(r, withWhy)), warn });
  let b = build(all, true);
  if (breakdownBytes(b) <= ITEM_BREAKDOWN_MAX_BYTES) return b;
  b = build(all, false);
  if (breakdownBytes(b) <= ITEM_BREAKDOWN_MAX_BYTES) return b;
  let rows = all.filter((r) => r.points >= 1);
  b = build(rows, false);
  while (breakdownBytes(b) > ITEM_BREAKDOWN_MAX_BYTES && rows.length) {
    const cheapest = rows.reduce((m, r, i) => (r.points < rows[m].points ? i : m), 0);
    rows = rows.filter((_, i) => i !== cheapest);
    b = build(rows, false);
  }
  return b;
}
