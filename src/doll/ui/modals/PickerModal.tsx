// =========================================================
// ЛЯЛЬКА — вибір речі / каменя / руни / кристала (варіант B, макет
// B-Picker-2): вікно xl з двома панелями (ModalShell + doll-modal-split, як у
// джина). Зверху смуга: пошук, «лише придатні мені», порядок, чіпи типів,
// «Знайдено: N». Ліворуч — один список із секціями «З інвентаря» (речі цієї
// категорії, які в персонажа вже є) і «Каталог»; рядок — іконка, назва
// кольором грейду, короткий підпис «рів. · атака/захист · ПА/ПЗ · головні
// стати», бейджі «надіто» / де надіто / «варіант N з M». Однойменні речі НЕ
// злипаються (аудит: дедуплікація ховала десятки зброй, збірників, кілець) —
// варіанти нумерує pickerVariants, різниця видна в підписі. Праворуч — картка
// обраної речі з тултіп-моделі (model/tipModel.ts: ті самі рядки, що в
// підказці, лише розкладені сіткою), блок «Одразу налаштувати» (заточка −/+,
// камені в гнізда, «поставити цей камінь в усі гнізда», роли — редактором
// одразу після «Надіти») і «Проти надітого» (model/pickCompare.ts). Низ
// картки — кнопка «Надіти» і підказка клавіш. Спливних підказок над списком
// немає: усе, що показувала підказка, — у картці.
//
// Клік по рядку лише відкриває річ у картці; надіває кнопка, Enter / пробіл
// або подвійний клік. Клавіатура в списку: один рядок із tabIndex 0
// (поточний), стрілки ↑/↓, PageUp/PageDown, Home/End, ↓ з пошуку — у список,
// Enter у пошуку — надіти поточне (перший збіг). Список довгий (до ~2600
// мечів), тож рендеряться лише видимі рядки каталогу (вікно за scrollTop);
// секція «З інвентаря» коротка і рендериться вся. Вибір з каталогу додає
// НОВИЙ екземпляр у пул і надіває його (стара річ лишається в інвентарі, якщо
// в ній були правки або вона надіта ще десь). Пікер каменя й руни/кристала
// відкривається з редактора речі і сам повертає редактор (вікно одне) — з
// новим iid, якщо правка з вкладки сету зробила копію.
// =========================================================

import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react';
import { CLASS_BY_SM, SLOTS, defaultSockets, lbl } from '../../core/constants';
import { classRestriction, computeStats, gemDop, meetsReq, refineBonuses } from '../../core/stats';
import type { DollState, Item, TipCtx } from '../../core/types';
import { iconStyle } from '../../data/assets';
import { catItems, pickableItems, getItem, isStaleDataError, useCatalog } from '../../data/catalog';
import { DOC_LIMITS, SLOT_CAT, isSetSlotKey, type Cat, type ItemInst, type SlotKey } from '../../model/doc';
import { gemOk } from '../../model/gemOk';
import { CFG_MAIN, effectiveSlots, findSet, instStats, inventoryOf, ownSlots, toDollState, whereWorn, type HydratedInst } from '../../model/hydrate';
import { LIMIT_TEXT, equip, findInst, normalizeInst, pickFromCatalog, unequip, updateInstance, type InstPatch, type LimitReason } from '../../model/ops';
import { buildWith, compareBuilds, deltaText, type PickCandidate } from '../../model/pickCompare';
import { filterPickerItems, pickerTypeIrs, pickerVariants, variantText, type PickerVariant } from '../../model/pickerFilter';
import { buildTipModel, codeLabel, itemDisplayName, propLine, type TipLine, type TipModel } from '../../model/tipModel';
import { useEditor, type ItemTab, type PickerTarget } from '../EditorContext';
import { instTipCtx, lineClass } from '../tip/ItemTip';
import { GradeName, ItemName } from '../tip/ItemName';
import { isCoarsePointer } from '../tip/useTip';
import { ModalShell } from './ModalShell';

type Sort = '' | 'lvl-asc' | 'lvl-desc';
type Kind = 'slot' | 'gem' | 'wdf' | 'crystal';

/** Висота заголовка секції списку (px) — та сама, що в CSS .doll-pk-sec; вікно рядків рахує по ній. */
const HEAD_H = 24;
const OVERSCAN = 8;
const MAX_REFINE = 12;

const fmt = (v: unknown): string => Number(v).toLocaleString('uk');

/** Гнізда з новим каменем у позиції socket (0 = порожньо); довжина = к-сть гнізд категорії. */
export function withSocket(g: number[] | undefined, socket: number, gemId: number, cat: string): number[] {
  const n = defaultSockets(cat);
  const out = Array.from({ length: n }, (_, i) => (g && g[i]) || 0);
  if (socket >= 0 && socket < n) out[socket] = gemId;
  return out;
}

/** Правка нічого не змінює (те саме число, та сама заточка, той самий камінь)?
 * Така «правка» не має плодити копію спільної речі. */
export function isNoopPatch(src: ItemInst, patch: InstPatch): boolean {
  return JSON.stringify(normalizeInst({ ...src, ...patch, i: src.i })) === JSON.stringify(normalizeInst(src));
}

// Короткі підписи кодів для рядка списку (повні — codeLabel, у картці).
const SHORT_LABEL: Record<string, string> = {
  ad: 'ПА', sx: 'ПЗ', om: 'Сила', uy: 'Спр.', lf: 'Тіло', tx: 'Інт', ed: 'Крит', hp: 'HP', mp: 'Мана',
  ae: 'Мітк.', qe: 'Ухил', cl: 'Швидк.', ci: 'Спів', xn: 'Пауза', mr: 'Дух', mk: 'Сила духу',
  ld: 'Фіз. атака', xq: 'Маг. атака', wf: 'Ф.зах', ab_gq: 'М.зах',
};
/** «+40», «−10%» — лише значення зі знаком, як його пише propLine. */
function signedVal(code: string, val: unknown): string {
  return propLine(code, val).slice(codeLabel(code).length + 1);
}

