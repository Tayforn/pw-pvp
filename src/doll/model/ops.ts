// =========================================================
// ЛЯЛЬКА — операції над документом. Кожна — чиста: приймає doc, повертає
// новий обʼєкт (або той самий, якщо змінювати нема чого — UI може порівняти
// посилання). Правила з рішень власника: речі — один пул, Головний і сети
// посилаються на них; правка речі з вкладки сету, коли річ надіта ще десь,
// автоматично робить копію; сироти просто лежать в інвентарі.
// =========================================================

import { buffHasSides, buffMaxLevel, maxSockets } from '../core/constants';
import { conflictingActive } from '../core/buffs';
import { getBuffById } from '../core/refdata';
import { ATTR_BASE } from '../core/stats';
import { defaultState } from '../core/types';
import {
  DOC_LIMITS, MAX_LEVEL, SET_SLOT_KEYS, SLOT_CAT, SLOT_KEYS, clampRollValue, cleanText, isSetSlotKey, isSlotKey, rollRowCount, setKindShort,
  type BuffCfgRow, type Cat, type CharacterDoc, type ClsKey, type ItemInst, type SetCfg, type SetKind, type SlotKey, type StatRow,
} from './doc';
import { CFG_MAIN, findSet, mainFill, newIid, whereWorn } from './hydrate';

// ---------- ліміти ----------

/** Чому операцію не виконано: вичерпано ліміт речей або рядків ролів. Операції
 * над документом ніколи не виводять його за DOC_LIMITS — інакше чернетку, яку
 * вже не прийме сервер, не було б як зберегти. */
export type LimitReason = 'items' | 'rolls';
export const LIMIT_TEXT: Record<LimitReason, string> = {
  items: `Ліміт речей: ${DOC_LIMITS.items} на персонажа. Видали зайві з інвентаря, щоб додати ще.`,
  rolls: `Ліміт ролів: ${DOC_LIMITS.rollRows} рядків характеристик і гравіювання на персонажа. Прибери зайві рядки, щоб додати ще.`,
};

function instRows(inst: ItemInst | undefined): number {
  return inst ? (inst.x?.length || 0) + (inst.e?.length || 0) : 0;
}

// ---------- персонаж ----------

export function setName(doc: CharacterDoc, name: string): CharacterDoc {
  const v = cleanText(name, DOC_LIMITS.nameLen);
  return v === doc.name ? doc : { ...doc, name: v };
}
/** Зміна класу надіті речі НЕ знімає — «не вдягається» покаже сама лялька. */
export function setCls(doc: CharacterDoc, cls: ClsKey): CharacterDoc {
  return cls === doc.cls ? doc : { ...doc, cls };
}
export function setGender(doc: CharacterDoc, gender: 'm' | 'f'): CharacterDoc {
  return gender === doc.gender ? doc : { ...doc, gender };
}
/**
 * Рівень атрибутів НЕ чіпає, навіть якщо після зниження роздано більше очок,
 * ніж дає рівень: поле вводу комітить кожне натискання, і набір «105» проходить
 * через 1 і 10 — скидання атрибутів на проміжному значенні знищило б розподіл.
 * Перевитрату показує шапка («Вільні очки» червоним), а validateDoc не дасть
 * такий документ зберегти.
 */
export function setLevel(doc: CharacterDoc, level: number): CharacterDoc {
  const v = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level) || 1));
  return v === doc.level ? doc : { ...doc, level: v };
}
/** Атрибут не нижче базових 5 (як у грі); бюджет рівня тримає UI (DollHeader clampAttr). */
export function setAttr(doc: CharacterDoc, k: 'str' | 'dex' | 'vit' | 'mag', v: number): CharacterDoc {
  const n = Math.max(ATTR_BASE, Math.min(9999, Math.floor(v) || 0));
  return n === doc.attrs[k] ? doc : { ...doc, attrs: { ...doc.attrs, [k]: n } };
}
/** «Титули»: 0 або порожнє значення прибирає поле. */
export function setTitle(doc: CharacterDoc, code: string, v: number | null | undefined): CharacterDoc {
  const titles: Partial<Record<string, number>> = { ...(doc.titles || {}) };
  const n = Math.max(0, Math.round(Number(v) || 0));
  if (n) titles[code] = n;
  else delete titles[code];
  return Object.keys(titles).length ? { ...doc, titles } : withoutKey(doc, 'titles');
}
export function setPath(doc: CharacterDoc, path: 'rs' | 'je' | null): CharacterDoc {
  if ((doc.path ?? null) === path) return doc;
  return path ? { ...doc, path } : withoutKey(doc, 'path');
}

