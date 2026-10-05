// =========================================================
// СКАН СКРІНШОТІВ — звірка з лялькою. Скріншоти не показують заточок, каменів
// і ролів, тож ляльку з них не зібрати; зате видно, чи лялька відповідає грі:
//  1) за іконками — який комплект (Головний чи сет) зараз надіто і які речі в
//     ньому не ті;
//  2) за числами вікна «Персонаж» — чи рушій ляльки дає ті самі характеристики.
// Усе тут чисте: документ не змінюється, виправлення повертаються новим doc.
// =========================================================

import { deriveIb } from '../core/buffs';
import { computeStats } from '../core/stats';
import { computeSummary } from '../core/summary';
import { getItem } from '../data/catalog';
import { SLOT_CAT, SLOT_KEYS, isSetSlotKey, type CharacterDoc, type SlotKey } from '../model/doc';
import { CFG_MAIN, effectiveSlots, hydrate, toDollState, type ItemLookup } from '../model/hydrate';
import { equip } from '../model/ops';
import { MAX_ERR, type EquipScan, type ScanSlot } from './equip';
import type { StatKey, StatsScan } from './stats';

/** same — збігається; swap — у грі інша річ; missing — у грі річ є, в ляльці слот
 * порожній; extra — навпаки; unsure — на скріншоті не розібрати. */
export type SlotStatus = 'same' | 'swap' | 'missing' | 'extra' | 'unsure';

export interface SlotDiff {
  /** Слот ляльки. */
  slot: SlotKey;
  status: SlotStatus;
  /** Річ ляльки в цьому слоті конфігурації (iid) або null. */
  dollIid: string | null;
  /** Клітинка скріншота, з якою порівнювали (для кілець руки можуть бути навхрест). */
  seen: ScanSlot;
  /** Речі з інвентаря ляльки з такою самою іконкою, як на скріншоті. */
  fixIids: string[];
}

export interface CfgMatch {
  cfgId: string;
  /** Назва для показу: «Головний» або назва сету. */
  name: string;
  /** Скільки слотів збіглося. */
  same: number;
  /** Усі порівняні слоти (політ не порівнюємо). */
  slots: SlotDiff[];
}

/** Політ не звіряємо: іконки крил на сервері свої, а на характеристики він не впливає. */
const SKIP: ReadonlySet<SlotKey> = new Set<SlotKey>(['ic']);
const RINGS: SlotKey[] = ['cr', 'cd'];

/** Іконка речі ляльки (поле `an` каталогу) або null для порожнього слота / невідомої речі. */
function iconOf(doc: CharacterDoc, iid: string | undefined, lookup: ItemLookup): number | null {
  const inst = iid ? doc.items.find((it) => it.i === iid) : undefined;
  const item = inst ? lookup(inst.cat, inst.id) : undefined;
  const an = item ? Number(item.an) : NaN;
  return Number.isInteger(an) ? an : null;
}

function diffSlot(doc: CharacterDoc, slot: SlotKey, iid: string | undefined, seen: ScanSlot, lookup: ItemLookup): SlotDiff {
  const icon = iconOf(doc, iid, lookup);
  const base = { slot, dollIid: iid ?? null, seen };
  // Не впізнано однозначно (дві схожі іконки), але найсхожіша — саме та, що в ляльці: це збіг.
  if (seen.state === 'unknown') return { ...base, status: icon !== null && icon === seen.an && seen.err <= MAX_ERR ? 'same' : 'unsure', fixIids: [] };
  if (seen.state === 'empty') return { ...base, status: iid ? 'extra' : 'same', fixIids: [] };
  if (icon === seen.an) return { ...base, status: 'same', fixIids: [] };
  const cat = SLOT_CAT[slot];
  const fixIids = doc.items.filter((it) => it.cat === cat && it.i !== iid && iconOf(doc, it.i, lookup) === seen.an).map((it) => it.i);
  return { ...base, status: iid ? 'swap' : 'missing', fixIids };
}

const sameCount = (list: SlotDiff[]): number => list.filter((d) => d.status === 'same').length;

function matchConfig(doc: CharacterDoc, cfgId: string, name: string, scan: EquipScan, lookup: ItemLookup): CfgMatch {
  const eff = effectiveSlots(hydrate(doc, lookup), cfgId);
  const slots: SlotDiff[] = [];
  for (const slot of SLOT_KEYS) {
    if (SKIP.has(slot) || RINGS.includes(slot)) continue;
    slots.push(diffSlot(doc, slot, eff[slot], scan.slots[slot], lookup));
  }
  // Кільця однакові для обох рук: якщо навхрест збігається краще — рахуємо навхрест.
  const [l, r] = RINGS;
  const straight = [diffSlot(doc, l, eff[l], scan.slots[l], lookup), diffSlot(doc, r, eff[r], scan.slots[r], lookup)];
  const crossed = [diffSlot(doc, l, eff[l], scan.slots[r], lookup), diffSlot(doc, r, eff[r], scan.slots[l], lookup)];
  slots.push(...(sameCount(crossed) > sameCount(straight) ? crossed : straight));
  return { cfgId, name, same: sameCount(slots), slots };
}

