// =========================================================
// ЛЯЛЬКА — документ персонажа (те, що лежить у чернетці й піде в базу).
// Речі — один пул посилань на каталог (cat + id) з правками екземпляра
// (заточка, камені, ручні роли); Головний і сети лише посилаються на них
// за iid. Стати речей у документі не зберігаються — їх дає каталог, тому
// підробити їх неможливо, а документ важить кілобайти, а не десятки.
// validateDoc — той самий набір правил, що згодом перевірятиме сервер.
// =========================================================

import { ADDON_CODES, STAT_ALIAS, maxSockets } from '../core/constants';
import { ATTR_BASE, TITLE_FIELDS } from '../core/stats';
import { sheetErrors, type Sheet } from './sheet';

export type SlotKey = 'ft' | 'vx' | 'rv' | 'st' | 'tg' | 'rx' | 'wy' | 'mj' | 'cr' | 'cd' | 'ta' | 'it' | 'qn' | 'pp' | 'pk' | 'gv' | 'ic';
/** Слоти, доступні сетам: джинн і політ — лише в Головному. */
export type SetSlotKey = Exclude<SlotKey, 'pk' | 'ic'>;
export type Cat = 'ft' | 'vx' | 'rv' | 'st' | 'tg' | 'rx' | 'wy' | 'mj' | 'oq' | 'ta' | 'it' | 'qn' | 'pp' | 'pk' | 'gv' | 'ic';

/** Слот → категорія каталогу (обидва кільця беруть речі з oq). */
export const SLOT_CAT: Record<SlotKey, Cat> = {
  ft: 'ft', vx: 'vx', rv: 'rv', st: 'st', tg: 'tg', rx: 'rx', wy: 'wy', mj: 'mj',
  cr: 'oq', cd: 'oq', ta: 'ta', it: 'it', qn: 'qn', pp: 'pp', pk: 'pk', gv: 'gv', ic: 'ic',
};
/** Порядок слотів — як у сітці ляльки (core SLOTS). */
export const SLOT_KEYS = Object.keys(SLOT_CAT) as SlotKey[];
export const SET_SLOT_KEYS = SLOT_KEYS.filter((s): s is SetSlotKey => s !== 'pk' && s !== 'ic');
const SLOT_SET: ReadonlySet<string> = new Set(SLOT_KEYS);
const SET_SLOT_SET: ReadonlySet<string> = new Set(SET_SLOT_KEYS);
const CAT_SET: ReadonlySet<string> = new Set(Object.values(SLOT_CAT));

export function isSlotKey(s: string): s is SlotKey {
  return SLOT_SET.has(s);
}
export function isSetSlotKey(s: string): s is SetSlotKey {
  return SET_SLOT_SET.has(s);
}
export function isDocCat(c: string): c is Cat {
  return CAT_SET.has(c);
}

/** Лише 10 класів (без призрака/жнеця/паладина/стрільця — їх нема на сервері гільдії). */
export type ClsKey = 'by' | 'ga' | 'ya' | 'rl' | 'ij' | 'js' | 'fx' | 'sj' | 'ej' | 'rg';
export const CLS_KEYS: readonly ClsKey[] = ['by', 'ga', 'ya', 'rl', 'ij', 'js', 'fx', 'sj', 'ej', 'rg'];
const CLS_SET: ReadonlySet<string> = new Set(CLS_KEYS);
export function isClsKey(c: string): c is ClsKey {
  return CLS_SET.has(c);
}

export interface StatRow {
  t: string; // код стату (з ADDON_CODES)
  v: number;
}

export interface ItemInst {
  i: string; // iid ^[a-z0-9]{1,6}$ — унікальний у документі
  cat: Cat;
  id: number; // id у каталозі категорії
  p?: number; // pw_id речі (довідково, для звірки з сервером)
  r?: number; // заточка 0..12
  g?: number[]; // id каменів по гніздах, 0 = порожнє гніздо
  x?: StatRow[]; // ДОДАНІ роли понад базу каталогу
  xr?: boolean; // true = x ЗАМІНЮЄ базу (річ, чиї каталожні стати не збігаються з сервером; видно адміну)
  e?: StatRow[]; // гравіювання
  w?: number; // руна шліфовки (лише ta)
  c?: number; // кристал (лише ta)
}