function withoutKey<K extends keyof CharacterDoc>(doc: CharacterDoc, key: K): CharacterDoc {
  if (!(key in doc)) return doc;
  const copy = { ...doc };
  delete copy[key];
  return copy;
}

// ---------- сети ----------

/** Id сету з того самого лічильника, що й iid: детерміновано і завжди унікально. */
function newSetId(doc: CharacterDoc): { doc: CharacterDoc; id: string } {
  const taken = new Set(doc.sets.map((s) => s.id));
  let n = Math.max(1, Math.floor(doc.nextIid) || 1);
  let id = 's' + n.toString(36).padStart(5, '0');
  while (taken.has(id)) {
    n++;
    id = 's' + n.toString(36).padStart(5, '0');
  }
  return { doc: { ...doc, nextIid: n + 1 }, id };
}

/** Назва за замовчуванням: «ПЗ», «ПЗ 2», … — перша вільна серед сетів документа.
 * Третій вид підписано за класом персонажа: «Спів» кастерам, «Аспд» іншим. */
export function defaultSetName(doc: CharacterDoc, kind: SetKind): string {
  const taken = new Set(doc.sets.map((s) => s.name));
  const base = setKindShort(kind, doc.cls);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(base + ' ' + n)) return base + ' ' + n;
}

/** Новий ПОРОЖНІЙ сет (речі Головного видно в інвентарі, «привидів» нема).
 * Два сети одного виду дозволені; понад ліміт — setId null, doc без змін. */
export function createSet(doc: CharacterDoc, kind: SetKind, name?: string): { doc: CharacterDoc; setId: string | null } {
  if (doc.sets.length >= DOC_LIMITS.sets) return { doc, setId: null };
  const clean = cleanText((name || '').trim(), DOC_LIMITS.setNameLen).trim() || defaultSetName(doc, kind);
  const { doc: d, id } = newSetId(doc);
  const set: SetCfg = { id, name: clean, kind, slots: {} };
  return { doc: { ...d, sets: [...d.sets, set] }, setId: id };
}

function updateSet(doc: CharacterDoc, setId: string, fn: (s: SetCfg) => SetCfg): CharacterDoc {
  const i = doc.sets.findIndex((s) => s.id === setId);
  if (i < 0) return doc;
  const next = fn(doc.sets[i]);
  if (next === doc.sets[i]) return doc;
  const sets = doc.sets.slice();
  sets[i] = next;
  return { ...doc, sets };
}

export function renameSet(doc: CharacterDoc, setId: string, name: string): CharacterDoc {
  const clean = cleanText(name.trim(), DOC_LIMITS.setNameLen).trim();
  if (!clean) return doc;
  return updateSet(doc, setId, (s) => (s.name === clean ? s : { ...s, name: clean }));
}
export function setSetKind(doc: CharacterDoc, setId: string, kind: SetKind): CharacterDoc {
  return updateSet(doc, setId, (s) => (s.kind === kind ? s : { ...s, kind }));
}

/** Речі сету, які після його видалення лишаться не надітими ніде (для чекбокса «видалити й N речей»). */
export function setOrphans(doc: CharacterDoc, setId: string): string[] {
  const set = findSet(doc, setId);
  if (!set) return [];
  const own = [...new Set(Object.values(set.slots).filter((v): v is string => !!v))];
  return own.filter((iid) => whereWorn(doc, iid).every((w) => w.cfgId === setId));
}