/** Ключові стати речі одним рядком — щоб у списку бачити, що це за річ, не відкриваючи картку:
 * атака/захист, далі ПА/ПЗ, далі головні допи (повторений код — усі значення поряд: «ПА +40 +25»,
 * так однойменні варіанти відрізняються прямо в рядку). Для каменя з відомою річчю-господарем —
 * лише те, що він дасть саме в неї (зброя чи ні). */
export function keyStats(it: Item, cat: string, gemIntoWeapon?: boolean): string {
  const o = it as Record<string, unknown>;
  const out: string[] = [];
  if (cat === 'ob') {
    if (gemIntoWeapon !== undefined) {
      const d = gemDop(it, gemIntoWeapon);
      return d ? propLine(d[0], d[1]) : '';
    }
    const dops = Array.isArray(o.obDops) ? (o.obDops as unknown[]) : [];
    for (const d of dops) {
      if (!Array.isArray(d) || out.length >= 2) continue;
      const s = propLine(String(d[0]), d[1]);
      if (!out.includes(s)) out.push(s);
    }
    return out.join(' · ');
  }
  if (cat === 'wdf' || cat === 'crystal') {
    const wu = (o.nw as { wu?: Array<{ type?: string; val?: unknown }> } | undefined)?.wu || [];
    for (const w of wu) if (w && w.type && out.length < 3) out.push(propLine(w.type, w.val));
    return out.join(' · ');
  }
  const range = (v: unknown, label: string) => {
    if (Array.isArray(v)) out.push(label + ' ' + fmt(v[0]) + '–' + fmt(v[1]));
    else if (typeof v === 'number' && v) out.push(label + ' +' + fmt(v));
  };
  range(it.ld, 'Фіз.');
  range(it.xq, 'Маг.');
  if (typeof it.wf === 'number' && it.wf) out.push('Ф.зах +' + fmt(it.wf));
  const ab = it.ab_gq;
  if (typeof ab === 'number' && ab) out.push('М.зах +' + fmt(ab));
  else if (ab && typeof ab === 'object') {
    const vals = Object.values(ab as Record<string, unknown>).map(Number).filter((n) => Number.isFinite(n));
    if (vals.length) {
      const mn = Math.min(...vals);
      const mx = Math.max(...vals);
      out.push('Стих. +' + (mn === mx ? fmt(mn) : fmt(mn) + '–' + fmt(mx)));
    }
  }
  if (typeof it.hp === 'number' && it.hp) out.push('HP +' + fmt(it.hp));
  if (typeof it.qe === 'number' && it.qe) out.push('Ухил +' + fmt(it.qe));
  if (typeof it.sy === 'number' && it.sy) out.push(it.sy + ' атк/с');
  const base = out.slice(0, 2);
  // Допи nw.wu, згруповані за кодом: спершу ПА/ПЗ, потім решта в порядку каталогу (до двох).
  const wu = (o.nw as { wu?: Array<{ type?: string; val?: unknown }> } | undefined)?.wu || [];
  const groups = new Map<string, string[]>();
  for (const w of wu) {
    if (!w || !w.type) continue;
    const g = groups.get(w.type);
    if (g) g.push(signedVal(w.type, w.val));
    else groups.set(w.type, [signedVal(w.type, w.val)]);
  }
  const line = (code: string) => (SHORT_LABEL[code] ?? codeLabel(code)) + ' ' + (groups.get(code) || []).join(' ');
  const rest: string[] = [];
  for (const code of ['ad', 'sx']) if (groups.has(code)) rest.push(line(code));
  let others = 0;
  for (const code of groups.keys()) {
    if (code === 'ad' || code === 'sx' || others >= 2) continue;
    rest.push(line(code));
    others++;
  }
  return [...base, ...rest].join(' · ');
}

/** Рядок вимог під назвою: рівень + класи (червоним, коли не вдягається). */
export function reqText(it: Item): string {
  const parts: string[] = [];
  const oj = Number(it.oj) || 0;
  if (oj) parts.push('ур. ' + oj);
  else if (Number(it.hf)) parts.push('рівень ' + it.hf);
  const cr = classRestriction(it);
  if (cr) parts.push(cr.map((n) => CLASS_BY_SM[n] || String(n)).join(', '));
  return parts.join(' · ');
}

/** «рів. 101» для рядка списку (вимога oj; без неї — рівень предмета hf). */
function lvlText(it: Item): string {
  const oj = Number(it.oj) || 0;
  if (oj) return 'рів. ' + oj;
  const hf = Number(it.hf) || 0;
  return hf ? 'рівень ' + hf : '';
}

/** Підпис типу з каталогу (pg → словник labels); без підпису в словнику — порожньо. */
function typeText(it: Item): string {
  if (it.pg == null || it.pg === '') return '';
  const t = lbl('pg', it.pg as string | number);
  return t === String(it.pg) ? '' : t;
}