export type SetKind = 'pz' | 'pa' | 'aspd';
export const SET_KINDS: readonly SetKind[] = ['pz', 'pa', 'aspd'];
export const SET_KIND_LABELS: Record<SetKind, string> = { pz: 'ПЗ', pa: 'ПА', aspd: 'Спів / Аспд' };
/** Класи, яким третій вид сету — «Спів» (час співу), решті — «Аспд» (атак/сек). */
export const CASTER_CLS: ReadonlySet<string> = new Set(['ga', 'rl', 'ij', 'sj', 'rg']);
/** Короткий підпис виду для конкретного класу: «ПЗ», «ПА», «Спів» або «Аспд». */
export function setKindShort(kind: SetKind, cls: string): string {
  if (kind === 'aspd') return CASTER_CLS.has(cls) ? 'Спів' : 'Аспд';
  return SET_KIND_LABELS[kind];
}
const KIND_SET: ReadonlySet<string> = new Set(SET_KINDS);
export function isSetKind(k: string): k is SetKind {
  return KIND_SET.has(k);
}

export interface SetCfg {
  id: string; // ^[a-z0-9]{6,12}$
  name: string; // 1..24
  kind: SetKind;
  slots: Partial<Record<SetSlotKey, string>>; // слот → iid; відсутній = порожній
}

export interface BuffCfgRow {
  on: boolean;
  lvl: number;
  side: string; // '' | 'rs' | 'je'
}

export interface CharacterDoc {
  v: 2;
  name: string; // 0..32
  cls: ClsKey;
  gender: 'm' | 'f';
  level: number; // 1..105
  attrs: { str: number; dex: number; vit: number; mag: number };
  titles?: Partial<Record<string, number>>;
  path?: 'rs' | 'je' | null; // мудрець / демон
  nextIid: number;
  items: ItemInst[]; // пул речей; порядок = порядок в інвентарі
  main: Partial<Record<SlotKey, string>>;
  sets: SetCfg[];
  buffs?: { cfg: Record<string, BuffCfgRow>; extra: number[] }; // лише для перегляду статів, у скор не входить
  /** Анкета для турнірів — поля, яких лялька не знає (грейди речей); див. model/sheet.ts. */
  sheet?: Sheet;
}

export const DOC_LIMITS = { items: 100, rollRows: 400, sets: 5, nameLen: 32, setNameLen: 24, bytes: 32768 } as const;

export const IID_RE = /^[a-z0-9]{1,6}$/;
export const SET_ID_RE = /^[a-z0-9]{6,12}$/;
export const MAX_LEVEL = 105;
const MAX_ATTR = 9999;
/** Межа значення рядка ролу: найбільший стат у каталогах — тисячі, тож мільйон
 * лишає запас, але не пускає 1e308, від якого суми ядра стають Infinity/NaN. */
export const MAX_ROLL_VALUE = 1_000_000;
/** Знаків після коми в рядку ролу: у каталогах трапляється 0.05 (пауза між атаками). */
export const ROLL_DECIMALS = 2;
const MAX_BUFF_LVL = 99;
const MAX_ID = 2 ** 31 - 1;
/** Дозволені коди ролів: ADDON_CODES + коди-аліаси Хелпера (mana/oi_eq/ab_eq/metal_eq),
 * які приходять з імпорту білда і які ядро рахує само (див. importCalc.ts, чому не канонізуємо). */
export const ROLL_CODES: readonly string[] = [...ADDON_CODES, ...Object.keys(STAT_ALIAS).filter((k) => !ADDON_CODES.includes(k))];
const ADDON_SET: ReadonlySet<string> = new Set(ROLL_CODES);
const TITLE_SET: ReadonlySet<string> = new Set(TITLE_FIELDS.map((f) => f.code));

/** Порожній персонаж: 105-й рівень і базові 5 очок у кожен атрибут — як стартовий білд Хелпера. */
export function emptyDoc(cls: ClsKey = 'by'): CharacterDoc {
  return {
    v: 2,
    name: '',
    cls,
    gender: 'm',
    level: MAX_LEVEL,
    attrs: { str: 5, dex: 5, vit: 5, mag: 5 },
    nextIid: 1,
    items: [],
    main: {},
    sets: [],
  };
}

