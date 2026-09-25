// =========================================================
// ЛЯЛЬКА — фігура: 17 слотів навколо силуету на CSS-grid (3 колонки, силует,
// 2 колонки; 4 рядки — та сама розкладка, що в Хелпері, але без абсолютних
// координат, тож на телефоні права колонка не зрізається).
//
// На вкладці сету видно лише ВЛАСНІ речі сету: порожній слот — порожній, без
// «привидів» Головного. Для балів він усе одно рахується як у Головному (у грі
// при свапі решта речей нікуди не зникає) — про це один підпис під фігурою.
// Джинн і політ у сетах не міняються: показуємо річ Головного, приглушено.
// =========================================================

import { useMemo } from 'react';
import { computeActiveSlots } from '../core/stats';
import { FIGURE } from '../data/assets';
import { SLOT_KEYS, isSetSlotKey } from '../model/doc';
import { CFG_MAIN, findSet, mainFill, ownSlots } from '../model/hydrate';
import { fillEmptyFromMain, unequipAll } from '../model/ops';
import { useEditor } from './EditorContext';
import type { DnD } from './hooks/useDnD';
import SlotCell from './SlotCell';

export default function Paperdoll({ dnd }: { dnd: DnD }) {
  const api = useEditor();
  const { doc, model, activeCfg: cfgId, readOnly } = api;
  const isMain = cfgId === CFG_MAIN;
  const setName = isMain ? '' : (findSet(doc, cfgId)?.name ?? '');

  // «Не вдягається» рахуємо на заповненій конфігурації: вимоги до атрибутів
  // залежать і від речей, що прийшли з Головного (трактат +45 інт тощо).
  const build = api.buildOf(cfgId);
  const active = useMemo(() => computeActiveSlots(build), [build]);
  const own = ownSlots(doc, cfgId);

  // Скільки порожніх слотів сету дотисне «Надіти решту з головного» — рівно те, що
  // mainFill добирає в заповнену конфігурацію (без дублів, кільця — пулом).
  const fillable = useMemo(() => (isMain ? 0 : Object.keys(mainFill(doc, own)).length), [isMain, own, doc]);
  const ownCount = Object.keys(own).length;

  const clearAll = () => {
    const where = isMain ? 'з Головного' : 'із сету «' + setName + '»';
    if (window.confirm('Зняти всі речі ' + where + '? Вони лишаться в інвентарі.')) api.apply((d) => unequipAll(d, cfgId));
  };

  return (
    <div className="doll-paper">
      <div className="doll-fig" role="group" aria-label={isMain ? 'Головний комплект' : 'Сет «' + setName + '»'}>
        <FIGURE className="doll-fig-svg" />
        {SLOT_KEYS.map((slot) => {
          const inherited = !isMain && !isSetSlotKey(slot);
          const iid = inherited ? doc.main[slot] : own[slot];
          const h = iid ? (model.items.get(iid) ?? null) : null;
          // Невідома річ (каталог оновився) у ядро не йде зовсім — теж «не вдягається».
          const bad = !!h && (!h.item || !active.has(slot));
          return <SlotCell key={slot} slot={slot} h={h} inherited={inherited} bad={bad} dnd={dnd} build={build} />;
        })}
      </div>

      {!isMain && (
        <p className="doll-paper-note">
          Порожні слоти для балів рахуються як у Головному. Джинн і політ — завжди з Головного.
        </p>
      )}
      {!readOnly && (
        <div className="doll-paper-actions">
          {!isMain && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!fillable}
              title={fillable ? 'Надіти речі Головного в усі порожні слоти сету' : 'Порожніх слотів, які можна заповнити з Головного, немає'}
              onClick={() => api.apply((d) => fillEmptyFromMain(d, cfgId))}
            >
              Надіти решту з головного{fillable ? ' (' + fillable + ')' : ''}
            </button>
          )}
          {ownCount > 0 && (
            <button type="button" className="btn btn-ghost btn-sm doll-btn-quiet" onClick={clearAll}>
              Зняти все
            </button>
          )}
        </div>
      )}
    </div>
  );
}