/** Рядок списку: клік — у картку; подвійний клік — обрати. Один рядок із tabIndex 0 (поточний). */
function PickRow({
  rowKey, icon, name, meta, bad, tags, rowH, isCur, disabled, register, onSelect, onPick,
}: {
  rowKey: string;
  icon: CSSProperties;
  name: ReactNode;
  meta: ReactNode;
  bad?: boolean;
  tags?: ReactNode;
  rowH: number;
  isCur: boolean;
  disabled?: boolean;
  register(key: string, el: HTMLButtonElement | null): void;
  onSelect(): void;
  onPick(): void;
}) {
  return (
    <button
      type="button"
      className={'doll-pk-row' + (isCur ? ' is-cur' : '') + (bad ? ' is-bad' : '')}
      style={{ height: rowH }}
      tabIndex={isCur ? 0 : -1}
      aria-current={isCur ? 'true' : undefined}
      aria-disabled={disabled || undefined}
      ref={(el) => register(rowKey, el)}
      onClick={onSelect}
      onDoubleClick={onPick}
    >
      <span className="doll-m-cell">
        <span className="doll-m-icon" style={icon} />
      </span>
      <span className="doll-pk-main">
        <span className="doll-pk-name">{name}</span>
        <span className="doll-pk-meta">{meta}</span>
      </span>
      {tags}
    </button>
  );
}

/** Рядки тултіп-моделі в картці: базові стати й вимоги — сіткою у дві колонки, допи — теж,
 * решта (абілка, заточка, камені, руна, гравіювання, комплект) — рядками з кольорами підказки.
 * Рівень і тип — у підзаголовку картки, тут не повторюються. */
function CardLines({ model }: { model: TipModel }) {
  const lines = model.lines.filter((l, i) => l.kind !== 'title' && !(l.kind === 'type' && i <= 1) && !(l.kind === 'base' && /^Рівень \d/.test(l.text)));
  const out: ReactNode[] = [];
  let grid: TipLine[] = [];
  let gridKind = '';
  const flush = () => {
    if (!grid.length) return;
    out.push(
      <div className="doll-pk-grid" key={'g' + out.length}>
        {grid.map((l, i) => {
          const at = l.text.indexOf(': ');
          const k = at > 0 ? l.text.slice(0, at) : '';
          const v = at > 0 ? l.text.slice(at + 2) : l.text;
          return (
            <div className={'doll-pk-cell ' + lineClass(l) + (k ? '' : ' whole')} key={i}>
              {k && <span className="doll-pk-cell-k">{k}</span>}
              <span className="doll-pk-cell-v">{v}</span>
            </div>
          );
        })}
      </div>,
    );
    grid = [];
    gridKind = '';
  };
  for (const l of lines) {
    const gk = l.kind === 'base' || l.kind === 'req' ? 'stat' : l.kind === 'add' ? 'add' : '';
    if (gk) {
      if (gridKind && gridKind !== gk) flush();
      gridKind = gk;
      grid.push(l);
      continue;
    }
    flush();
    out.push(l.kind === 'sep' ? <div className="doll-tip-sep" key={out.length} /> : <div className={'doll-pk-line ' + lineClass(l)} key={out.length}>{l.text}</div>);
  }
  flush();
  return <>{out}</>;
}