/** Вільні очки атрибутів: 5 за рівень понад перший мінус витрачене понад базові 5
 * (та сама формула, що availPoints ядра). Мінус — очок роздано більше, ніж дає рівень. */
export function attrPointsLeft(level: number, attrs: CharacterDoc['attrs']): number {
  const budget = 5 * Math.max(0, (Math.floor(level) || 1) - 1);
  return budget - (attrs.str - ATTR_BASE + (attrs.dex - ATTR_BASE) + (attrs.vit - ATTR_BASE) + (attrs.mag - ATTR_BASE));
}

// Керівні символи й одинокі сурогати: jsonb бази не прийме \u0000, а розрізана
// навпіл емодзі — уже не текст. Табуляцію з буфера обміну теж прибираємо.
const CTRL_RE = /[\u0000-\u001f\u007f]/;
const LONE_SURROGATE_RE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** Рядок, який можна зберегти як імʼя: без керівних символів і одиноких
 * сурогатів. Довжина — в одиницях UTF-16 (як maxLength поля вводу і як рахує
 * validateDoc), але різ не розриває емодзі навпіл. */
export function cleanText(raw: string, max: number): string {
  let s = String(raw ?? '')
    .replace(new RegExp(CTRL_RE.source, 'g'), '')
    .replace(new RegExp(LONE_SURROGATE_RE.source, 'g'), '');
  if (s.length > max) {
    s = s.slice(0, max);
    if (/[\ud800-\udbff]$/.test(s)) s = s.slice(0, -1);
  }
  return s;
}

function badText(s: string): boolean {
  return CTRL_RE.test(s) || LONE_SURROGATE_RE.test(s);
}

/** Значення рядка ролу в межах: ±MAX_ROLL_VALUE і не більше ROLL_DECIMALS знаків після коми. */
export function clampRollValue(v: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const k = 10 ** ROLL_DECIMALS;
  const r = Math.round(Math.max(-MAX_ROLL_VALUE, Math.min(MAX_ROLL_VALUE, n)) * k) / k;
  return r === 0 ? 0 : r; // без «-0» у JSON
}

/** Скільки рядків ручних ролів (x + e) у документі — для ліміту й лічильника. */
export function rollRowCount(doc: CharacterDoc): number {
  let n = 0;
  for (const it of doc.items) n += (it.x?.length || 0) + (it.e?.length || 0);
  return n;
}

/**
 * Розмір документа в байтах так, як його побачить CHECK у базі: jsonb друкується
 * компактно, але з пробілом після кожної коми й двокрапки — тобто кожен роздільник
 * коштує 2 байти замість 1. Рахуємо UTF-8 компактного JSON + к-сть роздільників
 * поза рядками.
 */
export function docSizeBytes(doc: unknown): number {
  const s = JSON.stringify(doc) ?? '';
  let bytes = new TextEncoder().encode(s).length;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === ',' || ch === ':') bytes++;
  }
  return bytes;
}

// ---------- validateDoc ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * Збирач помилок (перших 30 досить, щоб показати, що не так). Два сорти.
 * «Жорсткі» (add) — зламана форма чи цілісність: чужий JSON, посилання в нікуди;
 * такий документ редактор не відкриє. «Мʼякі» (soft) — ліміти й правила: речей
 * понад 100, рядків ролів понад 400, байти, бюджет атрибутів, довжина й символи
 * назв, величина чисел. Документ цілий — його можна відкрити й виправити, але
 * не зберегти. Мʼякі порушення бувають від звичайної роботи в редакторі
 * (знизили рівень, вставили імʼя з табуляцією), і через них не можна губити чернетку.
 */
class Errs {
  list: string[] = [];
  softList: string[] = [];
  add(msg: string): void {
    if (this.list.length < 30) this.list.push(msg);
  }
  soft(msg: string): void {
    if (this.softList.length < 30) this.softList.push(msg);
  }
}

function checkKeys(o: Obj, allowed: readonly string[], where: string, errs: Errs): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) errs.add(`${where}: зайве поле «${k}»`);
}

