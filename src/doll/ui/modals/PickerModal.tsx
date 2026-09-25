// =========================================================
// ЛЯЛЬКА — пікер речі / каменя / руни / кристала. Порт PickerModal Хелпера на
// документ персонажа: вибір із каталогу додає НОВИЙ екземпляр у пул і надіває
// його (стара річ лишається в інвентарі, а не затирається); зверху — секція
// «З інвентаря» з речами цієї категорії, які вже є в персонажа. Пікер каменя
// й руни/кристала відкривається з редактора речі і сам повертає редактор
// (вікно в редакторі одне) — з новим iid, якщо правка з вкладки сету зробила
// копію.
//
// Список довгий (до ~2600 мечів), тож рендеряться лише видимі рядки:
// просте вікно за scrollTop без бібліотек. Тултіп — з наведення/фокусу, а на
// тачі — кнопкою «i» в рядку (закріплений), бо двотаповий гейт Хелпера
// плутав «подивитись» і «обрати».
// =========================================================

import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject,
} from 'react';
import { CLASS_BY_SM, SLOTS, defaultSockets, lbl } from '../../core/constants';
import { classRestriction, computeStats, gemDop, meetsReq } from '../../core/stats';
import type { DollState, Item, TipCtx } from '../../core/types';
import { iconStyle } from '../../data/assets';
import { catItems, isStaleDataError, useCatalog } from '../../data/catalog';
import { DOC_LIMITS, SLOT_CAT, isSetSlotKey, type Cat, type ItemInst, type SlotKey } from '../../model/doc';
import { CFG_MAIN, effectiveSlots, findSet, inventoryOf, ownSlots, toDollState, whereWorn, type HydratedInst } from '../../model/hydrate';
import { LIMIT_TEXT, equip, findInst, normalizeInst, pickFromCatalog, unequip, updateInstance, type InstPatch } from '../../model/ops';
import { filterPickerItems, pickerTypeIrs } from '../../model/pickerFilter';
import { propLine } from '../../model/tipModel';
import { useEditor, type PickerTarget } from '../EditorContext';
import { instTipContent, itemTipContent } from '../tip/ItemTip';
import { ItemName } from '../tip/ItemName';
import { isCoarsePointer, useTip, type TipContent } from '../tip/useTip';
import { ModalShell } from './ModalShell';

type Sort = '' | 'lvl-asc' | 'lvl-desc';
type Kind = 'slot' | 'gem' | 'wdf' | 'crystal';

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

/** Ключові стати речі одним рядком — щоб у списку бачити, що це за річ, не наводячи тултіп.
 * Для каменя з відомою річчю-господарем — лише те, що він дасть саме в неї (зброя чи ні). */
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
  return out.slice(0, 3).join(' · ');
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

/** Вікно рядків за scrollTop контейнера: рендеримо лише видимі + запас. */
function useWindowing(listRef: RefObject<HTMLDivElement | null>, count: number, rowH: number, resetKey: string, overscan = 8) {
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
  }, [listRef]);
  // Зміна фільтра — до початку списку, інакше вікно лишається на старому зсуві.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = 0;
    setScrollTop(0);
  }, [listRef, resetKey]);
  const onScroll = () => {
    const el = listRef.current;
    if (el) setScrollTop(el.scrollTop);
  };
  const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + height) / rowH) + overscan);
  return { start, end, padTop: start * rowH, padBottom: Math.max(0, (count - end) * rowH), onScroll };
}

/** Стрілки між рядками (і з пошуку в перший рядок) — список можна пройти без миші. */
function focusRow(from: HTMLElement | null, dir: 1 | -1, root: HTMLElement | null): void {
  if (!root) return;
  const rows = Array.from(root.querySelectorAll<HTMLElement>('.doll-pick-row'));
  if (!rows.length) return;
  const i = from ? rows.indexOf(from) : -1;
  const next = i < 0 ? (dir > 0 ? rows[0] : null) : rows[i + dir];
  if (next) next.focus();
  else if (dir < 0) root.querySelector<HTMLElement>('.doll-pick-search')?.focus();
}

/** Рядок списку: клік/Enter — обрати; наведення/фокус — тултіп; «i» — закріпити тултіп (тач). */
function PickRow({
  icon, name, req, bad, stats, tags, rowH, content, onPick, disabled, root,
}: {
  icon: CSSProperties;
  name: ReactNode;
  req: string;
  bad?: boolean;
  stats: string;
  tags?: ReactNode;
  rowH: number;
  content: () => TipContent;
  onPick: () => void;
  disabled?: boolean;
  root: RefObject<HTMLElement | null>;
}) {
  const tip = useTip();
  const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusRow(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1, root.current);
    }
  };
  return (
    <div
      className={'doll-pick-row' + (bad ? ' is-bad' : '') + (disabled ? ' is-disabled' : '')}
      style={{ height: rowH }}
      role="button"
      tabIndex={0}
      aria-disabled={disabled || undefined}
      onClick={onPick}
      onKeyDown={onKey}
      onMouseEnter={(e) => tip.show(e.currentTarget, content())}
      onMouseLeave={tip.hide}
      onFocus={(e) => tip.show(e.currentTarget, content())}
      onBlur={tip.hide}
    >
      <span className="doll-m-cell">
        <span className="doll-m-icon" style={icon} />
      </span>
      <span className="doll-pick-main">
        <span className="doll-pick-name">
          {name}
          {tags}
        </span>
        <span className="doll-pick-meta">
          {req && <span className={'doll-pick-req' + (bad ? ' bad' : '')}>{req}</span>}
          {req && stats ? ' — ' : ''}
          {stats}
        </span>
      </span>
      <button
        type="button"
        className="doll-pick-info"
        tabIndex={-1}
        aria-label="Про річ"
        onClick={(e) => {
          e.stopPropagation();
          const row = e.currentTarget.parentElement;
          if (row) tip.toggle(row, content());
        }}
      >
        i
      </button>
    </div>
  );
}