export function deleteSet(doc: CharacterDoc, setId: string, alsoDeleteOrphans = false): CharacterDoc {
  if (!findSet(doc, setId)) return doc;
  const orphans = alsoDeleteOrphans ? new Set(setOrphans(doc, setId)) : null;
  return {
    ...doc,
    sets: doc.sets.filter((s) => s.id !== setId),
    items: orphans ? doc.items.filter((it) => !orphans.has(it.i)) : doc.items,
  };
}

// ---------- слоти ----------

function cfgSlots(doc: CharacterDoc, cfgId: string): Partial<Record<SlotKey, string>> | null {
  if (cfgId === CFG_MAIN) return doc.main;
  return findSet(doc, cfgId)?.slots ?? null;
}
function withCfgSlots(doc: CharacterDoc, cfgId: string, slots: Partial<Record<SlotKey, string>>): CharacterDoc {
  if (cfgId === CFG_MAIN) return { ...doc, main: slots };
  return updateSet(doc, cfgId, (s) => ({ ...s, slots }));
}

export function findInst(doc: CharacterDoc, iid: string): ItemInst | undefined {
  return doc.items.find((it) => it.i === iid);
}

/** Надіти річ у слот конфігурації. Категорія не відповідає слоту, джинн/політ у
 * сеті, невідома річ чи конфігурація — doc без змін. Річ, що вже стоїть в іншому
 * слоті цієї конфігурації (кільце на другій руці), переноситься. */
export function equip(doc: CharacterDoc, cfgId: string, slot: SlotKey, iid: string): CharacterDoc {
  const inst = findInst(doc, iid);
  if (!inst || !isSlotKey(slot) || SLOT_CAT[slot] !== inst.cat) return doc;
  if (cfgId !== CFG_MAIN && !isSetSlotKey(slot)) return doc;
  const cur = cfgSlots(doc, cfgId);
  if (!cur) return doc;
  if (cur[slot] === iid) return doc;
  const next: Partial<Record<SlotKey, string>> = { ...cur };
  for (const k of SLOT_KEYS) if (next[k] === iid) delete next[k];
  next[slot] = iid;
  return withCfgSlots(doc, cfgId, next);
}

/** Куди надіти річ за кліком в інвентарі: свій слот; для кілець — вільна рука,
 * інакше ліва. null = у цю конфігурацію річ не лізе (джинн/політ у сеті). */
export function defaultSlotFor(doc: CharacterDoc, cfgId: string, inst: ItemInst): SlotKey | null {
  const cur = cfgSlots(doc, cfgId);
  if (!cur) return null;
  if (inst.cat === 'oq') {
    if (!cur.cr || cur.cr === inst.i) return 'cr';
    if (!cur.cd || cur.cd === inst.i) return 'cd';
    return 'cr';
  }
  const slot = SLOT_KEYS.find((s) => SLOT_CAT[s] === inst.cat);
  if (!slot) return null;
  if (cfgId !== CFG_MAIN && !isSetSlotKey(slot)) return null;
  return slot;
}

/** Надіти в конфігурацію без вказання слота (клік по речі в інвентарі). */
export function equipAuto(doc: CharacterDoc, cfgId: string, iid: string): CharacterDoc {
  const inst = findInst(doc, iid);
  if (!inst) return doc;
  const slot = defaultSlotFor(doc, cfgId, inst);
  return slot ? equip(doc, cfgId, slot, iid) : doc;
}

export function unequip(doc: CharacterDoc, cfgId: string, slot: SlotKey): CharacterDoc {
  const cur = cfgSlots(doc, cfgId);
  if (!cur || !cur[slot]) return doc;
  const next = { ...cur };
  delete next[slot];
  return withCfgSlots(doc, cfgId, next);
}
export function unequipAll(doc: CharacterDoc, cfgId: string): CharacterDoc {
  const cur = cfgSlots(doc, cfgId);
  if (!cur || !Object.keys(cur).length) return doc;
  return withCfgSlots(doc, cfgId, {});
}

/** «Надіти решту з головного»: порожні слоти сету ← речі Головного — рівно те,
 * що й так рахується в заповненій конфігурації (mainFill: без дублів, кільця — пулом). */
