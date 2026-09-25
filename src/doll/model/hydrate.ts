// =========================================================
// ЛЯЛЬКА — гідрація документа: посилання (cat, id) → речі каталогу, і
// збірка DollState для ядра з будь-якої конфігурації (Головний або сет).
// Ядро НЕ змінюється: воно й далі отримує «повний білд», а тут лише
// вирішується, ЩО в кожному слоті стоїть — власна річ сету чи річ Головного
// (порожній слот сету для балів рахується як у Головному, план v3 §г).
// =========================================================

import { defaultSockets } from '../core/constants';
import { flattenItemStats } from '../core/stats';
import { defaultState, type DollState, type Item } from '../core/types';
import { getItem } from '../data/catalog';
import {
  SET_SLOT_KEYS, SLOT_CAT, SLOT_KEYS,
  type CharacterDoc, type ItemInst, type SetCfg, type SetSlotKey, type SlotKey, type StatRow,
} from './doc';

export interface HydratedInst {
  inst: ItemInst;
  item: Item | null; // null = невідома річ (каталог не має такого id)
  gems: Array<Item | null>; // довжина = к-сть гнізд категорії, як у Хелпері після «надіти»
  wdf: Item | null;
  crystal: Item | null;
}

export interface CharacterModel {
  doc: CharacterDoc;
  items: Map<string, HydratedInst>; // iid → річ
}

export type ItemLookup = (cat: string, id: number) => Item | undefined;

export const CFG_MAIN = 'main';

/** Які категорії каталогу треба довантажити для документа. Камені, руни й
 * кристали — завжди: вони потрібні і для гідрації, і для редактора речі. */
export function docCats(doc: CharacterDoc): string[] {
  const cats = new Set<string>();
  for (const it of doc.items) cats.add(it.cat);
  cats.add('ob');
  cats.add('wdf');
  cats.add('crystal');
  return [...cats].sort();
}

/** Синхронна гідрація через getItem каталогу (або переданий lookup — у тестах з диска).
 * Невідома річ/камінь → null, документ не змінюється. */
export function hydrate(doc: CharacterDoc, lookup: ItemLookup = getItem): CharacterModel {
  const items = new Map<string, HydratedInst>();
  for (const inst of doc.items) {
    const n = defaultSockets(inst.cat);
    const gems: Array<Item | null> = n > 0 ? new Array<Item | null>(n).fill(null) : [];
    (inst.g || []).forEach((gid, i) => {
      if (gid && i < n) gems[i] = lookup('ob', gid) ?? null;
    });
    items.set(inst.i, {
      inst,
      item: lookup(inst.cat, inst.id) ?? null,
      gems,
      wdf: inst.cat === 'ta' && inst.w ? (lookup('wdf', inst.w) ?? null) : null,
      crystal: inst.cat === 'ta' && inst.c ? (lookup('crystal', inst.c) ?? null) : null,
    });
  }
  return { doc, items };
}

/** Зворотне до hydrate: документ і є джерелом істини, гідрація нічого не додає. */
export function dehydrate(model: CharacterModel): CharacterDoc {
  return model.doc;
}

/** Ефективні стати екземпляра — те, що піде в ядро як addons:
 * xr → лише x (база замінена); інакше база каталогу + x. Невідома річ → лише x. */
export function instStats(h: HydratedInst): Array<{ type: string; val: number }> {
  const x = (h.inst.x || []).map((r) => ({ type: r.t, val: r.v }));
  if (h.inst.xr || !h.item) return x;
  if (!x.length) return []; // порожній список = «база» для ядра, як у Хелпері без правок
  return [...flattenItemStats(h.item), ...x];
}

export function findSet(doc: CharacterDoc, setId: string): SetCfg | undefined {
  return doc.sets.find((s) => s.id === setId);
}

/** Власні слоти конфігурації (без добору з Головного); невідома конфігурація → {}. */
export function ownSlots(doc: CharacterDoc, cfgId: string): Partial<Record<SlotKey, string>> {
  if (cfgId === CFG_MAIN) return { ...doc.main };
  const set = findSet(doc, cfgId);
  return set ? { ...set.slots } : {};
}

const RING_SLOTS = ['cr', 'cd'] as const;

/**
 * Що сет добирає з Головного у свої порожні слоти (без джинна й польоту — вони
 * спільні завжди). Річ, уже надіта в сеті, вдруге не береться. Кільця
 * взаємозамінні: спершу кожна вільна рука бере кільце Головного з тієї ж руки,
 * потім — друге кільце Головного, яке ще ніде в сеті. Інакше сет, де кільце
 * Головного з правої руки надіте на ліву, рахувався б з одним кільцем, і дельти
 * показували б мінус, якого в грі нема.
 */
export function mainFill(doc: CharacterDoc, own: Partial<Record<SlotKey, string>>): Partial<Record<SetSlotKey, string>> {
  const out: Partial<Record<SetSlotKey, string>> = {};
  const used = new Set(Object.values(own).filter((v): v is string => !!v));
  for (const s of SET_SLOT_KEYS) {
    if (s === 'cr' || s === 'cd') continue;
    const iid = doc.main[s];
    if (own[s] || !iid || used.has(iid)) continue;
    out[s] = iid;
    used.add(iid);
  }
  const spare = RING_SLOTS.map((s) => doc.main[s]).filter((iid): iid is string => !!iid && !used.has(iid));
  const free = RING_SLOTS.filter((s) => !own[s]);
  for (const s of free) {
    const iid = doc.main[s];
    const k = iid ? spare.indexOf(iid) : -1;
    if (k < 0) continue;
    out[s] = spare[k];
    spare.splice(k, 1);
  }
  for (const s of free) if (!out[s] && spare.length) out[s] = spare.shift();
  return out;
}

