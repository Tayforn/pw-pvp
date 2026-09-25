// =========================================================
// ЛЯЛЬКА — редактор речі. Порт EditorModal Хелпера на екземпляр документа:
// заточка, камені по гніздах (фільтр gemOk — у пікері), руна й кристал для
// зброї, «Характеристики» і «Гравіювання».
//
// Відмінність від Хелпера — база каталогу. Там «Характеристики» були повним
// списком, що заміняв базу; тут база показується замкненою (її дає каталог,
// підробити не можна), а редагуються лише ДОДАНІ роли (x). Якщо стати речі
// на сервері справді інші, «Замінити базу» ставить xr — і тоді рахуються
// лише рядки x (адмін бачить таку річ позначеною).
//
// Речі — один пул: правка з вкладки сету, коли річ надіта ще деінде, робить
// копію (model/ops updateInstance). Редактор після першої такої правки
// переходить на копію сам (локальний iid), не перевідкриваючи вікно — інакше
// поле, в яке саме друкують, втратило б фокус.
// =========================================================

import { useRef, useState, type ReactNode } from 'react';
import { ADDON_OPTIONS, SLOTS, defaultSockets } from '../../core/constants';
import { flattenItemStats, gemDop } from '../../core/stats';
import type { DollState, Item } from '../../core/types';
import { iconStyle } from '../../data/assets';
import { DOC_LIMITS, ROLL_CODES, SLOT_KEYS, rollRowCount, type ItemInst, type SlotKey, type StatRow } from '../../model/doc';
import { CFG_MAIN, findSet, ownSlots, whereWorn, type HydratedInst } from '../../model/hydrate';
import { splitAddons } from '../../model/importCalc';
import { LIMIT_TEXT, deleteInstance, duplicateInstance, equipAuto, findInst, unequip, updateInstance, type InstPatch, type LimitReason } from '../../model/ops';
import { codeLabel, propLine } from '../../model/tipModel';
import { useEditor } from '../EditorContext';
import { instTipContent, itemTipContent } from '../tip/ItemTip';
import { GradeName, ItemName } from '../tip/ItemName';
import { useTip } from '../tip/useTip';
import { ModalShell } from './ModalShell';
import { isNoopPatch, reqText, withSocket } from './PickerModal';

type Tab = 'gems' | 'addons' | 'engrave';

// Підписи кодів із каталогів (nw.wu), яких нема в ADDON_OPTIONS Хелпера: там
// вони не пропонувались, а в pvp річ може їх мати — редактор мусить їх назвати.
const EXTRA_LABEL: Record<string, string> = {
  ab_gq_eg: 'Маг. захист (%)', ae_eg: 'Міткість (%)', cl_eg: 'Швидкість (%)', qe_eg: 'Ухилення (%)', wf_eg: 'Фіз. захист (%)',
  cp: 'Міцність (%)', ct: 'Вимоги по талантах (%)', exp: 'Досвід (%)', fp: 'Дальність', xn: 'Пауза між атаками',
  metal_eq: 'Захист від металу (старий код)',
};
const OPTION_LABEL = new Map(ADDON_OPTIONS.map((o) => [o.code, o.label]));

/** Коди для випадного списку рядка: ADDON_OPTIONS Хелпера + решта кодів каталогів.
 * Аліаси з імпорту (mana, ab_eq…) не пропонуються, але рядок з таким кодом їх показує. */
export const STAT_OPTIONS: Array<{ code: string; label: string }> = [
  ...ADDON_OPTIONS,
  ...ROLL_CODES.filter((c) => !OPTION_LABEL.has(c) && EXTRA_LABEL[c]).map((c) => ({ code: c, label: EXTRA_LABEL[c] })),
];
const STAT_OPTION_SET = new Set(STAT_OPTIONS.map((o) => o.code));
export function statLabel(code: string): string {
  return OPTION_LABEL.get(code) ?? EXTRA_LABEL[code] ?? codeLabel(code);
}

/** Базові стати каталогу у форматі рядків документа. */
export function baseRows(item: Item | null): StatRow[] {
  return item ? flattenItemStats(item).map((r) => ({ t: r.type, v: r.val })) : [];
}