export function fillEmptyFromMain(doc: CharacterDoc, setId: string): CharacterDoc {
  return updateSet(doc, setId, (set) => {
    const add = mainFill(doc, set.slots);
    return Object.keys(add).length ? { ...set, slots: { ...set.slots, ...add } } : set;
  });
}

// ---------- речі ----------

/** Прибрати з екземпляра «порожні» поля, щоб документ був канонічним
 * (r 0, порожні списки, гнізда без каменів, шліфовка не у зброї). */
export function normalizeInst(inst: ItemInst): ItemInst {
  const out: ItemInst = { i: inst.i, cat: inst.cat, id: inst.id };
  if (inst.p != null && Number.isFinite(inst.p)) out.p = Math.max(0, Math.floor(inst.p));
  const r = Math.max(0, Math.min(12, Math.floor(inst.r || 0)));
  if (r) out.r = r;
  const g = (inst.g || []).slice(0, maxSockets(inst.cat)).map((x) => Math.max(0, Math.floor(x) || 0));
  while (g.length && g[g.length - 1] === 0) g.pop();
  if (g.length) out.g = g;
  const rows = (list: StatRow[] | undefined): StatRow[] =>
    (list || []).filter((row) => row && typeof row.t === 'string' && row.t).map((row) => ({ t: row.t, v: clampRollValue(row.v) }));
  const x = rows(inst.x);
  if (x.length) {
    out.x = x;
    if (inst.xr) out.xr = true;
  }
  const e = rows(inst.e);
  if (e.length) out.e = e;
  if (inst.cat === 'ta') {
    if (inst.w && inst.w > 0) out.w = Math.floor(inst.w);
    if (inst.c && inst.c > 0) out.c = Math.floor(inst.c);
  }
  return out;
}

function insertAfter(items: ItemInst[], afterIid: string | null, inst: ItemInst): ItemInst[] {
  const i = afterIid ? items.findIndex((it) => it.i === afterIid) : -1;
  if (i < 0) return [...items, inst];
  return [...items.slice(0, i + 1), inst, ...items.slice(i + 1)];
}

/** Додати річ із каталогу в пул (в інвентар) і, якщо просили, одразу надіти.
 * Понад ліміт речей — iid null, doc без змін. */
export function addFromCatalog(
  doc: CharacterDoc,
  cat: Cat,
  id: number,
  opts: { equipTo?: { cfgId: string; slot: SlotKey }; p?: number } = {},
): { doc: CharacterDoc; iid: string | null; blocked?: LimitReason } {
  if (doc.items.length >= DOC_LIMITS.items) return { doc, iid: null, blocked: 'items' };
  const { doc: d, iid } = newIid(doc);
  const inst = normalizeInst({ i: iid, cat, id, p: opts.p });
  let next: CharacterDoc = { ...d, items: [...d.items, inst] };
  if (opts.equipTo) next = equip(next, opts.equipTo.cfgId, opts.equipTo.slot, iid);
  return { doc: next, iid };
}

/** Річ «як з каталогу»: без заточки, каменів, ролів, гравіювання, рун. */
export function isPlainInst(inst: ItemInst): boolean {
  return Object.keys(normalizeInst(inst)).every((k) => k === 'i' || k === 'cat' || k === 'id' || k === 'p');
}

/**
 * Вибір речі з каталогу в слот («Обрати іншу», «Змінити річ»). Попередня власна
 * річ слота, якщо вона «як з каталогу» і ніде більше не надіта, замінюється на
 * місці (той самий рядок інвентаря) — інакше кожна спроба лишала б сироту й
 * зʼїдала ліміт речей. Річ із правками чи надіта ще десь лишається в інвентарі
 * (dropped: null — UI скаже, де її шукати).
 */