/**
 * Слоти конфігурації так, як їх бачить ядро. Для сету: власні слоти +
 * (fillFromMain, дефолт true) порожні беруться з Головного (mainFill); джинн
 * і політ — завжди з Головного.
 */
export function effectiveSlots(
  model: CharacterModel,
  cfgId: string,
  opts: { fillFromMain?: boolean } = {},
): Partial<Record<SlotKey, string>> {
  const doc = model.doc;
  if (cfgId === CFG_MAIN) return { ...doc.main };
  const set = findSet(doc, cfgId);
  if (!set) return {};
  const out: Partial<Record<SlotKey, string>> = {};
  for (const s of SET_SLOT_KEYS) if (set.slots[s]) out[s] = set.slots[s];
  if (opts.fillFromMain !== false) Object.assign(out, mainFill(doc, set.slots));
  for (const s of ['pk', 'ic'] as const) if (doc.main[s]) out[s] = doc.main[s];
  return out;
}

/** Зібрати DollState для ядра з конфігурації. Бафи — лише при opts.buffs
 * (у скор вони не входять); рюкзак завжди порожній, сервер — noServer. */
export function toDollState(
  model: CharacterModel,
  cfgId: string,
  opts: { fillFromMain?: boolean; buffs?: boolean } = {},
): DollState {
  const doc = model.doc;
  const b = defaultState();
  b.cls = doc.cls;
  b.gender = doc.gender;
  b.level = doc.level;
  b.str = doc.attrs.str;
  b.dex = doc.attrs.dex;
  b.vit = doc.attrs.vit;
  b.mag = doc.attrs.mag;
  b.titles = {};
  for (const [k, v] of Object.entries(doc.titles || {})) if (typeof v === 'number' && v > 0) b.titles[k] = v;
  const slots = effectiveSlots(model, cfgId, { fillFromMain: opts.fillFromMain });
  for (const slot of SLOT_KEYS) {
    const iid = slots[slot];
    const h = iid ? model.items.get(iid) : undefined;
    if (!h || !h.item || h.inst.cat !== SLOT_CAT[slot]) continue; // невідома або чужа річ — слот порожній
    b.equipped[slot] = h.item;
    b.gems[slot] = [...h.gems];
    b.refine[slot] = h.inst.r || 0;
    b.addons[slot] = instStats(h);
    b.engrave[slot] = (h.inst.e || []).map((r) => ({ type: r.t, val: r.v }));
    b.wdf[slot] = h.wdf;
    b.crystal[slot] = h.crystal;
  }
  if (opts.buffs && doc.buffs) {
    b.buffCfg = {};
    for (const [k, c] of Object.entries(doc.buffs.cfg)) b.buffCfg[k] = { on: c.on, lvl: c.lvl, side: c.side };
    b.extraBuffs = [...doc.buffs.extra];
  }
  return b;
}

const rowKey = (r: StatRow): string => r.t + '=' + r.v;
const sortedRows = (rows: Array<{ type: string; val: number }>): string =>
  rows
    .map((r) => r.type + '=' + r.val)
    .sort()
    .join(',');

/** Ключ «однаковості» речей: дві різні речі з тим самим ключем — не відмінність
 * (копія без змін не дає Δ). Стати — ефективні, порядок рядків не важить. */
export function slotKey(h: HydratedInst): string {
  const inst = h.inst;
  const gems = (inst.g || []).filter((g) => g > 0).sort((a, b) => a - b);
  const eng = (inst.e || []).map(rowKey).sort();
  return [
    inst.cat + ':' + inst.id,
    'r' + (inst.r || 0),
    'g' + gems.join('.'),
    's' + sortedRows(instStats(h)),
    'e' + eng.join(','),
    'w' + (inst.cat === 'ta' && inst.w ? inst.w : 0),
    'c' + (inst.cat === 'ta' && inst.c ? inst.c : 0),
  ].join('|');
}

/** Інвентар конфігурації: усі iid, не надіті в ній (власні слоти; для сету
 * джинн і політ Головного теж вважаються надітими — їх у сет не покласти).
 * Порядок — як у doc.items. */
export function inventoryOf(model: CharacterModel, cfgId: string): string[] {
  const worn = new Set(Object.values(effectiveSlots(model, cfgId, { fillFromMain: false })));
  return model.doc.items.map((it) => it.i).filter((iid) => !worn.has(iid));
}

/** Де надіта річ: у Головному та/або в сетах (лише власні слоти). */
export function whereWorn(model: CharacterModel | CharacterDoc, iid: string): Array<{ cfgId: string; slot: SlotKey }> {
  const doc = 'doc' in model ? model.doc : model;
  const out: Array<{ cfgId: string; slot: SlotKey }> = [];
  for (const slot of SLOT_KEYS) if (doc.main[slot] === iid) out.push({ cfgId: CFG_MAIN, slot });
  for (const set of doc.sets) for (const slot of SET_SLOT_KEYS) if (set.slots[slot] === iid) out.push({ cfgId: set.id, slot });
  return out;
}

/** Новий iid з лічильника (base36); лічильник рухається, поки не знайдеться вільний. */
export function newIid(doc: CharacterDoc): { doc: CharacterDoc; iid: string } {
  const taken = new Set(doc.items.map((it) => it.i));
  let n = Math.max(1, Math.floor(doc.nextIid) || 1);
  let iid = n.toString(36);
  while (taken.has(iid)) {
    n++;
    iid = n.toString(36);
  }
  return { doc: { ...doc, nextIid: n + 1 }, iid };
}
