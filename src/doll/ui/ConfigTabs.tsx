// =========================================================
// ЛЯЛЬКА — смуга комплектів: «Головний | сети | + Додати сет». Перемикання
// нічого не переносить: фігура й інвентар просто перемальовуються з того
// самого пулу речей. Меню сету (⋯): перейменувати, змінити вид, видалити.
// Видалення питає окремим вікном, бо там є вибір — прибрати й речі, які
// після цього ніде не будуть надіті (інакше вони просто лишаться в інвентарі).
// =========================================================

import { useState, type KeyboardEvent } from 'react';
import { DOC_LIMITS, SET_KINDS, setKindShort, type SetCfg, type SetKind } from '../model/doc';
import { CFG_MAIN, findSet } from '../model/hydrate';
import { deleteSet, renameSet, setOrphans, setSetKind } from '../model/ops';
import CellMenu, { type MenuItem } from './CellMenu';
import { useEditor } from './EditorContext';
import { ModalShell } from './modals/ModalShell';

/** «1 річ», «3 речі», «5 речей», «21 річ» — українська множина. */
export function itemsWord(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return n + ' річ';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return n + ' речі';
  return n + ' речей';
}

/** Короткий підпис виду: кастерам третій вид — «Спів», фізикам — «Аспд» (живе в моделі, бо з нього й назва сету за замовчуванням). */
export const kindShort = (kind: SetKind, cls: string): string => setKindShort(kind, cls);

/** Бейдж виду зайвий, коли назва сету з нього й починається («ПЗ», «ПЗ 2»). */
function needsBadge(set: SetCfg, short: string): boolean {
  const n = set.name.trim().toLowerCase();
  const k = short.toLowerCase();
  return !(n === k || n.startsWith(k + ' '));
}

function RenameInput({ set, onDone }: { set: SetCfg; onDone(): void }) {
  const api = useEditor();
  const [v, setV] = useState(set.name);
  const commit = () => {
    if (v.trim()) api.apply((d) => renameSet(d, set.id, v));
    onDone();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onDone();
    }
  };
  return (
    <input
      className="doll-tab-rename"
      value={v}
      maxLength={DOC_LIMITS.setNameLen}
      aria-label="Нова назва сету"
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={onKey}
      onBlur={commit}
    />
  );
}

function DeleteSetDialog({ setId, onClose }: { setId: string; onClose(): void }) {
  const api = useEditor();
  const set = findSet(api.doc, setId);
  const orphans = set ? setOrphans(api.doc, setId).length : 0;
  const [alsoItems, setAlsoItems] = useState(false);
  if (!set) return null;
  const confirm = () => {
    if (api.activeCfg === setId) api.setActiveCfg(CFG_MAIN);
    api.apply((d) => deleteSet(d, setId, alsoItems));
    onClose();
  };
  return (
    <ModalShell
      title={'Видалити сет «' + set.name + '»?'}
      size="sm"
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Скасувати
          </button>
          <button type="button" className="btn btn-bad btn-sm" onClick={confirm}>
            Видалити
          </button>
        </>
      }
    >
      <p className="doll-dlg-text">Речі сету залишаться в інвентарі.</p>
      {orphans > 0 && (
        <>
          <p className="doll-dlg-text">
            {itemsWord(orphans)} після цього не буде надіто ніде — ні в Головному, ні в іншому сеті.
          </p>
          <label className="checkbox-row doll-dlg-check">
            <input type="checkbox" checked={alsoItems} onChange={(e) => setAlsoItems(e.target.checked)} />
            Видалити й ці речі ({orphans})
          </label>
        </>
      )}
    </ModalShell>
  );
}

export default function ConfigTabs() {
  const api = useEditor();
  const { doc, activeCfg, readOnly } = api;
  const [menu, setMenu] = useState<{ setId: string; rect: DOMRect } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const full = doc.sets.length >= DOC_LIMITS.sets;
  const menuSet = menu ? findSet(doc, menu.setId) : undefined;

  const menuItems = (set: SetCfg): MenuItem[] => [
    { label: 'Перейменувати', onClick: () => setRenaming(set.id) },
    ...SET_KINDS.filter((k) => k !== set.kind).map((k) => ({
      label: 'Змінити вид на «' + kindShort(k, doc.cls) + '»',
      onClick: () => api.apply((d) => setSetKind(d, set.id, k)),
    })),
    { label: 'Видалити сет…', danger: true, onClick: () => setDeleting(set.id) },
  ];

  return (
    <div className="doll-tabs" role="tablist" aria-label="Комплекти персонажа">
      <button
        type="button"
        role="tab"
        aria-selected={activeCfg === CFG_MAIN}
        className={'doll-tab' + (activeCfg === CFG_MAIN ? ' is-active' : '')}
        onClick={() => api.setActiveCfg(CFG_MAIN)}
      >
        Головний
      </button>

      {doc.sets.map((set) => {
        const on = activeCfg === set.id;
        const short = kindShort(set.kind, doc.cls);
        if (renaming === set.id)
          return (
            <span key={set.id} className={'doll-tab is-editing' + (on ? ' is-active' : '')}>
              <RenameInput set={set} onDone={() => setRenaming(null)} />
            </span>
          );
        return (
          <span key={set.id} className={'doll-tab doll-tab-set' + (on ? ' is-active' : '')}>
            <button
              type="button"
              role="tab"
              aria-selected={on}
              className="doll-tab-main"
              title={'Сет «' + set.name + '» · вид: ' + short}
              onClick={() => api.setActiveCfg(set.id)}
              onDoubleClick={() => !readOnly && setRenaming(set.id)}
            >
              <span className="doll-tab-name">{set.name}</span>
              {needsBadge(set, short) && <span className={'doll-kind doll-kind-' + set.kind}>{short}</span>}
            </button>
            {!readOnly && (
              <button
                type="button"
                className="doll-tab-more"
                aria-label={'Дії з сетом «' + set.name + '»'}
                aria-haspopup="menu"
                onClick={(e) => setMenu({ setId: set.id, rect: e.currentTarget.getBoundingClientRect() })}
              >
                ⋯
              </button>
            )}
          </span>
        );
      })}

      {!readOnly && (
        <button
          type="button"
          className="doll-tab doll-tab-add"
          aria-disabled={full}
          title={full ? 'Не більше ' + DOC_LIMITS.sets + ' сетів' : 'Окремий набір речей для свапу: ПЗ, ПА або спів/аспд'}
          onClick={() => api.openAddSet()}
        >
          + Додати сет{full ? ' · ' + DOC_LIMITS.sets + '/' + DOC_LIMITS.sets : ''}
        </button>
      )}

      {menu && menuSet && <CellMenu anchor={menu.rect} title={menuSet.name} items={menuItems(menuSet)} onClose={() => setMenu(null)} />}
      {deleting && <DeleteSetDialog setId={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}
