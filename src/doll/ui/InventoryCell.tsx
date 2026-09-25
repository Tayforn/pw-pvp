// =========================================================
// ЛЯЛЬКА — річ в інвентарі. Клік = надіти в активну конфігурацію (для кілець —
// у вільну руку), олівець = редактор, ПКМ = меню «Надіти / Редагувати / Копія /
// Видалити». На тачі тап = закріплений тултіп: опис речі й ті самі дії
// кнопками — щоб перед «Надіти» було видно стати, а не лише назву.
// Позначки: «Г» — надіта в Головному, номер — у якому сеті (колір — вид сету).
// Червона рамка — річ не проходить вимоги персонажа.
// =========================================================

import { useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type { DollState } from '../core/types';
import { iconStyle } from '../data/assets';
import type { SetKind } from '../model/doc';
import { CFG_MAIN, type HydratedInst } from '../model/hydrate';
import { LIMIT_TEXT, defaultSlotFor, deleteInstance, duplicateInstance, equipAuto } from '../model/ops';
import CellMenu, { COARSE_PTR, pointRect, type MenuItem } from './CellMenu';
import { useEditor } from './EditorContext';
import { type DnD } from './hooks/useDnD';
import { CellBadges, instGrade, instName, isKeyboardFocus } from './SlotCell';
import { instTipContent } from './tip/ItemTip';
import { useTip, type TipAction } from './tip/useTip';

/** Сет для позначок в інвентарі: номер вкладки (1–5), назва, вид. */
export interface SetMark {
  n: number;
  name: string;
  kind: SetKind;
}

interface Props {
  h: HydratedInst;
  /** Де річ надіта (whereWorn) — для позначок. */
  worn: Array<{ cfgId: string; slot: string }>;
  /** id сету → номер, назва й вид (позначка «де надіто»). */
  sets: ReadonlyMap<string, SetMark>;
  bad: boolean;
  dnd: DnD;
  build: DollState;
}

const MAX_MARKS = 3;

export default function InventoryCell({ h, worn, sets, bad, dnd, build }: Props) {
  const api = useEditor();
  const tip = useTip();
  const { activeCfg: cfgId, readOnly } = api;
  const gender = api.doc.gender;
  const [menuAt, setMenuAt] = useState<DOMRect | null>(null);
  // Тип останнього натискання: довгий тап на Android шле contextmenu — меню тоді не потрібне.
  const lastPointer = useRef('');
  const iid = h.inst.i;
  const name = instName(h);

  const content = () => instTipContent(h, build);

  // Джинн і політ у сет не лізуть — «Надіти» на вкладці сету для них недоступне.
  const canWear = defaultSlotFor(api.doc, cfgId, h.inst) !== null;
  const wearHint = 'Джинн і політ — лише в Головному';

  const wear = () => api.apply((d) => equipAuto(d, cfgId, iid));
  const edit = () => api.openItemEditor(cfgId, iid);
  const copy = () =>
    api.apply((d) => {
      const r = duplicateInstance(d, iid);
      if (r.blocked) api.notify(LIMIT_TEXT[r.blocked]);
      return r.doc;
    });
  const del = () => {
    const where = worn.length ? ' Вона надіта: її буде знято звідусіль.' : '';
    if (window.confirm('Видалити «' + name + '»?' + where)) api.apply((d) => deleteInstance(d, iid));
  };

  const actions: Array<MenuItem & TipAction> = [
    { label: 'Надіти', onClick: wear, disabled: !canWear, hint: wearHint },
    { label: 'Редагувати', onClick: edit },
    { label: 'Копія', onClick: copy },
    { label: 'Видалити', onClick: del, danger: true },
  ];

  const openMenu = (rect: DOMRect) => {
    tip.hideAll();
    setMenuAt(rect);
  };
  const primary = (el: HTMLElement) => {
    if (readOnly) {
      tip.toggle(el, content());
      return;
    }
    if (COARSE_PTR) {
      tip.toggle(el, { ...content(), actions });
      return;
    }
    if (canWear) wear();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // Enter/пробіл на олівці всередині клітинки — це його клік, а не «надіти».
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    primary(e.currentTarget);
  };

  const marks: Array<{ key: string; text: string; cls: string; title: string }> = [];
  const wornNames: string[] = [];
  for (const w of worn) {
    if (w.cfgId === CFG_MAIN) {
      marks.push({ key: 'main', text: 'Г', cls: 'is-main', title: 'Надіта в Головному' });
      wornNames.push('Головний');
    } else {
      const s = sets.get(w.cfgId);
      const nm = s?.name || '?';
      marks.push({ key: w.cfgId, text: s ? String(s.n) : '?', cls: 'is-set doll-kind-' + (s?.kind ?? 'pz'), title: 'Надіта в сеті «' + nm + '»' });
      wornNames.push(nm);
    }
  }

  const cls = 'doll-inv-cell' + (bad ? ' is-bad' : '') + (worn.length ? ' is-worn' : '') + (!canWear && !readOnly ? ' is-nowear' : '');
  const drag = dnd.dragProps({ from: 'inv', iid, cat: h.inst.cat });

  return (
    <>
      <div
        className={cls}
        role="button"
        tabIndex={0}
        aria-label={name + (wornNames.length ? ' (надіта: ' + wornNames.join(', ') + ')' : '')}
        title={COARSE_PTR ? undefined : readOnly ? undefined : canWear ? 'Клік — надіти' : wearHint}
        {...drag}
        onClick={(e: MouseEvent<HTMLElement>) => primary(e.currentTarget)}
        onKeyDown={onKeyDown}
        onPointerDown={(e: PointerEvent<HTMLElement>) => {
          lastPointer.current = e.pointerType;
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (readOnly || lastPointer.current === 'touch') return;
          openMenu(pointRect(e.clientX, e.clientY));
        }}
        onMouseEnter={(e) => {
          if (!COARSE_PTR && !dnd.isDragging()) tip.show(e.currentTarget, content());
        }}
        onMouseLeave={() => tip.hide()}
        onFocus={(e: FocusEvent<HTMLElement>) => {
          // Лише фокус із клавіатури: після закриття вікна мишею фокус повертається
          // сюди програмно — тултіп тоді «залипав» би без курсора поруч.
          if (!COARSE_PTR && e.target === e.currentTarget && isKeyboardFocus(e.currentTarget)) tip.show(e.currentTarget, content());
        }}
        onBlur={() => tip.hide()}
      >
        <span className="doll-cell">
          {h.item ? (
            <span className="doll-icon" style={iconStyle(h.item, h.inst.cat, gender)} />
          ) : (
            <span className="doll-cell-unknown" aria-hidden="true">?</span>
          )}
          <CellBadges h={h} />
        </span>
        {marks.length > 0 && (
          <span className="doll-inv-marks" aria-hidden="true">
            {marks.slice(0, MAX_MARKS).map((m) => (
              <b key={m.key} className={m.cls} title={m.title}>{m.text}</b>
            ))}
            {marks.length > MAX_MARKS && <b className="is-set">+{marks.length - MAX_MARKS}</b>}
          </span>
        )}
        {!readOnly && (
          <button
            type="button"
            className="doll-inv-edit"
            aria-label={'Редагувати ' + name}
            title="Редагувати"
            onClick={(e) => {
              e.stopPropagation();
              tip.hideAll();
              edit();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseEnter={(e) => e.stopPropagation()}
          >
            ✎
          </button>
        )}
      </div>
      {menuAt && <CellMenu anchor={menuAt} title={name} grade={instGrade(h)} items={actions} onClose={() => setMenuAt(null)} />}
    </>
  );
}