export function PickerModal({ target }: { target: PickerTarget }) {
  const api = useEditor();
  const { doc, model, readOnly } = api;
  const kind: Kind = 'kind' in target ? target.kind : 'slot';
  const slot: SlotKey | null = 'kind' in target ? null : target.slot;
  // Джинн і політ живуть лише в Головному (сети беруть їх звідти) — туди їх і надіваємо.
  const cfgId = slot && target.cfgId !== CFG_MAIN && !isSetSlotKey(slot) ? CFG_MAIN : target.cfgId;
  const hostIid = 'kind' in target ? target.iid : null;
  const socket = 'kind' in target && target.kind === 'gem' ? target.socket : -1;
  const cat: string = slot ? SLOT_CAT[slot] : kind === 'gem' ? 'ob' : kind;
  const host = hostIid ? model.items.get(hostIid) : undefined;
  const hostItem = host?.item ?? null;
  const hostCat = host?.inst.cat ?? '';
  const intoWeapon = hostCat === 'ta';
  const coarse = isCoarsePointer();
  const rowH = coarse ? 54 : 48;
  const sockets = kind === 'slot' ? defaultSockets(cat) : 0;
  const isGenieSlot = cat === 'pk';

  const { ready, error, retry } = useCatalog([cat]);
  // Камені для блоку «Одразу налаштувати» — окремо: їхня помилка не має ховати список речей.
  const ob = useCatalog(sockets > 0 ? ['ob'] : []);
  const items = ready ? pickableItems(cat) : null;
  const gemsAll: Item[] | null = sockets > 0 && ob.ready ? catItems('ob') : null;
  const build: DollState = useMemo(() => toDollState(model, cfgId), [model, cfgId]);
  const gearAttr = useMemo(() => computeStats(build).gearAttr, [build]);

  // Поточне: для слота — власна річ конфігурації («Зняти» лише для неї), для позначки
  // «надіто» — ефективна (у сеті може бути з Головного); для гнізда/руни — стан речі.
  const curOwnIid = slot ? ownSlots(doc, cfgId)[slot] : undefined;
  const curEffIid = slot ? effectiveSlots(model, cfgId)[slot] : undefined;
  const curEff = curEffIid ? model.items.get(curEffIid) : undefined;
  const curGem = kind === 'gem' && host ? (host.gems[socket] ?? null) : null;
  const curSpecial = kind === 'wdf' ? (host?.wdf ?? null) : kind === 'crystal' ? (host?.crystal ?? null) : null;
  const hasCurrent = kind === 'slot' ? !!curOwnIid : kind === 'gem' ? !!curGem : !!curSpecial;
  const curId: number | undefined = kind === 'slot' ? curEff?.inst.id : kind === 'gem' ? (curGem ? Number(curGem.id) : undefined) : curSpecial ? Number(curSpecial.id) : undefined;

  const [q, setQ] = useState('');
  const [fit, setFit] = useState(kind === 'slot');
  const [sort, setSort] = useState<Sort>(kind === 'slot' ? 'lvl-desc' : '');
  const [types, setTypes] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [notice, setNotice] = useState<string | null>(null);
  // Обрана річ: 'inv:' + iid або 'cat:' + id. Спершу — те, що надіто (картка показує його).
  const [cur, setCur] = useState<string | null>(() => (curId != null ? 'cat:' + curId : null));
  // «Одразу налаштувати» для речі з каталогу: заточка й камені; живе, поки відкрите вікно,
  // щоб порівнювати кілька речей з однією заточкою.
  const [setup, setSetup] = useState<{ r: number; g: number[] }>({ r: 0, g: [] });

  const typeIrs = useMemo(() => (kind === 'slot' && items ? pickerTypeIrs(items) : []), [items, kind]);
  const variants = useMemo(() => (kind === 'slot' && items ? pickerVariants(items) : new Map<number, PickerVariant>()), [items, kind]);
  const typesKey = [...types].sort().join(',');
  const { rows, total } = useMemo(() => {
    if (!items) return { rows: [] as Item[], total: 0 };
    const gemHost = kind === 'gem' && hostItem ? { item: hostItem, cat: hostCat } : null;
    return filterPickerItems(items, q, { cls: doc.cls, level: doc.level, onlyFit: fit, build, gearAttr, types, gemHost, sort, limit: 100000 });
    // typesKey представляє types у залежностях (Set порівнюється за посиланням)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, q, fit, sort, typesKey, doc.cls, doc.level, build, gearAttr, kind, hostItem, hostCat]);
  const rowById = useMemo(() => new Map(rows.map((it) => [Number(it.id), it])), [rows]);

  // Інвентар цієї категорії (не надіте в цій конфігурації) — зверху, щоб не шукати в каталозі те, що вже є.
  const inv = useMemo(
    () => (kind === 'slot' ? inventoryOf(model, cfgId).map((iid) => model.items.get(iid)).filter((h): h is HydratedInst => !!h && h.inst.cat === cat) : []),
    [model, cfgId, kind, cat],
  );
  const cfgLabel = (id: string): string => (id === CFG_MAIN ? 'Г' : (findSet(doc, id)?.name ?? '?'));

  // Один наскрізний порядок рядків для клавіатури: інвентар, потім каталог.
  const seq = useMemo(() => [...inv.map((h) => 'inv:' + h.inst.i), ...rows.map((it) => 'cat:' + it.id)], [inv, rows]);
  const index = useMemo(() => new Map(seq.map((k, i) => [k, i])), [seq]);
  // Поточний рядок: обраний, якщо він у списку (фільтр міг його сховати), інакше перший.
  const curKey = cur != null && index.has(cur) ? cur : (seq[0] ?? null);
  const selInv = curKey?.startsWith('inv:') ? model.items.get(curKey.slice(4)) : undefined;
  const selCat = curKey?.startsWith('cat:') ? rowById.get(Number(curKey.slice(4))) : undefined;

  const title =
    kind === 'slot' ? (SLOTS.find((s) => s.slot === slot)?.label ?? 'Річ')
    : kind === 'gem' ? 'Камінь — гніздо ' + (socket + 1)
    : kind === 'wdf' ? 'Шліфовка (руна)'
    : 'Кристал';

  // ---------- список-вікно ----------
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowEls = useRef(new Map<string, HTMLButtonElement>());
  const focusKey = useRef<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(420);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight || 420);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  // Зміна фільтра — до початку списку, інакше вікно лишається на старому зсуві.
  const resetKey = q + '|' + fit + '|' + sort + '|' + typesKey;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = 0;
    setScrollTop(0);
  }, [resetKey]);
  // Зсув секції «Каталог» у списку: заголовок інвентаря + його рядки + заголовок каталогу.
  const catTop = (inv.length ? HEAD_H + inv.length * rowH : 0) + HEAD_H;
  const rowTop = (i: number): number => (i < inv.length ? HEAD_H + i * rowH : catTop + (i - inv.length) * rowH);
  const winStart = Math.max(0, Math.floor((scrollTop - catTop) / rowH) - OVERSCAN);
  const winEnd = Math.max(0, Math.min(rows.length, Math.ceil((scrollTop + height - catTop) / rowH) + OVERSCAN));
  // Відкрилось — список прокручено до надітої речі (вона обрана), а не до першого рядка.
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current || !ready) return;
    const el = listRef.current;
    if (!el) return;
    scrolledRef.current = true;
    const i = cur != null ? index.get(cur) : undefined;
    if (i == null) return;
    el.scrollTop = Math.max(0, rowTop(i) - Math.floor((el.clientHeight - rowH) / 2));
    setScrollTop(el.scrollTop);
    // rowTop залежить лише від inv/rowH/catTop — вони в index уже враховані
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, index, cur]);
  // Фокус на рядок, який щойно став видимим (стрілки за межі вікна рядків).
  useEffect(() => {
    const k = focusKey.current;
    if (!k) return;
    const el = rowEls.current.get(k);
    if (el) {
      el.focus({ preventScroll: true });
      focusKey.current = null;
    }
  });
  const register = (key: string, el: HTMLButtonElement | null) => {
    if (el) rowEls.current.set(key, el);
    else rowEls.current.delete(key);
  };
  const goTo = (i: number) => {
    const k = seq[i];
    if (!k) return;
    setCur(k);
    const el = listRef.current;
    if (el) {
      const top = rowTop(i);
      if (top < el.scrollTop + HEAD_H) el.scrollTop = Math.max(0, top - HEAD_H);
      else if (top + rowH > el.scrollTop + el.clientHeight) el.scrollTop = top + rowH - el.clientHeight;
      setScrollTop(el.scrollTop);
    }
    const row = rowEls.current.get(k);
    if (row) row.focus({ preventScroll: true });
    else focusKey.current = k;
  };

  // ---------- дії ----------
  const close = () => {
    if (hostIid) api.openItemEditor(cfgId, hostIid);
    else api.closeModal();
  };
  /** Правка речі-господаря (камінь/руна/кристал): з вкладки сету може стати копією — редактор відкриваємо на ній. */
  const patchHost = (patch: InstPatch) => {
    if (!hostIid) return;
    const src = findInst(doc, hostIid);
    // Той самий камінь/руна, що й був, — не правка: без копії спільної речі.
    if (!src || isNoopPatch(src, patch)) {
      api.openItemEditor(cfgId, hostIid);
      return;
    }
    const r = updateInstance(doc, cfgId, hostIid, patch);
    if (r.blocked) {
      setNotice(
        r.blocked === 'items' && whereWorn(doc, hostIid).some((w) => w.cfgId !== cfgId)
          ? 'Ліміт речей: ' + DOC_LIMITS.items + '. Для копії в сет треба звільнити місце — видали щось з інвентаря.'
          : LIMIT_TEXT[r.blocked],
      );
      return;
    }
    if (r.doc !== doc) api.apply(() => r.doc);
    api.openItemEditor(cfgId, r.iid);
  };
  /** Камені з блоку налаштування, які справді лізуть у цю річ (рівень, generic) — решта гнізд порожні. */
  const setupGemIds = (it: Item): number[] =>
    Array.from({ length: sockets }, (_, i) => {
      const id = setup.g[i] || 0;
      const g = id ? getItem('ob', id) : undefined;
      return g && gemOk(g, cat, it) ? id : 0;
    });
  /** Річ із каталогу в слот (+ заточка й камені з блоку налаштування); tab — одразу відкрити редактор на вкладці. */
  const pickCatalog = (it: Item, tab?: ItemTab) => {
    if (readOnly) return;
    const id = Number(it.id);
    if (kind === 'slot' && slot) {
      const p = Number((it as Record<string, unknown>).pw_id) || undefined;
      const out: { blocked?: LimitReason; kept: string | null; iid: string | null } = { kept: null, iid: null };
      api.apply((d) => {
        const r = pickFromCatalog(d, cfgId, slot, cat as Cat, id, { p });
        out.blocked = r.blocked;
        out.kept = r.kept;
        out.iid = r.iid;
        return r.doc;
      });
      if (out.blocked) {
        setNotice('Ліміт речей: ' + DOC_LIMITS.items + '. Видали щось з інвентаря, щоб додати нову.');
        return;
      }
      const iid = out.iid;
      const patch: InstPatch = {};
      if (!isGenieSlot && setup.r > 0) patch.r = setup.r;
      const g = sockets > 0 ? setupGemIds(it) : [];
      if (g.some((x) => x > 0)) patch.g = g;
      // Нова річ надіта лише тут — правка на місці, без копії; ліміт речей уже пройдено.
      if (iid && Object.keys(patch).length) api.apply((d) => updateInstance(d, cfgId, iid, patch).doc);
      // Попередня річ мала правки чи надіта ще десь — вона не зникла, а лежить в інвентарі.
      if (out.kept) api.notify('Попередня річ цього слота лежить в інвентарі: у ній були правки або вона надіта ще десь.');
      if (tab && iid) api.openItemEditor(cfgId, iid, tab);
      else api.closeModal();
      return;
    }
    if (!host) return;
    if (kind === 'gem') patchHost({ g: withSocket(host.inst.g, socket, id, host.inst.cat) });
    else if (kind === 'wdf') patchHost({ w: id });
    else patchHost({ c: id });
  };
  const pickInventory = (h: HydratedInst) => {
    if (readOnly || !slot) return;
    api.apply((d) => equip(d, cfgId, slot, h.inst.i));
    api.closeModal();
  };
  const pickCurrent = () => {
    // Те саме, що кнопка «Надіти»: річ без запису в каталозі не надіваємо й з клавіатури.
    if (!selItem) return;
    if (selInv) pickInventory(selInv);
    else if (selCat) {
      // Уже надіта річ без налаштувань — нічого не міняти (інакше вона стала б новою копією +0).
      const sameAsWorn = kind === 'slot' && curId != null && Number(selCat.id) === curId && setup.r === 0 && !setup.g.some((x) => x > 0);
      if (sameAsWorn) close();
      else pickCatalog(selCat);
    }
  };
  const removeCurrent = () => {
    if (readOnly) return;
    if (kind === 'slot' && slot) {
      api.apply((d) => unequip(d, cfgId, slot));
      api.closeModal();
      return;
    }
    if (!host) return;
    if (kind === 'gem') patchHost({ g: withSocket(host.inst.g, socket, 0, host.inst.cat) });
    else if (kind === 'wdf') patchHost({ w: 0 });
    else patchHost({ c: 0 });
  };

  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!seq.length) return;
    const i = curKey != null ? (index.get(curKey) ?? -1) : -1;
    let j: number;
    switch (e.key) {
      case 'ArrowDown':
        j = Math.min(seq.length - 1, i + 1);
        break;
      case 'ArrowUp':
        j = Math.max(0, i - 1);
        break;
      case 'PageDown':
        j = Math.min(seq.length - 1, i + 10);
        break;
      case 'PageUp':
        j = Math.max(0, i - 10);
        break;
      case 'Home':
        j = 0;
        break;
      case 'End':
        j = seq.length - 1;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        pickCurrent();
        return;
      default:
        return;
    }
    e.preventDefault();
    goTo(j);
  };

  // ---------- картка ----------
  const gemCtx: TipCtx = { isWeapon: intoWeapon };
  const selItem: Item | null = selInv ? selInv.item : (selCat ?? null);
  const selCatOk = !!selCat && (kind !== 'slot' || meetsReq(build, selCat, gearAttr).ok);
  const tipModel: TipModel | null = useMemo(() => {
    if (selInv) return selInv.item ? buildTipModel(selInv.item, selInv.inst.cat, instTipCtx(selInv), build) : null;
    if (!selCat) return null;
    if (kind !== 'slot') return buildTipModel(selCat, cat, kind === 'gem' ? gemCtx : {}, null);
    // Річ із каталогу — з тією заточкою й каменями, що виставлені в блоці налаштування.
    const gems = sockets > 0 ? setupGemIds(selCat).map((id) => (id ? (getItem('ob', id) ?? null) : null)) : undefined;
    return buildTipModel(selCat, cat, { refine: isGenieSlot ? 0 : setup.r, gems, isBook: cat === 'qn', isWeapon: cat === 'ta' }, build);
    // setupGemIds і gemCtx — похідні від setup/sockets/intoWeapon, які в залежностях є
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selInv, selCat, kind, cat, build, setup, sockets, intoWeapon, isGenieSlot]);

  /** Кандидат для «Проти надітого»: річ з інвентаря — як є; з каталогу — з налаштуванням;
   * камінь/руна/кристал — річ-господар із підставленим каменем (лише коли вона надіта тут). */
  const cmp = useMemo(() => {
    if (!selItem) return null;
    let into: string | null = null;
    let cand: PickCandidate | null = null;
    if (kind === 'slot' && slot) {
      into = slot;
      if (selInv) cand = { item: selItem, refine: selInv.inst.r, gems: selInv.gems, addons: instStats(selInv), engrave: (selInv.inst.e || []).map((r) => ({ type: r.t, val: r.v })), wdf: selInv.wdf, crystal: selInv.crystal };
      else cand = { item: selItem, refine: isGenieSlot ? 0 : setup.r, gems: sockets > 0 ? setupGemIds(selItem).map((id) => (id ? (getItem('ob', id) ?? null) : null)) : [] };
    } else if (host && hostItem) {
      const worn = Object.entries(effectiveSlots(model, cfgId)).find(([, iid]) => iid === hostIid);
      if (!worn) return null;
      into = worn[0];
      const gems = [...host.gems];
      if (kind === 'gem') gems[socket] = selItem;
      cand = {
        item: hostItem, refine: host.inst.r, gems, addons: instStats(host), engrave: (host.inst.e || []).map((r) => ({ type: r.t, val: r.v })),
        wdf: kind === 'wdf' ? selItem : host.wdf, crystal: kind === 'crystal' ? selItem : host.crystal,
      };
    }
    if (!into || !cand) return null;
    return compareBuilds(build, buildWith(build, into, cand));
    // setupGemIds — похідна від setup/sockets, які в залежностях є
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selItem, selInv, kind, slot, host, hostItem, hostIid, model, cfgId, socket, build, setup, sockets, isGenieSlot]);

  const actLabel = kind === 'slot' ? 'Надіти' : kind === 'gem' ? 'Вставити' : 'Обрати';
  const removeLabel = kind === 'gem' ? 'Прибрати камінь' : kind === 'slot' ? 'Зняти в інвентар' : 'Прибрати';
  const subText = (it: Item): string => {
    if (kind === 'gem') return ['Камінь', Number(it.hf) ? 'рівень ' + it.hf : ''].filter(Boolean).join(' · ');
    if (kind !== 'slot') return [kind === 'wdf' ? 'Шліфовка' : 'Кристал', Number(it.hf) ? 'рівень ' + it.hf : ''].filter(Boolean).join(' · ');
    return [typeText(it), reqText(it)].filter(Boolean).join(' · ');
  };
  const gemIds = Array.from({ length: sockets }, (_, i) => setup.g[i] || 0);
  const firstGem = gemIds.find((g) => g > 0) || 0;
  const canFillAll = sockets > 1 && firstGem > 0 && gemIds.some((g) => g !== firstGem);
  const gemOptions = useMemo(() => (gemsAll && selCat && kind === 'slot' ? gemsAll.filter((g) => gemOk(g, cat, selCat)) : []), [gemsAll, selCat, kind, cat]);
  // Елементи <option> один раз на список: скрол списку перемальовує вікно, а сотні опцій у гніздах — ні.
  const gemOptionEls = useMemo(
    () =>
      gemOptions.map((g) => {
        const dop = gemDop(g, cat === 'ta');
        return (
          <option key={String(g.id)} value={Number(g.id)}>
            {itemDisplayName(g, 'ob') + (dop ? ' — ' + propLine(dop[0], dop[1]) : '')}
          </option>
        );
      }),
    [gemOptions, cat],
  );
  const refinePreview = selCat && !isGenieSlot && setup.r > 0 ? refineBonuses(selCat, setup.r, cat === 'qn').map((b) => propLine(b.type, b.val)).join(', ') : '';

  const catalogRow = (it: Item) => {
    const bad = kind === 'slot' && !meetsReq(build, it, gearAttr).ok;
    const worn = curId != null && Number(it.id) === curId;
    const v = variants.get(Number(it.id));
    const key = 'cat:' + it.id;
    const lvl = kind === 'slot' ? lvlText(it) : Number(it.hf) ? 'рівень ' + it.hf : '';
    const stats = keyStats(it, cat, kind === 'gem' && host ? intoWeapon : undefined);
    return (
      <PickRow
        key={key}
        rowKey={key}
        register={register}
        rowH={rowH}
        isCur={key === curKey}
        icon={iconStyle(it, cat, doc.gender)}
        name={<ItemName item={it} cat={cat} />}
        meta={
          <>
            {lvl && <span className={bad ? 'bad' : ''}>{lvl}</span>}
            {lvl && stats ? ' · ' : ''}
            {stats}
          </>
        }
        tags={
          <>
            {worn && <span className="doll-pick-tag">надіто</span>}
            {v && <span className="doll-pick-tag where">{variantText(v)}</span>}
          </>
        }
        bad={bad}
        disabled={readOnly}
        onSelect={() => setCur(key)}
        onPick={() => pickCatalog(it)}
      />
    );
  };
  const inventoryRow = (h: HydratedInst) => {
    const it = h.item;
    const key = 'inv:' + h.inst.i;
    const where = whereWorn(doc, h.inst.i).map((w) => cfgLabel(w.cfgId));
    const v = it ? variants.get(Number(it.id)) : undefined;
    const bad = !!it && !meetsReq(build, it, gearAttr).ok;
    const lvl = it ? lvlText(it) : '';
    const stats = it ? keyStats(it, cat) : '';
    return (
      <PickRow
        key={key}
        rowKey={key}
        register={register}
        rowH={rowH}
        isCur={key === curKey}
        icon={it ? iconStyle(it, cat, doc.gender) : {}}
        name={it ? <ItemName item={it} cat={cat} refine={h.inst.r} /> : 'Невідома річ #' + h.inst.id}
        meta={
          <>
            {lvl && <span className={bad ? 'bad' : ''}>{lvl}</span>}
            {lvl && stats ? ' · ' : ''}
            {stats}
          </>
        }
        tags={
          <>
            {where.map((w, i) => (
              <span className="doll-pick-tag where" key={i}>
                {w}
              </span>
            ))}
            {v && <span className="doll-pick-tag where">{variantText(v)}</span>}
          </>
        }
        bad={bad}
        disabled={readOnly}
        onSelect={() => setCur(key)}
        onPick={() => pickInventory(h)}
      />
    );
  };

  const headExtra =
    hasCurrent && !readOnly ? (
      <button type="button" className="btn btn-ghost btn-sm" onClick={removeCurrent}>
        {removeLabel}
      </button>
    ) : null;

  return (
    <ModalShell title={title} onClose={close} size="xl" className="doll-modal-split" headExtra={headExtra}>
      <div className="doll-pk-bar">
        <div className="doll-pk-bar-row">
          <label className="doll-pk-q">
            <span>Пошук</span>
            <input
              type="search"
              className="doll-pk-search"
              placeholder={kind === 'slot' ? 'назва або «101 назва» (треб. рівень)' : 'назва…'}
              autoComplete="off"
              // На тачі без автофокусу: клавіатура інакше одразу закриває пів списку.
              autoFocus={!coarse}
              data-autofocus={coarse ? undefined : ''}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  goTo(curKey != null ? (index.get(curKey) ?? 0) : 0);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  pickCurrent();
                }
              }}
              aria-label="Пошук"
            />
          </label>
          {kind === 'slot' && (
            <>
              <label className="doll-pk-fit">
                <input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} /> лише придатні мені
              </label>
              <label className="doll-pk-order">
                <span>Порядок</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Порядок">
                  <option value="lvl-desc">спершу вищий рівень</option>
                  <option value="lvl-asc">спершу нижчий рівень</option>
                  <option value="">як у каталозі</option>
                </select>
              </label>
            </>
          )}
        </div>
        <div className="doll-pk-bar-row">
          {typeIrs.length > 1 && (
            <div className="doll-pick-types" role="group" aria-label="Тип">
              {typeIrs.map((ir) => (
                <label key={ir} className={types.has(ir) ? 'on' : ''}>
                  <input
                    type="checkbox"
                    checked={types.has(ir)}
                    onChange={(e) => {
                      const s = new Set(types);
                      if (e.target.checked) s.add(ir);
                      else s.delete(ir);
                      setTypes(s);
                    }}
                  />
                  {lbl('lbls', ir)}
                </label>
              ))}
            </div>
          )}
          <span className="doll-pk-count" aria-live="polite">
            {error ? '' : !ready ? 'Завантажую каталог…' : 'Знайдено: ' + total.toLocaleString('uk')}
          </span>
        </div>
        {readOnly && <div className="doll-mute doll-pk-ro">Лише перегляд — змінити нічого не можна.</div>}
      </div>
      {notice && (
        <div className="doll-m-notice doll-pk-notice" role="alert">
          {notice}
        </div>
      )}

      <div className="doll-pk-body">
        <div className="doll-pk-list" ref={listRef} role="group" aria-label="Речі" onScroll={() => listRef.current && setScrollTop(listRef.current.scrollTop)} onKeyDown={onListKey}>
          {inv.length > 0 && (
            <>
              <div className="doll-pk-sec" style={{ height: HEAD_H }}>
                З інвентаря · {inv.length}
              </div>
              {inv.map(inventoryRow)}
            </>
          )}
          <div className="doll-pk-sec" style={{ height: HEAD_H }}>
            Каталог
          </div>
          {error ? (
            <div className="doll-m-state">
              {isStaleDataError(error) ? (
                <>
                  <div className="doll-m-bad">Сайт оновився — каталог треба завантажити заново. Чернетка збережена в цьому браузері.</div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => location.reload()}>
                    Перезавантажити
                  </button>
                </>
              ) : (
                <>
                  <div className="doll-m-bad">Не вдалося завантажити каталог: {error}</div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>
                    Повторити
                  </button>
                </>
              )}
            </div>
          ) : !ready ? (
            <div className="doll-m-state doll-mute">Завантажую каталог…</div>
          ) : rows.length === 0 ? (
            <div className="doll-m-state doll-mute">
              Нічого не знайдено.
              {fit && kind === 'slot' ? ' Спробуй зняти галочку «лише придатні мені».' : ''}
            </div>
          ) : (
            <>
              <div style={{ height: winStart * rowH }} />
              {rows.slice(winStart, winEnd).map(catalogRow)}
              <div style={{ height: Math.max(0, (rows.length - winEnd) * rowH) }} />
            </>
          )}
        </div>

        <div className="doll-pk-card">
          {!selItem || !tipModel ? (
            <p className="doll-mute doll-pk-none">{selInv && !selInv.item ? 'У каталозі немає цієї речі (' + selInv.inst.cat + ' #' + selInv.inst.id + ').' : 'Обери річ у списку — тут буде її опис.'}</p>
          ) : (
            <>
              <div className="doll-pk-head">
                <span className={'doll-m-cell doll-pk-hcell gx-' + tipModel.grade}>
                  <span className="doll-m-icon" style={iconStyle(selItem, cat, doc.gender)} />
                </span>
                <div className="doll-pk-head-t">
                  <div className="doll-pk-title">
                    <GradeName name={tipModel.name} grade={tipModel.grade} refine={tipModel.refine} />
                  </div>
                  <div className="doll-pk-sub">
                    {subText(selItem)}
                    {selInv && (whereWorn(doc, selInv.inst.i).length ? ' · надіто: ' + [...new Set(whereWorn(doc, selInv.inst.i).map((w) => cfgLabel(w.cfgId)))].join(', ') : ' · в інвентарі')}
                    {selCat && curId != null && Number(selCat.id) === curId && (kind === 'slot' ? ' · зараз надіто' : ' · зараз у гнізді')}
                  </div>
                </div>
              </div>
              {kind === 'slot' && selCat && !selCatOk && <div className="doll-m-warn">Не вдягається: вимоги не виконано — стати не рахуються.</div>}
              <div className="doll-pk-stats">
                <CardLines model={tipModel} />
              </div>

              {kind === 'slot' && !readOnly && selCat && !isGenieSlot && (
                <div className="doll-pk-setup">
                  <div className="doll-pk-sec-h">Одразу налаштувати</div>
                  <div className="doll-pk-srow">
                    <span className="doll-pk-sl">Заточка</span>
                    <div className="doll-pk-step">
                      <button type="button" aria-label="Менша заточка" disabled={setup.r <= 0} onClick={() => setSetup((s) => ({ ...s, r: Math.max(0, s.r - 1) }))}>
                        −
                      </button>
                      <span className="doll-pk-step-v">+{setup.r}</span>
                      <button type="button" aria-label="Більша заточка" disabled={setup.r >= MAX_REFINE} onClick={() => setSetup((s) => ({ ...s, r: Math.min(MAX_REFINE, s.r + 1) }))}>
                        +
                      </button>
                    </div>
                    {refinePreview && <span className="doll-pk-good">{refinePreview}</span>}
                  </div>
                  {sockets > 0 && gemsAll && (
                    <div className="doll-pk-srow top">
                      <span className="doll-pk-sl">Камені</span>
                      <div className="doll-pk-gems">
                        <div className="doll-pk-gem-grid">
                          {gemIds.map((gid, i) => (
                            <select key={i} value={gid} aria-label={'Гніздо ' + (i + 1)} onChange={(e) => setSetup((s) => ({ ...s, g: withSocket(s.g, i, Number(e.target.value), cat) }))}>
                              <option value={0}>— порожнє —</option>
                              {gemOptionEls}
                            </select>
                          ))}
                        </div>
                        {canFillAll && (
                          <button type="button" className="doll-ed-link" onClick={() => setSetup((s) => ({ ...s, g: gemIds.map(() => firstGem) }))}>
                            Поставити цей камінь в усі гнізда
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="doll-pk-srow">
                    <span className="doll-pk-sl">Роли</span>
                    <span className="doll-mute doll-pk-grow">як у каталозі</span>
                    <button type="button" className="doll-ed-link" title="Надіти й одразу відкрити характеристики речі" onClick={() => pickCatalog(selCat, 'addons')}>
                      змінити
                    </button>
                  </div>
                </div>
              )}
              {kind === 'slot' && !readOnly && selInv && (
                <div className="doll-pk-setup">
                  <div className="doll-pk-sec-h">Налаштування речі</div>
                  <div className="doll-pk-srow">
                    <span className="doll-pk-sl">Роли</span>
                    <span className="doll-mute doll-pk-grow">{selInv.inst.xr ? 'база замінена' : selInv.inst.x?.length ? 'свої роли · ' + selInv.inst.x.length : 'як у каталозі'}</span>
                    <button type="button" className="doll-ed-link" onClick={() => api.openItemEditor(cfgId, selInv.inst.i)}>
                      редагувати річ
                    </button>
                  </div>
                </div>
              )}

              {cmp && (
                <div className="doll-pk-cmp">
                  <div className="doll-pk-sec-h">{kind === 'slot' ? (curEff ? 'Проти надітого' : 'Якщо надіти') : curId != null ? 'Проти того, що стоїть' : 'Якщо поставити'}</div>
                  {cmp.length === 0 ? (
                    <div className="doll-pk-cmp-row">
                      <span>Ключові стати</span>
                      <b className="doll-mute">без змін</b>
                    </div>
                  ) : (
                    <>
                      {cmp.map((r) => (
                        <div className="doll-pk-cmp-row" key={r.key}>
                          <span>{r.label}</span>
                          <b className={r.good ? 'good' : 'bad'}>{deltaText(r)}</b>
                        </div>
                      ))}
                      <div className="doll-pk-cmp-row">
                        <span>Решта статів</span>
                        <b className="doll-mute">без змін</b>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div className="doll-pk-foot">
          {readOnly ? (
            <button type="button" className="btn btn-primary btn-sm doll-pk-act" onClick={close}>
              Закрити
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-primary btn-sm doll-pk-act" disabled={!selItem} onClick={pickCurrent}>
                {selCat && kind === 'slot' && curId != null && Number(selCat.id) === curId && setup.r === 0 && !setup.g.some((x) => x > 0) ? 'Уже надіто' : actLabel}
              </button>
              <span className="doll-pk-keys">Enter — {actLabel.toLowerCase()}, стрілки — далі</span>
            </>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

export default PickerModal;
