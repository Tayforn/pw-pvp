// =========================================================
// ЛЯЛЬКА — пошук стану, щоб додати його в рядок бафів/дебафів. Порт
// BuffPickModal Хелпера: фільтр за назвою і за класами-джерелами (за
// замовчуванням Воїн + Оборотень + Жрець — їхні пати-бафи потрібні найчастіше),
// загальні стани показуються завжди. Бафи й дебафи — вкладками одного вікна:
// контекст редактора відкриває пошук без виду, тож вид обирається тут і
// запамʼятовується до наступного відкриття.
// =========================================================

import { useMemo, useState } from 'react';
import { shownBuffs, shownDebuffs } from '../../core/buffs';
import { CLASS_BY_SM } from '../../core/constants';
import { getBuffs, getDebuffs } from '../../core/refdata';
import type { BuffDef } from '../../core/types';
import { buffIconStyle } from '../../data/assets';
import { addExtraBuff } from '../../model/ops';
import { buildBuffTipModel } from '../../model/tipModel';
import { useEditor } from '../EditorContext';
import { isCoarsePointer, useTip } from '../tip/useTip';
import { ModalShell } from './ModalShell';

type Kind = 'buff' | 'debuff';

/** Класи pvp-сервера (sm 1..10); призрак/жнець/паладин/стрілок сюди не входять. */
export const PICK_CLASSES: number[] = Object.keys(CLASS_BY_SM)
  .map(Number)
  .filter((sm) => sm >= 1 && sm <= 10);
const DEFAULT_CLASSES = [1, 3, 5];

let lastKind: Kind = 'buff';

/** Рядки пошуку: відмічені класи + загальні (sm 0) в кінці, без дублів за назвою. */
export function buffPickRows(data: Record<string, BuffDef[]> | null, classes: ReadonlySet<number>, q: string): Array<{ b: BuffDef; sm: number }> {
  if (!data) return [];
  const nameQ = q.trim().toLowerCase();
  const all: Array<{ b: BuffDef; sm: number }> = [];
  for (const key in data) {
    const sm = key === '0' ? 0 : Number(key);
    if (sm !== 0 && (!PICK_CLASSES.includes(sm) || !classes.has(sm))) continue;
    for (const b of data[key]) if (!nameQ || b.name.toLowerCase().includes(nameQ)) all.push({ b, sm });
  }
  all.sort((a, b) => (a.sm === 0 ? 1 : 0) - (b.sm === 0 ? 1 : 0) || a.sm - b.sm);
  const seen = new Set<string>();
  const out: Array<{ b: BuffDef; sm: number }> = [];
  for (const x of all) {
    if (seen.has(x.b.name)) continue;
    seen.add(x.b.name);
    out.push(x);
  }
  return out;
}

export function BuffPickModal() {
  const api = useEditor();
  const tip = useTip();
  const [kind, setKindState] = useState<Kind>(lastKind);
  const [classes, setClasses] = useState<ReadonlySet<number>>(() => new Set(DEFAULT_CLASSES));
  const [q, setQ] = useState('');
  const coarse = isCoarsePointer();
  const setKind = (k: Kind) => {
    lastKind = k;
    setKindState(k);
  };

  const build = api.buildOf(api.activeCfg, true);
  const data = kind === 'debuff' ? getDebuffs() : getBuffs();
  const classKey = [...classes].sort((a, b) => a - b).join(',');
  const rows = useMemo(
    () => buffPickRows(data, classes, q),
    // classKey представляє classes (Set порівнюється за посиланням)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, classKey, q],
  );
  const inRow = useMemo(() => new Set((kind === 'debuff' ? shownDebuffs(build) : shownBuffs(build)).map((b) => b.id)), [build, kind]);
  const close = () => api.closeModal();
  const add = (id: number) => {
    tip.hideAll();
    api.apply((d) => addExtraBuff(d, id));
    close();
  };
  const toggleClass = (sm: number, on: boolean) => {
    const s = new Set(classes);
    if (on) s.add(sm);
    else s.delete(sm);
    setClasses(s);
  };

  return (
    <ModalShell title={kind === 'debuff' ? 'Додати дебаф' : 'Додати баф'} onClose={close} size="md" className="doll-modal-bpick">
      <div className="doll-bpick-kinds" role="tablist" aria-label="Вид стану">
        {(['buff', 'debuff'] as const).map((k) => (
          <button type="button" key={k} role="tab" aria-selected={kind === k} className={'doll-ed-tab' + (kind === k ? ' active' : '')} onClick={() => setKind(k)}>
            {k === 'buff' ? 'Бафи' : 'Дебафи'}
          </button>
        ))}
      </div>
      <input
        type="search"
        className="doll-pick-search"
        placeholder={kind === 'debuff' ? 'назва дебафа…' : 'назва бафа…'}
        autoComplete="off"
        // На тачі без автофокусу — клавіатура закрила б список.
        data-autofocus={coarse ? undefined : ''}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Пошук стану"
      />
      <div className="doll-pick-types doll-bpick-classes" role="group" aria-label="Класи-джерела">
        {PICK_CLASSES.map((sm) => (
          <label key={sm} className={classes.has(sm) ? 'on' : ''}>
            <input type="checkbox" checked={classes.has(sm)} onChange={(e) => toggleClass(sm, e.target.checked)} />
            {CLASS_BY_SM[sm]}
          </label>
        ))}
      </div>
      <div className="doll-bpick-list">
        {!data ? (
          <div className="doll-m-state doll-mute">Довідник станів ще завантажується…</div>
        ) : rows.length === 0 ? (
          <div className="doll-m-state doll-mute">Нічого не знайдено.</div>
        ) : (
          rows.map(({ b, sm }) => (
            <button
              type="button"
              key={b.id}
              className="doll-bpick-row"
              disabled={api.readOnly}
              onClick={() => add(b.id)}
              onMouseEnter={(e) => tip.show(e.currentTarget, { kind: 'buff', model: buildBuffTipModel(build, b) })}
              onMouseLeave={tip.hide}
              onFocus={(e) => tip.show(e.currentTarget, { kind: 'buff', model: buildBuffTipModel(build, b) })}
              onBlur={tip.hide}
            >
              <span className="doll-bpick-ic" style={buffIconStyle(b.an)} aria-hidden="true" />
              <span className="doll-bpick-name">
                {b.name}
                <span className="doll-bpick-cls"> · {sm === 0 ? 'загальний' : CLASS_BY_SM[sm]}</span>
              </span>
              {inRow.has(b.id) && <span className="doll-pick-tag">у рядку</span>}
            </button>
          ))
        )}
      </div>
      <div className="doll-bcfg-note">Стани — лише для перегляду статів, у скор не входять.</div>
    </ModalShell>
  );
}

export default BuffPickModal;