function checkRows(v: unknown, where: string, errs: Errs): StatRow[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    errs.add(`${where}: має бути списком рядків`);
    return undefined;
  }
  const out: StatRow[] = [];
  v.forEach((row, i) => {
    if (!isObj(row)) return errs.add(`${where}[${i}]: не обʼєкт`);
    checkKeys(row, ['t', 'v'], `${where}[${i}]`, errs);
    if (typeof row.t !== 'string' || !ADDON_SET.has(row.t)) errs.add(`${where}[${i}]: невідомий код стату «${String(row.t)}»`);
    if (typeof row.v !== 'number' || !Number.isFinite(row.v)) errs.add(`${where}[${i}]: значення має бути числом`);
    else if (row.v !== clampRollValue(row.v))
      errs.soft(`${where}[${i}]: значення має бути в межах ±${MAX_ROLL_VALUE} і не більше ${ROLL_DECIMALS} знаків після коми`);
    out.push({ t: String(row.t), v: Number(row.v) });
  });
  return out;
}

const ITEM_KEYS = ['i', 'cat', 'id', 'p', 'r', 'g', 'x', 'xr', 'e', 'w', 'c'];

function checkItem(raw: unknown, idx: number, errs: Errs): ItemInst | null {
  const where = `items[${idx}]`;
  if (!isObj(raw)) {
    errs.add(`${where}: не обʼєкт`);
    return null;
  }
  checkKeys(raw, ITEM_KEYS, where, errs);
  if (typeof raw.i !== 'string' || !IID_RE.test(raw.i)) errs.add(`${where}: невалідний iid «${String(raw.i)}»`);
  if (typeof raw.cat !== 'string' || !isDocCat(raw.cat)) errs.add(`${where}: невідома категорія «${String(raw.cat)}»`);
  if (!isInt(raw.id, 1, MAX_ID)) errs.add(`${where}: id має бути цілим числом`);
  if (raw.p !== undefined && !isInt(raw.p, 0, MAX_ID)) errs.add(`${where}: p має бути цілим числом`);
  if (raw.r !== undefined && !isInt(raw.r, 0, 12)) errs.add(`${where}: заточка має бути 0..12`);
  const cat = typeof raw.cat === 'string' ? raw.cat : '';
  if (raw.g !== undefined) {
    if (!Array.isArray(raw.g) || raw.g.some((x) => !isInt(x, 0, MAX_ID))) errs.add(`${where}: гнізда мають бути списком id каменів`);
    else if (raw.g.length > maxSockets(cat)) errs.add(`${where}: у ${cat} лише ${maxSockets(cat)} гнізд`);
  }
  const x = checkRows(raw.x, `${where}.x`, errs);
  const e = checkRows(raw.e, `${where}.e`, errs);
  if (raw.xr !== undefined && typeof raw.xr !== 'boolean') errs.add(`${where}: xr має бути true/false`);
  if (raw.xr === true && !(x && x.length)) errs.add(`${where}: xr без рядків x — річ без статів`);
  for (const k of ['w', 'c'] as const) {
    if (raw[k] === undefined) continue;
    if (!isInt(raw[k], 0, MAX_ID)) errs.add(`${where}: ${k} має бути цілим числом`);
    else if (cat !== 'ta') errs.add(`${where}: ${k === 'w' ? 'шліфовка' : 'кристал'} лише у зброї`);
  }
  return raw as unknown as ItemInst;
}

function checkSlots(
  raw: unknown,
  where: string,
  byIid: Map<string, ItemInst>,
  allowPkIc: boolean,
  errs: Errs,
): void {
  if (!isObj(raw)) return errs.add(`${where}: має бути обʼєктом слот → iid`);
  const seen = new Set<string>();
  for (const [slot, iid] of Object.entries(raw)) {
    if (!isSlotKey(slot)) {
      errs.add(`${where}: невідомий слот «${slot}»`);
      continue;
    }
    if (!allowPkIc && !isSetSlotKey(slot)) {
      errs.add(`${where}: слот ${slot} буває лише в Головному`);
      continue;
    }
    if (typeof iid !== 'string') {
      errs.add(`${where}.${slot}: iid має бути рядком`);
      continue;
    }
    const inst = byIid.get(iid);
    if (!inst) {
      errs.add(`${where}.${slot}: речі «${iid}» нема в пулі`);
      continue;
    }
    if (inst.cat !== SLOT_CAT[slot]) errs.add(`${where}.${slot}: річ «${iid}» категорії ${inst.cat} не лізе у слот ${slot}`);
    if (seen.has(iid)) errs.add(`${where}: річ «${iid}» надіта двічі`);
    seen.add(iid);
  }
}