export function PickerModal({ target }: { target: PickerTarget }) {
  const api = useEditor();
  const tip = useTip();
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
  const coarse = isCoarsePointer();
  const rowH = coarse ? 54 : 48;

  const { ready, error, retry } = useCatalog([cat]);
  const items = ready ? catItems(cat) : null;
  const build: DollState = useMemo(() => toDollState(model, cfgId), [model, cfgId]);
  const gearAttr = useMemo(() => computeStats(build).gearAttr, [build]);

  const [q, setQ] = useState('');
  const [fit, setFit] = useState(kind === 'slot');
  const [sort, setSort] = useState<Sort>('');
  const [types, setTypes] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [notice, setNotice] = useState<string | null>(null);

  const typeIrs = useMemo(() => (kind === 'slot' && items ? pickerTypeIrs(items) : []), [items, kind]);
  const typesKey = [...types].sort().join(',');
  const { rows, total } = useMemo(() => {
    if (!items) return { rows: [] as Item[], total: 0 };
    const gemHost = kind === 'gem' && hostItem ? { item: hostItem, cat: hostCat } : null;
    return filterPickerItems(items, q, { cls: doc.cls, level: doc.level, onlyFit: fit, build, gearAttr, types, gemHost, sort, limit: 100000 });
    // typesKey представляє types у залежностях (Set порівнюється за посиланням)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, q, fit, sort, typesKey, doc.cls, doc.level, build, gearAttr, kind, hostItem, hostCat]);

  // Поточне: для слота — власна річ конфігурації («Зняти» лише для неї), для позначки
  // «надіто» — ефективна (у сеті може бути з Головного); для гнізда/руни — стан речі.
  const curOwnIid = slot ? ownSlots(doc, cfgId)[slot] : undefined;
  const curEffIid = slot ? effectiveSlots(model, cfgId)[slot] : undefined;
  const curEff = curEffIid ? model.items.get(curEffIid) : undefined;
  const curGem = kind === 'gem' && host ? (host.gems[socket] ?? null) : null;
  const curSpecial = kind === 'wdf' ? (host?.wdf ?? null) : kind === 'crystal' ? (host?.crystal ?? null) : null;
  const hasCurrent = kind === 'slot' ? !!curOwnIid : kind === 'gem' ? !!curGem : !!curSpecial;
  const curId = kind === 'slot' ? curEff?.inst.id : kind === 'gem' ? Number(curGem?.id) : Number(curSpecial?.id);

  const title =
    kind === 'slot' ? (SLOTS.find((s) => s.slot === slot)?.label ?? 'Річ')
    : kind === 'gem' ? 'Камінь — гніздо ' + (socket + 1)
    : kind === 'wdf' ? 'Шліфовка (руна)'
    : 'Кристал';

  // Інвентар цієї категорії (не надіте в цій конфігурації) — зверху, щоб не шукати в каталозі те, що вже є.
  const inv = useMemo(
    () => (kind === 'slot' ? inventoryOf(model, cfgId).map((iid) => model.items.get(iid)).filter((h): h is HydratedInst => !!h && h.inst.cat === cat) : []),
    [model, cfgId, kind, cat],
  );
  const cfgLabel = (id: string): string => (id === CFG_MAIN ? 'Г' : (findSet(doc, id)?.name ?? '?'));

  const close = () => {
    tip.hideAll();
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
  const pickCatalog = (it: Item) => {
    tip.hideAll();
    if (readOnly) return;
    const id = Number(it.id);
    if (kind === 'slot' && slot) {
      const p = Number((it as Record<string, unknown>).pw_id) || undefined;
      const out: { blocked?: string; kept: string | null } = { kept: null };
      api.apply((d) => {
        const r = pickFromCatalog(d, cfgId, slot, cat as Cat, id, { p });
        out.blocked = r.blocked;
        out.kept = r.kept;
        return r.doc;
      });
      if (out.blocked) {
        setNotice('Ліміт речей: ' + DOC_LIMITS.items + '. Видали щось з інвентаря, щоб додати нову.');
        return;
      }
      // Попередня річ мала правки чи надіта ще десь — вона не зникла, а лежить в інвентарі.
      if (out.kept) api.notify('Попередня річ цього слота лежить в інвентарі: у ній були правки або вона надіта ще десь.');
      api.closeModal();
      return;
    }
    if (!host) return;
    if (kind === 'gem') patchHost({ g: withSocket(host.inst.g, socket, id, host.inst.cat) });
    else if (kind === 'wdf') patchHost({ w: id });
    else patchHost({ c: id });
  };
  const pickInventory = (h: HydratedInst) => {
    tip.hideAll();
    if (readOnly || !slot) return;
    api.apply((d) => equip(d, cfgId, slot, h.inst.i));
    api.closeModal();
  };
  const removeCurrent = () => {
    tip.hideAll();
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

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const win = useWindowing(listRef, rows.length, rowH, q + '|' + fit + '|' + sort + '|' + typesKey + '|' + cat);
  const intoWeapon = hostCat === 'ta';
  const gemCtx: TipCtx = { isWeapon: intoWeapon };

  const catalogRow = (it: Item) => {
    const bad = kind === 'slot' && !meetsReq(build, it, gearAttr).ok;
    const worn = curId != null && Number(it.id) === curId;
    return (
      <PickRow
        key={String(it.id)}
        root={bodyRef}
        rowH={rowH}
        icon={iconStyle(it, cat, doc.gender)}
        name={<ItemName item={it} cat={cat} />}
        tags={worn ? <span className="doll-pick-tag">надіто</span> : null}
        req={kind === 'slot' ? reqText(it) : ''}
        stats={keyStats(it, cat, kind === 'gem' && host ? intoWeapon : undefined)}
        bad={bad}
        content={() => itemTipContent(it, cat, kind === 'slot' ? build : null, kind === 'gem' ? gemCtx : {})}
        onPick={() => pickCatalog(it)}
        disabled={readOnly}
      />
    );
  };

  const removeLabel = kind === 'gem' ? 'Прибрати камінь' : kind === 'slot' ? 'Зняти в інвентар' : 'Прибрати';

  return (
    <ModalShell
      title={title}
      onClose={close}
      size="md"
      className="doll-modal-picker"
      headExtra={
        hasCurrent && !readOnly ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={removeCurrent}>
            {removeLabel}
          </button>
        ) : null
      }
    >
      <div className="doll-pick-body" ref={bodyRef}>
        <input
          type="search"
          className="doll-pick-search"
          placeholder={kind === 'slot' ? 'назва або «101 назва» (треб. рівень)' : 'назва…'}
          autoComplete="off"
          // На тачі без автофокусу: клавіатура інакше одразу закриває пів списку.
          autoFocus={!coarse}
          data-autofocus={coarse ? undefined : ''}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown') return;
            e.preventDefault();
            focusRow(null, 1, bodyRef.current);
          }}
          aria-label="Пошук"
        />
        {kind === 'slot' && (
          <div className="doll-pick-ctl">
            <label className="doll-pick-fit">
              <input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} /> лише придатні мені
            </label>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Сортування">
              <option value="">як у каталозі</option>
              <option value="lvl-asc">рівень ↑</option>
              <option value="lvl-desc">рівень ↓</option>
            </select>
          </div>
        )}
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
        {notice && (
          <div className="doll-m-notice" role="alert">
            {notice}
          </div>
        )}
        {readOnly && <div className="doll-mute">Лише перегляд — змінити нічого не можна.</div>}
        {inv.length > 0 && (
          <div className="doll-pick-inv">
            <div className="doll-pick-inv-h">З інвентаря · {inv.length}</div>
            <div className="doll-pick-inv-list">
              {inv.map((h) => {
                const it = h.item;
                const where = whereWorn(doc, h.inst.i).map((w) => cfgLabel(w.cfgId));
                return (
                  <PickRow
                    key={h.inst.i}
                    root={bodyRef}
                    rowH={rowH}
                    icon={it ? iconStyle(it, cat, doc.gender) : {}}
                    name={it ? <ItemName item={it} cat={cat} refine={h.inst.r} /> : 'Невідома річ #' + h.inst.id}
                    tags={where.map((w, i) => (
                      <span className="doll-pick-tag where" key={i}>
                        {w}
                      </span>
                    ))}
                    req={it ? reqText(it) : ''}
                    stats={it ? keyStats(it, cat) : ''}
                    bad={!!it && !meetsReq(build, it, gearAttr).ok}
                    content={() => instTipContent(h, build)}
                    onPick={() => pickInventory(h)}
                    disabled={readOnly}
                  />
                );
              })}
            </div>
          </div>
        )}
        <div className="doll-pick-count" aria-live="polite">
          {error ? '' : !ready ? 'Завантажую каталог…' : 'Знайдено: ' + total.toLocaleString('uk')}
        </div>
        <div className="doll-pick-list" ref={listRef} onScroll={win.onScroll}>
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
              <div style={{ height: win.padTop }} />
              {rows.slice(win.start, win.end).map(catalogRow)}
              <div style={{ height: win.padBottom }} />
            </>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

export default PickerModal;