export function pickFromCatalog(
  doc: CharacterDoc,
  cfgId: string,
  slot: SlotKey,
  cat: Cat,
  id: number,
  opts: { p?: number } = {},
): { doc: CharacterDoc; iid: string | null; blocked?: LimitReason; dropped: string | null; kept: string | null } {
  if (SLOT_CAT[slot] !== cat) return { doc, iid: null, dropped: null, kept: null };
  const old = cfgSlots(doc, cfgId)?.[slot];
  const oldInst = old ? findInst(doc, old) : undefined;
  const drop = oldInst && isPlainInst(oldInst) && whereWorn(doc, oldInst.i).length === 1 ? oldInst.i : null;
  if (!drop) {
    const r = addFromCatalog(doc, cat, id, { equipTo: { cfgId, slot }, p: opts.p });
    return { ...r, dropped: null, kept: r.iid && old ? old : null };
  }
  const { doc: d, iid } = newIid(doc);
  const inst = normalizeInst({ i: iid, cat, id, p: opts.p });
  const next = equip({ ...d, items: d.items.map((it) => (it.i === drop ? inst : it)) }, cfgId, slot, iid);
  return { doc: next, iid, dropped: drop, kept: null };
}

/** Копія речі — одразу за оригіналом в інвентарі, ніде не надіта. Понад ліміт
 * речей чи рядків ролів — iid null, doc без змін, blocked каже, який ліміт. */
export function duplicateInstance(doc: CharacterDoc, iid: string): { doc: CharacterDoc; iid: string | null; blocked?: LimitReason } {
  const src = findInst(doc, iid);
  if (!src) return { doc, iid: null };
  if (doc.items.length >= DOC_LIMITS.items) return { doc, iid: null, blocked: 'items' };
  if (rollRowCount(doc) + instRows(src) > DOC_LIMITS.rollRows) return { doc, iid: null, blocked: 'rolls' };
  const { doc: d, iid: nid } = newIid(doc);
  const copy = normalizeInst({ ...src, i: nid });
  return { doc: { ...d, items: insertAfter(d.items, iid, copy) }, iid: nid };
}

export type InstPatch = Partial<Omit<ItemInst, 'i' | 'cat' | 'id'>>;

/**
 * Правка екземпляра. З Головного — на місці (сети, що ділять річ, бачать зміну).
 * З вкладки сету, якщо річ надіта ще десь (у Головному чи іншому сеті) — копія
 * з правкою, яка стає на місце оригіналу в цьому сеті; повертає iid копії.
 * Правка, що вивела б документ за ліміт речей (копія) чи рядків ролів, не
 * виконується: doc без змін, blocked каже чому. Правка, що рядків не додає,
 * проходить завжди — щоб документ понад ліміт можна було виправити.
 */
export function updateInstance(
  doc: CharacterDoc,
  cfgId: string,
  iid: string,
  patch: InstPatch,
): { doc: CharacterDoc; iid: string; blocked?: LimitReason } {
  const src = findInst(doc, iid);
  if (!src) return { doc, iid };
  const rows = rollRowCount(doc);
  const elsewhere = cfgId !== CFG_MAIN && whereWorn(doc, iid).some((w) => w.cfgId !== cfgId);
  if (!elsewhere) {
    const next = normalizeInst({ ...src, ...patch, i: src.i, cat: src.cat, id: src.id });
    const after = rows - instRows(src) + instRows(next);
    if (after > DOC_LIMITS.rollRows && after > rows) return { doc, iid, blocked: 'rolls' };
    const items = doc.items.map((it) => (it.i === iid ? next : it));
    return { doc: { ...doc, items }, iid };
  }
  if (doc.items.length >= DOC_LIMITS.items) return { doc, iid, blocked: 'items' };
  const probe = normalizeInst({ ...src, ...patch, i: src.i, cat: src.cat, id: src.id });
  if (rows + instRows(probe) > DOC_LIMITS.rollRows) return { doc, iid, blocked: 'rolls' };
  const { doc: d, iid: nid } = newIid(doc);
  const copy = { ...probe, i: nid };
  let next: CharacterDoc = { ...d, items: insertAfter(d.items, iid, copy) };
  next = updateSet(next, cfgId, (set) => {
    let slots: SetCfg['slots'] | null = null;
    for (const s of SET_SLOT_KEYS)
      if (set.slots[s] === iid) {
        slots = slots || { ...set.slots };
        slots[s] = nid;
      }
    return slots ? { ...set, slots } : set;
  });
  return { doc: next, iid: nid };
}