/** Порівняти скріншот спорядження з кожною конфігурацією ляльки (порядок як у документі). */
export function matchConfigs(doc: CharacterDoc, scan: EquipScan, lookup: ItemLookup = getItem): CfgMatch[] {
  return [matchConfig(doc, CFG_MAIN, 'Головний', scan, lookup), ...doc.sets.map((s) => matchConfig(doc, s.id, s.name, scan, lookup))];
}

/**
 * Надіти в конфігурацію речі з інвентаря там, де вибір однозначний (рівно одна
 * річ з потрібною іконкою). Решту — кілька кандидатів, речі немає в інвентарі,
 * зайва річ — лишаємо гравцеві. Повертає новий doc і слоти, які змінено.
 */
export function applyFixes(doc: CharacterDoc, cfg: CfgMatch): { doc: CharacterDoc; applied: SlotKey[] } {
  let next = doc;
  const applied: SlotKey[] = [];
  for (const d of cfg.slots) {
    if ((d.status !== 'swap' && d.status !== 'missing') || d.fixIids.length !== 1) continue;
    const after = applyFix(next, cfg.cfgId, d.slot, d.fixIids[0]);
    if (after !== next) applied.push(d.slot);
    next = after;
  }
  return { doc: next, applied };
}

// ---------- числа вікна «Персонаж» ----------

/** Те, що показує вікно «Персонаж», пораховане рушієм ляльки для конфігурації —
 * без бафів, лише з пасивками класу (як у грі без накладених ефектів). */
export function dollNumbers(doc: CharacterDoc, cfgId: string, lookup: ItemLookup = getItem): Record<StatKey, number> {
  const build = toDollState(hydrate(doc, lookup), cfgId);
  const t = computeStats(build).t;
  const ib = deriveIb(build);
  const c = computeSummary(build, t, ib).char;
  const g = (...keys: string[]): number => keys.reduce((s, k) => s + (t[k] || 0) + (ib[k] || 0), 0);
  return {
    level: doc.level,
    hp: c.hp,
    mp: c.mp,
    vit: c.attr.vit,
    str: c.attr.str,
    mag: c.attr.mag,
    dex: c.attr.dex,
    physMin: c.physAtk.min,
    physMax: c.physAtk.max,
    magMin: c.magAtk.min,
    magMax: c.magAtk.max,
    crit: c.crit,
    aps: c.aps,
    acc: c.acc,
    pa: g('ad', 'gs_ad'),
    cast: g('ci') - g('re') + g('xj'),
    stealth: c.stealth,
    mobDmg: g('su', 'qgc'),
    physDef: c.physDef,
    magDef: c.magDef,
    critDmg: 200 + g('gs_crit_rage_ghk'),
    speed: c.speed,
    eva: c.eva,
    pz: g('sx', 'gs_sx'),
    soul: g('mk'),
    detect: c.detect,
    mobDef: g('wz', 'wkl'),
  };
}

/** Рядки звірки в порядку вікна гри: ключ, підпис, допустима різниця. Похідні
 * числа (ЖС, атака, захист…) рушій округлює трохи інакше, ніж гра, — їм ±1.
 * «Сили Духу» тут немає: лялька її не рахує. */
const ROWS: Array<[StatKey, string, number]> = [
  ['level', 'Рівень', 0],
  ['hp', 'ЖС', 1],
  ['mp', 'МЕ', 1],
  ['vit', 'Тіло', 0],
  ['str', 'Сила', 0],
  ['mag', 'Інтелект', 0],
  ['dex', 'Спритність', 0],
  ['physMin', 'Фіз. атака, мін', 1],
  ['physMax', 'Фіз. атака, макс', 1],
  ['magMin', 'Маг. атака, мін', 1],
  ['magMax', 'Маг. атака, макс', 1],
  ['crit', 'Шанс крит. удару, %', 0],
  ['aps', 'Атак/сек', 0.005],
  ['acc', 'Точність', 1],
  ['pa', 'Показник атаки', 0],
  ['cast', 'Підготовка заклинань', 0],
  ['stealth', 'Непомітність', 0],
  ['mobDmg', 'Шкода монстрам', 0],
  ['physDef', 'Фіз. захист', 1],
  ['magDef', 'Маг. захист', 1],
  ['critDmg', 'Крит. шкода, %', 0],
  ['speed', 'Швидкість, м/сек', 0.05],
  ['eva', 'Ухилення', 1],
  ['pz', 'Показник захисту', 0],
  ['detect', 'Виявлення', 0],
  ['mobDef', 'Захист від монстрів', 0],
];