const DOC_KEYS = ['v', 'name', 'cls', 'gender', 'level', 'attrs', 'titles', 'path', 'nextIid', 'items', 'main', 'sets', 'buffs', 'sheet'];
const SET_KEYS = ['id', 'name', 'kind', 'slots'];

export type ValidateResult =
  | { ok: true; doc: CharacterDoc }
  | {
      ok: false;
      errors: string[];
      /** Є лише мʼякі порушення (ліміти й правила, див. Errs): документ цілий,
       * редактор може його відкрити й дати виправити, але зберегти не можна. */
      recoverable?: CharacterDoc;
    };

/**
 * Перевірка форми, цілісності, лімітів і правил. Приймає вже розібраний JSON
 * або рядок (тоді розбирає сам — зламаний JSON стає звичайною помилкою, а не винятком).
 */
export function validateDoc(raw: unknown): ValidateResult {
  const errs = new Errs();
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, errors: ['зламаний JSON'] };
    }
  }
  if (!isObj(data)) return { ok: false, errors: ['документ має бути обʼєктом'] };
  checkKeys(data, DOC_KEYS, 'документ', errs);
  if (data.v !== 2) errs.add(`непідтримувана версія документа: ${String(data.v)}`);
  if (typeof data.name !== 'string') errs.add('імʼя має бути рядком');
  else {
    if (data.name.length > DOC_LIMITS.nameLen) errs.soft(`імʼя довше за ${DOC_LIMITS.nameLen} символи`);
    if (badText(data.name)) errs.soft('імʼя містить недопустимі символи');
  }
  if (typeof data.cls !== 'string' || !isClsKey(data.cls)) errs.add(`невідомий клас «${String(data.cls)}»`);
  if (data.gender !== 'm' && data.gender !== 'f') errs.add('стать має бути m або f');
  if (!isInt(data.level, 1, MAX_LEVEL)) errs.add(`рівень має бути 1..${MAX_LEVEL}`);
  if (!isObj(data.attrs)) errs.add('attrs має бути обʼєктом');
  else {
    checkKeys(data.attrs, ['str', 'dex', 'vit', 'mag'], 'attrs', errs);
    const attrs = data.attrs;
    let attrsOk = true;
    for (const k of ['str', 'dex', 'vit', 'mag']) {
      if (!isInt(attrs[k], 0, MAX_ATTR)) {
        errs.add(`attrs.${k} має бути цілим 0..${MAX_ATTR}`);
        attrsOk = false;
      } else if ((attrs[k] as number) < ATTR_BASE) errs.soft(`attrs.${k}: у грі атрибут не буває нижче ${ATTR_BASE}`);
    }
    // Бюджет — як у грі: 5 очок за рівень. Інакше ядро рахувало б HP і атаку
    // персонажа, якого не буває, а з ними й бали.
    if (attrsOk && isInt(data.level, 1, MAX_LEVEL)) {
      const left = attrPointsLeft(data.level, attrs as unknown as CharacterDoc['attrs']);
      if (left < 0) errs.soft(`атрибутів роздано на ${-left} очок більше, ніж дає ${data.level}-й рівень`);
    }
  }
  if (data.titles !== undefined) {
    if (!isObj(data.titles)) errs.add('titles має бути обʼєктом');
    else
      for (const [k, v] of Object.entries(data.titles)) {
        if (!TITLE_SET.has(k)) errs.add(`titles: невідоме поле «${k}»`);
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) errs.add(`titles.${k}: має бути невідʼємним числом`);
      }
  }
  if (data.path !== undefined && data.path !== null && data.path !== 'rs' && data.path !== 'je') errs.add('path має бути rs, je або null');
  if (!isInt(data.nextIid, 0, MAX_ID)) errs.add('nextIid має бути цілим числом');

  // Пул речей.
  const byIid = new Map<string, ItemInst>();
  const items: ItemInst[] = [];
  if (!Array.isArray(data.items)) errs.add('items має бути списком');
  else {
    if (data.items.length > DOC_LIMITS.items) errs.soft(`речей більше за ліміт ${DOC_LIMITS.items}`);
    data.items.forEach((raw, i) => {
      const inst = checkItem(raw, i, errs);
      if (!inst) return;
      if (typeof inst.i === 'string') {
        if (byIid.has(inst.i)) errs.add(`items[${i}]: iid «${inst.i}» повторюється`);
        else byIid.set(inst.i, inst);
      }
      items.push(inst);
    });
    const rows = items.reduce((n, it) => n + (Array.isArray(it.x) ? it.x.length : 0) + (Array.isArray(it.e) ? it.e.length : 0), 0);
    if (rows > DOC_LIMITS.rollRows) errs.soft(`рядків ролів більше за ліміт ${DOC_LIMITS.rollRows}`);
  }

  // Конфігурації.
  checkSlots(data.main, 'main', byIid, true, errs);
  if (!Array.isArray(data.sets)) errs.add('sets має бути списком');
  else {
    if (data.sets.length > DOC_LIMITS.sets) errs.soft(`сетів більше за ліміт ${DOC_LIMITS.sets}`);
    const ids = new Set<string>();
    data.sets.forEach((s, i) => {
      const where = `sets[${i}]`;
      if (!isObj(s)) return errs.add(`${where}: не обʼєкт`);
      checkKeys(s, SET_KEYS, where, errs);
      if (typeof s.id !== 'string' || !SET_ID_RE.test(s.id)) errs.add(`${where}: невалідний id сету`);
      else if (ids.has(s.id)) errs.add(`${where}: id сету повторюється`);
      else ids.add(s.id);
      if (typeof s.name !== 'string') errs.add(`${where}: назва сету має бути рядком`);
      else {
        if (!s.name.length || s.name.length > DOC_LIMITS.setNameLen) errs.soft(`${where}: назва сету — 1..${DOC_LIMITS.setNameLen} символи`);
        if (badText(s.name)) errs.soft(`${where}: назва сету містить недопустимі символи`);
      }
      if (typeof s.kind !== 'string' || !isSetKind(s.kind)) errs.add(`${where}: невідомий вид сету «${String(s.kind)}»`);
      checkSlots(s.slots, `${where}.slots`, byIid, false, errs);
    });
  }

  // Бафи — лише перегляд, але форму тримаємо строгою, щоб чужий JSON не проліз у базу.
  if (data.buffs !== undefined) {
    if (!isObj(data.buffs)) errs.add('buffs має бути обʼєктом');
    else {
      checkKeys(data.buffs, ['cfg', 'extra'], 'buffs', errs);
      if (!isObj(data.buffs.cfg)) errs.add('buffs.cfg має бути обʼєктом');
      else
        for (const [k, c] of Object.entries(data.buffs.cfg)) {
          if (!/^\d{1,9}$/.test(k)) errs.add(`buffs.cfg: ключ «${k}» — не id бафа`);
          if (!isObj(c)) {
            errs.add(`buffs.cfg.${k}: не обʼєкт`);
            continue;
          }
          checkKeys(c, ['on', 'lvl', 'side'], `buffs.cfg.${k}`, errs);
          if (typeof c.on !== 'boolean') errs.add(`buffs.cfg.${k}.on має бути true/false`);
          if (!isInt(c.lvl, 1, MAX_BUFF_LVL)) errs.add(`buffs.cfg.${k}.lvl має бути 1..${MAX_BUFF_LVL}`);
          if (c.side !== '' && c.side !== 'rs' && c.side !== 'je') errs.add(`buffs.cfg.${k}.side має бути '', rs або je`);
        }
      if (!Array.isArray(data.buffs.extra) || data.buffs.extra.some((x) => !isInt(x, 0, MAX_ID))) errs.add('buffs.extra має бути списком id');
    }
  }

  if (data.sheet !== undefined) for (const e of sheetErrors(data.sheet)) errs.add(e);

  if (errs.list.length) return { ok: false, errors: [...errs.list, ...errs.softList].slice(0, 30) };
  const bytes = docSizeBytes(data);
  if (bytes > DOC_LIMITS.bytes) errs.soft(`документ завеликий: ${bytes} Б при ліміті ${DOC_LIMITS.bytes}`);
  if (errs.softList.length) return { ok: false, errors: errs.softList, recoverable: data as unknown as CharacterDoc };
  return { ok: true, doc: data as unknown as CharacterDoc };
}