/** «Замінити базу»: ручний список = база + уже додані роли, далі редагується весь. */
export function replaceBasePatch(item: Item | null, inst: ItemInst): InstPatch {
  return { xr: true, x: [...baseRows(item), ...(inst.x || [])] };
}

/** «Повернути базу»: якщо ручний список містить усю базу — лишаємо різницю
 * як додані роли; інакше (базу змінювали) ручні рядки скидаються. */
export function restoreBasePatch(item: Item | null, inst: ItemInst): { patch: InstPatch; lossy: boolean } {
  if (!item) return { patch: { xr: false }, lossy: false };
  const split = splitAddons(item, (inst.x || []).map((r) => ({ type: r.t, val: r.v })));
  if (split.xr) return { patch: { xr: false, x: [] }, lossy: true };
  return { patch: { xr: false, x: split.x || [] }, lossy: false };
}

/** Число з локальним текстом: поки поле у фокусі, показується те, що набрали
 * («-», «1.», порожньо), а в документ іде лише коректне число. */
function NumField({
  value, onCommit, disabled, label, className = 'doll-ed-num', min, max,
}: {
  value: number;
  onCommit(v: number): void;
  disabled?: boolean;
  label: string;
  className?: string;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      type="number"
      step="any"
      inputMode="decimal"
      className={className}
      aria-label={label}
      disabled={disabled}
      min={min}
      max={max}
      value={text ?? String(value)}
      onFocus={() => setText(String(value))}
      onBlur={() => setText(null)}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = Number(t.replace(',', '.'));
        if (t.trim() !== '' && Number.isFinite(n)) onCommit(n);
      }}
    />
  );
}

function StatRowEdit({
  row, onType, onVal, onDel, disabled,
}: {
  row: StatRow;
  onType(t: string): void;
  onVal(v: number): void;
  onDel(): void;
  disabled?: boolean;
}) {
  const label = statLabel(row.t);
  return (
    <div className="doll-ed-row">
      <select value={row.t} onChange={(e) => onType(e.target.value)} disabled={disabled} aria-label="Характеристика">
        {!STAT_OPTION_SET.has(row.t) && <option value={row.t}>{label}</option>}
        {STAT_OPTIONS.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label}
          </option>
        ))}
      </select>
      <NumField value={row.v} onCommit={onVal} disabled={disabled} label={'Значення: ' + label} />
      <button type="button" className="doll-m-x" aria-label={'Прибрати: ' + label} onClick={onDel} disabled={disabled}>
        ✕
      </button>
    </div>
  );
}

const MAIN_ONLY_CATS: ReadonlySet<string> = new Set(['pk', 'ic']);