export interface StatRow {
  key: StatKey;
  label: string;
  /** Число з гри; null — на скріншоті не прочитано. */
  game: number | null;
  doll: number;
  /** Чи збігається в межах допуску; null — порівняти нема з чим. */
  ok: boolean | null;
}

/** Порівняти числа зі скріншота з тим, що дає лялька в конфігурації. */
export function compareStats(doc: CharacterDoc, cfgId: string, stats: StatsScan, lookup: ItemLookup = getItem): StatRow[] {
  const doll = dollNumbers(doc, cfgId, lookup);
  return ROWS.map(([key, label, tol]) => {
    const game = stats.values[key] ?? null;
    return { key, label, game, doll: doll[key], ok: game === null ? null : Math.abs(game - doll[key]) <= tol + 1e-9 };
  });
}

const okCount = (rows: StatRow[] | null): number => (rows ? rows.filter((r) => r.ok).length : 0);

export interface Report {
  /** Усі конфігурації ляльки (Головний і сети) з порівнянням слотів. */
  configs: CfgMatch[];
  /** Конфігурація, яку сканер вважає надітою. */
  autoCfgId: string;
  /** Конфігурація, для якої складено звіт (вибрана вручну або автоматична). */
  cfg: CfgMatch;
  /** Числа: гра проти ляльки в цій конфігурації (null — скріншота характеристик немає). */
  stats: StatRow[] | null;
}

/**
 * Звіт звірки. Досить одного з двох скріншотів: за спорядженням конфігурацію
 * вибираємо по речах, без нього — по числах. `cfgId` — якщо гравець вибрав
 * конфігурацію сам (невідомий id ігнорується).
 */
export function buildReport(
  doc: CharacterDoc,
  equipScan: EquipScan | null,
  stats: StatsScan | null,
  cfgId: string | null = null,
  lookup: ItemLookup = getItem,
): Report {
  const configs: CfgMatch[] = equipScan
    ? matchConfigs(doc, equipScan, lookup)
    : [{ cfgId: CFG_MAIN, name: 'Головний' }, ...doc.sets.map((s) => ({ cfgId: s.id, name: s.name }))].map((c) => ({ ...c, same: 0, slots: [] }));
  const rowsOf = new Map<string, StatRow[] | null>(configs.map((c) => [c.cfgId, stats ? compareStats(doc, c.cfgId, stats, lookup) : null]));
  // Більше збігів по речах — краще; за рівності вирішують числа; далі — порядок у документі.
  let auto = configs[0];
  for (const c of configs) {
    if (c.same > auto.same || (c.same === auto.same && okCount(rowsOf.get(c.cfgId) ?? null) > okCount(rowsOf.get(auto.cfgId) ?? null))) auto = c;
  }
  const cfg = configs.find((c) => c.cfgId === cfgId) ?? auto;
  return { configs, autoCfgId: auto.cfgId, cfg, stats: rowsOf.get(cfg.cfgId) ?? null };
}

/** Надіти річ з інвентаря в слот конфігурації. Джинн і політ живуть лише в Головному. */
export function applyFix(doc: CharacterDoc, cfgId: string, slot: SlotKey, iid: string): CharacterDoc {
  return equip(doc, isSetSlotKey(slot) ? cfgId : CFG_MAIN, slot, iid);
}

export interface Reconcile {
  /** Конфігурація, яка найбільше схожа на скріншоти. */
  cfg: CfgMatch;
  /** Усі конфігурації — щоб показати, з чого вибирали. */
  configs: CfgMatch[];
  /** Числа: гра проти ляльки як вона є (null — скріншота характеристик немає). */
  stats: StatRow[] | null;
  /** Слоти, де річ однозначно замінюється з інвентаря, і лялька після заміни. */
  applied: SlotKey[];
  fixed: CharacterDoc | null;
  /** Числа після заміни (null — замін немає або немає скріншота характеристик). */
  statsFixed: StatRow[] | null;
}

/** Звірити ляльку зі скріншотами й одразу застосувати однозначні заміни (для командного рядка й тестів). */
export function reconcile(doc: CharacterDoc, equipScan: EquipScan | null, stats: StatsScan | null, lookup: ItemLookup = getItem): Reconcile {
  const { cfg, configs, stats: rows } = buildReport(doc, equipScan, stats, null, lookup);
  const fix = applyFixes(doc, cfg);
  const changed = fix.applied.length > 0;
  return {
    cfg,
    configs,
    stats: rows,
    applied: fix.applied,
    fixed: changed ? fix.doc : null,
    statsFixed: changed && stats ? compareStats(fix.doc, cfg.cfgId, stats, lookup) : null,
  };
}