/** Видалити річ з пулу і зняти її з усіх конфігурацій. */
export function deleteInstance(doc: CharacterDoc, iid: string): CharacterDoc {
  if (!findInst(doc, iid)) return doc;
  const strip = (slots: Partial<Record<SlotKey, string>>): Partial<Record<SlotKey, string>> => {
    const out: Partial<Record<SlotKey, string>> = {};
    for (const k of SLOT_KEYS) if (slots[k] && slots[k] !== iid) out[k] = slots[k];
    return out;
  };
  return {
    ...doc,
    items: doc.items.filter((it) => it.i !== iid),
    main: strip(doc.main),
    sets: doc.sets.map((s) => (Object.values(s.slots).includes(iid) ? { ...s, slots: strip(s.slots) } : s)),
  };
}

// ---------- бафи (лише перегляд статів; у скор не входять) ----------

const DEFAULT_ROW: BuffCfgRow = { on: false, lvl: 10, side: '' };

function buffsOf(doc: CharacterDoc): { cfg: Record<string, BuffCfgRow>; extra: number[] } {
  return { cfg: { ...(doc.buffs?.cfg || {}) }, extra: [...(doc.buffs?.extra || [])] };
}

/** Увімкнути/вимкнути; вмикання гасить взаємовиключні активні (спільний ex-стейт), як у Хелпері. */
export function toggleBuff(doc: CharacterDoc, id: number): CharacterDoc {
  const b = buffsOf(doc);
  const k = String(id);
  const cur = b.cfg[k] || DEFAULT_ROW;
  const on = !cur.on;
  b.cfg[k] = { ...cur, on };
  if (on) {
    const def = getBuffById(id);
    if (def) {
      const probe = defaultState();
      probe.buffCfg = b.cfg;
      for (const cid of conflictingActive(probe, def)) {
        const ck = String(cid);
        if (b.cfg[ck]) b.cfg[ck] = { ...b.cfg[ck], on: false };
      }
    }
  }
  return { ...doc, buffs: b };
}

/** Рівень без сторони: 1..max (для бафів зі сторонами — max−1, бо останній рівень — це сторона). */
export function setBuffLvl(doc: CharacterDoc, id: number, lvl: number): CharacterDoc {
  const b = buffsOf(doc);
  const k = String(id);
  const def = getBuffById(id);
  const max = def ? buffMaxLevel(def) : 99;
  const plainMax = def && buffHasSides(def) ? Math.max(1, max - 1) : max;
  const cur = b.cfg[k] || DEFAULT_ROW;
  b.cfg[k] = { ...cur, lvl: Math.max(1, Math.min(plainMax, Math.floor(lvl) || 1)), side: '' };
  return { ...doc, buffs: b };
}

/** Сторона (rs/je) = максимальний рівень бафа; '' — повернутись до звичайного рівня. */
export function setBuffSide(doc: CharacterDoc, id: number, side: string): CharacterDoc {
  const def = getBuffById(id);
  if (!def || !buffHasSides(def)) return doc;
  const b = buffsOf(doc);
  const k = String(id);
  const cur = b.cfg[k] || DEFAULT_ROW;
  const max = buffMaxLevel(def);
  b.cfg[k] = side ? { ...cur, side, lvl: max } : { ...cur, side: '', lvl: Math.min(cur.lvl, Math.max(1, max - 1)) };
  return { ...doc, buffs: b };
}

/** Додати баф із пошуку: у список доданих і одразу увімкнути. */
export function addExtraBuff(doc: CharacterDoc, id: number): CharacterDoc {
  const b = buffsOf(doc);
  if (!b.extra.includes(id)) b.extra.push(id);
  const k = String(id);
  b.cfg[k] = { ...(b.cfg[k] || DEFAULT_ROW), on: true };
  return { ...doc, buffs: b };
}

/** Прибрати баф з рядка: налаштування й позначку «доданий». */
export function removeExtraBuff(doc: CharacterDoc, id: number): CharacterDoc {
  const b = buffsOf(doc);
  const k = String(id);
  if (!(k in b.cfg) && !b.extra.includes(id)) return doc;
  delete b.cfg[k];
  b.extra = b.extra.filter((x) => x !== id);
  return { ...doc, buffs: b };
}