export function EditorModal({ cfgId: propCfg, iid: propIid }: { cfgId: string; iid: string }) {
  const api = useEditor();
  const tip = useTip();
  const { doc, model, readOnly } = api;

  // Локальний iid: після правки з вкладки сету редактор іде за копією.
  const [cur, setCur] = useState({ key: propCfg + '|' + propIid, iid: propIid });
  if (cur.key !== propCfg + '|' + propIid) setCur({ key: propCfg + '|' + propIid, iid: propIid });
  const iid = cur.key === propCfg + '|' + propIid ? cur.iid : propIid;
  const iidRef = useRef(iid);
  iidRef.current = iid;

  const h: HydratedInst | undefined = model.items.get(iid);
  const inst = h?.inst;
  const item = h?.item ?? null;
  const itemCat = inst?.cat ?? '';
  // Джинн і політ у сетах не лежать — вони спільні з Головним, тож і правляться як у Головному.
  const cfgId = MAIN_ONLY_CATS.has(itemCat) ? CFG_MAIN : propCfg;
  const sockets = defaultSockets(itemCat);
  const isWeapon = itemCat === 'ta';

  const [tab, setTab] = useState<Tab>(() => (defaultSockets(model.items.get(propIid)?.inst.cat ?? '') > 0 ? 'gems' : 'addons'));
  const [notice, setNotice] = useState<string | null>(null);

  const close = () => {
    tip.hideAll();
    api.closeModal();
  };

  if (!h || !inst) {
    return (
      <ModalShell title="Річ" onClose={close} size="sm" foot={<button type="button" className="btn btn-primary btn-sm" onClick={close}>Закрити</button>}>
        <div className="doll-mute">Цієї речі вже немає в персонажа.</div>
      </ModalShell>
    );
  }

  const worn = whereWorn(doc, iid);
  const ownSlot: SlotKey | undefined = SLOT_KEYS.find((s) => ownSlots(doc, cfgId)[s] === iid);
  const cfgName = (id: string): string => (id === CFG_MAIN ? 'Головний' : (findSet(doc, id)?.name ?? 'сет'));
  const elsewhere = cfgId !== CFG_MAIN && worn.some((w) => w.cfgId !== cfgId);
  const inMain = worn.some((w) => w.cfgId === CFG_MAIN);
  const otherSets = [...new Set(worn.filter((w) => w.cfgId !== CFG_MAIN && w.cfgId !== cfgId).map((w) => cfgName(w.cfgId)))];
  const build: DollState = api.buildOf(propCfg);
  const mainOnlyFromSet = propCfg !== CFG_MAIN && MAIN_ONLY_CATS.has(itemCat);

  const limitMsg = 'Ліміт речей: ' + DOC_LIMITS.items + '. Щоб зробити копію для цього сету, видали щось з інвентаря.';

  /** Правка екземпляра від найсвіжішого документа (кілька змін до рендеру не губляться). */
  const edit = (make: (i: ItemInst) => InstPatch | null) => {
    if (readOnly) return;
    let nextIid = iidRef.current;
    // Обʼєкт, а не let: apply кличе функцію синхронно, але TS не бачить присвоєння в замиканні.
    const res: { blocked: LimitReason | null } = { blocked: null };
    api.apply((d) => {
      const src = findInst(d, iidRef.current);
      if (!src) return d;
      const patch = make(src);
      if (!patch) return d;
      if (isNoopPatch(src, patch)) return d;
      const r = updateInstance(d, cfgId, src.i, patch);
      if (r.blocked) {
        res.blocked = r.blocked;
        return d;
      }
      nextIid = r.iid;
      return r.doc;
    });
    const why = res.blocked;
    if (why) setNotice(why === 'items' ? limitMsg : LIMIT_TEXT[why]);
    else if (notice === limitMsg || notice === LIMIT_TEXT.rolls) setNotice(null);
    if (nextIid !== iidRef.current) {
      iidRef.current = nextIid;
      setCur({ key: propCfg + '|' + propIid, iid: nextIid });
    }
  };

  const setRows = (field: 'x' | 'e', fn: (rows: StatRow[]) => StatRow[]) =>
    edit((i) => ({ [field]: fn([...(i[field] || [])]) }) as InstPatch);
  const rollsFull = rollRowCount(doc) >= DOC_LIMITS.rollRows;
  const addRow = (field: 'x' | 'e') => {
    if (rollsFull) {
      setNotice('Ліміт ролів: ' + DOC_LIMITS.rollRows + ' рядків на персонажа.');
      return;
    }
    setRows(field, (rows) => [...rows, { t: STAT_OPTIONS[0].code, v: 0 }]);
  };

  const openGem = (socket: number) => {
    tip.hideAll();
    if (readOnly) return;
    api.openPicker({ kind: 'gem', cfgId, iid, socket });
  };
  const openSpecial = (kind: 'wdf' | 'crystal') => {
    tip.hideAll();
    if (readOnly) return;
    api.openPicker({ kind, cfgId, iid });
  };

  const gemIds = Array.from({ length: sockets }, (_, i) => (inst.g && inst.g[i]) || 0);
  const firstGem = gemIds.find((g) => g > 0) || 0;
  const canFillAll = !readOnly && sockets > 1 && firstGem > 0 && gemIds.some((g) => g !== firstGem);

  const base = baseRows(item);
  const x = inst.x || [];
  const e = inst.e || [];
  const refine = inst.r || 0;

  const rowsEditor = (field: 'x' | 'e', rows: StatRow[], addLabel: string): ReactNode => (
    <>
      <div className="doll-ed-rows">
        {rows.length === 0 && <div className="doll-mute doll-ed-empty">Поки порожньо.</div>}
        {rows.map((r, i) => (
          <StatRowEdit
            key={i}
            row={r}
            disabled={readOnly}
            onType={(t) => setRows(field, (list) => list.map((row, k) => (k === i ? { ...row, t } : row)))}
            onVal={(v) => setRows(field, (list) => list.map((row, k) => (k === i ? { ...row, v } : row)))}
            onDel={() => setRows(field, (list) => list.filter((_, k) => k !== i))}
          />
        ))}
      </div>
      {!readOnly && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => addRow(field)} disabled={rollsFull}>
          {addLabel}
        </button>
      )}
    </>
  );

  const tabs: Array<{ id: Tab; label: string; hidden?: boolean }> = [
    { id: 'gems', label: 'Камені', hidden: sockets === 0 && !isWeapon },
    { id: 'addons', label: 'Характеристики' + (x.length ? ' · ' + x.length : '') },
    { id: 'engrave', label: 'Гравіювання' + (e.length ? ' · ' + e.length : '') },
  ];
  const activeTab: Tab = tab === 'gems' && sockets === 0 && !isWeapon ? 'addons' : tab;

  const foot = readOnly ? (
    <button type="button" className="btn btn-primary btn-sm" onClick={close}>
      Закрити
    </button>
  ) : (
    <>
      {ownSlot ? (
        <>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              api.apply((d) => unequip(d, cfgId, ownSlot));
              close();
            }}
          >
            Зняти в інвентар
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              tip.hideAll();
              api.openPicker({ cfgId, slot: ownSlot });
            }}
          >
            Змінити річ
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            // Джинн і політ спільні для всіх сетів: з вкладки сету «Надіти» міняє
            // їх у Головному — тож питаємо, якщо там уже щось інше.
            if (mainOnlyFromSet) {
              const curMain = doc.main[itemCat as 'pk' | 'ic'];
              if (curMain && curMain !== iid && !window.confirm('Замінити ' + (itemCat === 'pk' ? 'джинна' : 'політ') + ' Головного? Він спільний для всіх сетів.')) return;
            }
            let moved = false;
            api.apply((d) => {
              const next = equipAuto(d, cfgId, iid);
              moved = next !== d;
              return next;
            });
            if (moved) close();
            else setNotice('Цю річ не можна надіти сюди.');
          }}
        >
          {mainOnlyFromSet ? 'Надіти в Головний' : 'Надіти'}
        </button>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          const res: { blocked?: LimitReason } = {};
          api.apply((d) => {
            const r = duplicateInstance(d, iid);
            res.blocked = r.blocked;
            return r.doc;
          });
          setNotice(res.blocked ? LIMIT_TEXT[res.blocked] + ' Копію не зроблено.' : 'Копію додано в інвентар.');
        }}
      >
        Копія
      </button>
      <button
        type="button"
        className="btn btn-bad btn-sm"
        onClick={() => {
          const where = worn.length ? ' Її знімуть з: ' + [...new Set(worn.map((w) => cfgName(w.cfgId)))].join(', ') + '.' : '';
          if (!window.confirm('Видалити річ з персонажа?' + where)) return;
          api.apply((d) => deleteInstance(d, iid));
          close();
        }}
      >
        Видалити
      </button>
      <button type="button" className="btn btn-primary btn-sm doll-ed-done" onClick={close}>
        Готово
      </button>
    </>
  );

  return (
    <ModalShell title={ownSlot ? (SLOTS.find((d) => d.slot === ownSlot)?.label ?? 'Річ') : 'Річ з інвентаря'} onClose={close} size="md" className="doll-modal-editor" foot={foot}>
      {elsewhere && !readOnly && (
        <div className="doll-m-banner" role="note">
          {inMain ? 'Це та сама річ, що в Головному' : 'Ця річ надіта ще в сеті «' + otherSets[0] + '»'}: зміни створять окрему копію
          {ownSlot ? ' для цього сету' : ''}, а там усе лишиться як є.
        </div>
      )}
      {cfgId === CFG_MAIN && otherSets.length > 0 && !readOnly && (
        <div className="doll-m-note">Ця річ надіта й у сетах: {otherSets.join(', ')} — зміни будуть і там.</div>
      )}
      {propCfg !== CFG_MAIN && MAIN_ONLY_CATS.has(itemCat) && (
        <div className="doll-m-note">Джинн і політ спільні для всіх сетів — тут вони змінюються так само, як у Головному.</div>
      )}
      {notice && (
        <div className="doll-m-notice" role="status">
          {notice}
        </div>
      )}

      <div className="doll-ed-plate">
        <button
          type="button"
          className="doll-m-cell doll-ed-cell"
          aria-label="Опис речі"
          onMouseEnter={(ev) => tip.show(ev.currentTarget, instTipContent(h, build))}
          onMouseLeave={tip.hide}
          onFocus={(ev) => tip.show(ev.currentTarget, instTipContent(h, build))}
          onBlur={tip.hide}
          onClick={(ev) => tip.toggle(ev.currentTarget, instTipContent(h, build))}
        >
          {item && <span className="doll-m-icon" style={iconStyle(item, itemCat, doc.gender)} />}
          {refine > 0 && <span className="doll-ed-cell-ref">+{refine}</span>}
        </button>
        <div className="doll-ed-plate-txt">
          <div className="doll-ed-name">
            {item ? <ItemName item={item} cat={itemCat} refine={refine} /> : 'Невідома річ #' + inst.id}
          </div>
          {item && reqText(item) && <div className="doll-ed-req">{reqText(item)}</div>}
          <div className="doll-ed-where">
            {worn.length ? 'Надіто: ' + [...new Set(worn.map((w) => cfgName(w.cfgId)))].join(' · ') : 'Не надіто — лежить в інвентарі'}
          </div>
        </div>
      </div>
      {!item && <div className="doll-m-bad">У каталозі немає цієї речі ({itemCat} #{inst.id}) — стати не рахуються.</div>}

      <div className="doll-ed-refine">
        <span className="doll-ed-refine-l">Заточка</span>
        <button type="button" className="doll-ed-step" aria-label="Заточка −1" disabled={readOnly || refine <= 0} onClick={() => edit(() => ({ r: Math.max(0, refine - 1) }))}>
          −
        </button>
        <select value={refine} disabled={readOnly} aria-label="Рівень заточки" onChange={(ev) => edit(() => ({ r: Number(ev.target.value) }))}>
          {Array.from({ length: 13 }, (_, n) => (
            <option key={n} value={n}>
              +{n}
            </option>
          ))}
        </select>
        <button type="button" className="doll-ed-step" aria-label="Заточка +1" disabled={readOnly || refine >= 12} onClick={() => edit(() => ({ r: Math.min(12, refine + 1) }))}>
          +
        </button>
      </div>

      <div className="doll-ed-tabs" role="tablist" aria-label="Розділи речі">
        {tabs
          .filter((t) => !t.hidden)
          .map((t) => (
            <button
              type="button"
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              className={'doll-ed-tab' + (activeTab === t.id ? ' active' : '')}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
      </div>

      <div className="doll-ed-tabbody" role="tabpanel">
        {activeTab === 'gems' && (
          <>
            {sockets > 0 && (
              <div className="doll-ed-sockets">
                {gemIds.map((gid, i) => {
                  const g = h.gems[i] ?? null;
                  const dop = g ? gemDop(g, isWeapon) : null;
                  return (
                    <div className="doll-ed-socket-row" key={i}>
                      <button
                        type="button"
                        className={'doll-ed-socket' + (gid ? ' is-filled' : '')}
                        disabled={readOnly}
                        aria-label={'Гніздо ' + (i + 1) + ': ' + (g ? g.name : gid ? 'невідомий камінь' : 'порожнє')}
                        onClick={() => openGem(i)}
                        onMouseEnter={(ev) => g && tip.show(ev.currentTarget, itemTipContent(g, 'ob', null, { isWeapon }))}
                        onMouseLeave={tip.hide}
                      >
                        <span className="doll-m-cell">{g && <span className="doll-m-icon" style={iconStyle(g, 'ob', doc.gender)} />}</span>
                        <span className="doll-ed-socket-txt">
                          {g ? <ItemName item={g} cat="ob" /> : gid ? 'Невідомий камінь #' + gid : 'Порожнє гніздо'}
                          <span className="doll-ed-socket-eff">{dop ? propLine(dop[0], dop[1]) : gid ? '' : 'натисни, щоб вставити камінь'}</span>
                        </span>
                      </button>
                      {gid > 0 && !readOnly && (
                        <button
                          type="button"
                          className="doll-m-x"
                          aria-label={'Прибрати камінь з гнізда ' + (i + 1)}
                          onClick={() => edit((src) => ({ g: withSocket(src.g, i, 0, src.cat) }))}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {canFillAll && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit(() => ({ g: gemIds.map(() => firstGem) }))}>
                Перший камінь — у всі гнізда
              </button>
            )}
            {isWeapon && (
              <div className="doll-ed-specials">
                {(['wdf', 'crystal'] as const).map((k) => {
                  const sp = k === 'wdf' ? h.wdf : h.crystal;
                  const id = (k === 'wdf' ? inst.w : inst.c) || 0;
                  const label = k === 'wdf' ? 'Шліфовка' : 'Кристал';
                  return (
                    <div className="doll-ed-special" key={k}>
                      <span className="doll-ed-special-l">{label}</span>
                      <button
                        type="button"
                        className="doll-ed-special-pick"
                        disabled={readOnly}
                        onClick={() => openSpecial(k)}
                        onMouseEnter={(ev) => sp && tip.show(ev.currentTarget, itemTipContent(sp, k, null))}
                        onMouseLeave={tip.hide}
                      >
                        {sp ? <ItemName item={sp} cat={k} /> : id ? 'Невідома #' + id : 'обрати…'}
                      </button>
                      {id > 0 && !readOnly && (
                        <button type="button" className="doll-m-x" aria-label={'Прибрати: ' + label} onClick={() => edit(() => (k === 'wdf' ? { w: 0 } : { c: 0 }))}>
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {activeTab === 'addons' && (
          <>
            {!inst.xr ? (
              <>
                <div className="doll-ed-sec-h">База каталогу</div>
                <div className="doll-ed-base">
                  {base.length ? (
                    base.map((r, i) => (
                      <div className="doll-ed-base-row" key={i}>
                        <span>{propLine(r.t, r.v)}</span>
                        <span className="doll-ed-lock">база</span>
                      </div>
                    ))
                  ) : (
                    <div className="doll-mute">У каталозі стат немає.</div>
                  )}
                </div>
                {!readOnly && item && base.length > 0 && (
                  <div className="doll-ed-hint">
                    Стати на сервері інші, ніж у каталозі?{' '}
                    <button type="button" className="doll-ed-link" onClick={() => edit((src) => replaceBasePatch(item, src))}>
                      Замінити базу
                    </button>
                  </div>
                )}
                <div className="doll-ed-sec-h">Додані роли</div>
                {rowsEditor('x', x, '+ Додати характеристику')}
              </>
            ) : (
              <>
                <div className="doll-m-warn">Базу каталогу замінено: рахуються лише рядки нижче. Адмін бачить таку річ позначеною.</div>
                {rowsEditor('x', x, '+ Додати характеристику')}
                {!readOnly && (
                  <div className="doll-ed-hint">
                    <button
                      type="button"
                      className="doll-ed-link"
                      onClick={() => {
                        const { patch, lossy } = restoreBasePatch(item, inst);
                        if (lossy && !window.confirm('Базові стати змінювали вручну — ці рядки буде скинуто. Повернути базу каталогу?')) return;
                        edit(() => patch);
                      }}
                    >
                      Повернути базу каталогу
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {activeTab === 'engrave' && (
          <>
            <div className="doll-ed-hint">Гравіювання — додаткові стати речі, які вибивають у грі різцями.</div>
            {rowsEditor('e', e, '+ Додати гравіювання')}
          </>
        )}
        {rollsFull && !readOnly && (activeTab === 'addons' || activeTab === 'engrave') && (
          <div className="doll-mute">Ліміт: {DOC_LIMITS.rollRows} рядків ролів на персонажа.</div>
        )}
      </div>
    </ModalShell>
  );
}

export default EditorModal;
