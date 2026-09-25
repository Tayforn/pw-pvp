// =========================================================
// ЛЯЛЬКА — вікно «Новий сет»: вид (ПЗ / ПА / спів) з підказкою порогу з
// правил турніру і необовʼязкова назва. Сет створюється ПОРОЖНІМ — речі
// Головного лежать в інвентарі з позначкою «Г», їх надівають кліком. Два
// сети одного виду дозволені (наприклад, «ПЗ» і «ПЗ проти магів»): бали
// рахуються з найкращого набору всіх речей, а не з підпису сету.
// =========================================================

import { useState, type FormEvent } from 'react';
import { isCoarsePointer } from './tip/useTip';
import { SPECIAL_SET_HINTS } from '../../data/gearRules';
import { DOC_LIMITS, SET_KINDS, type SetKind } from '../model/doc';
import { createSet, defaultSetName } from '../model/ops';
import { kindShort } from './ConfigTabs';
import { useEditor } from './EditorContext';
import { ModalShell } from './modals/ModalShell';

/** «ПЗ-сет», «ПА-сет», «Спів-сет». */
const kindTitle = (k: SetKind, cls: string): string => kindShort(k, cls) + '-сет';

export default function AddSetDialog() {
  const api = useEditor();
  const { doc, readOnly } = api;
  const [kind, setKind] = useState<SetKind>('pz');
  const [name, setName] = useState('');
  const full = doc.sets.length >= DOC_LIMITS.sets;
  // На тачі поле назви без автофокусу: вікно там — аркуш знизу, і клавіатура
  // закрила б вибір виду, а назва необовʼязкова.
  const [fine] = useState(() => !isCoarsePointer());
  const placeholder = defaultSetName(doc, kind);

  const create = (e?: FormEvent) => {
    e?.preventDefault();
    if (full || readOnly) return;
    // apply кличе функцію синхронно — так дістаємо id нового сету з того самого кроку.
    const out: { id: string | null } = { id: null };
    api.apply((d) => {
      const r = createSet(d, kind, name);
      out.id = r.setId;
      return r.doc;
    });
    api.closeModal();
    if (out.id) api.setActiveCfg(out.id);
  };

  return (
    <ModalShell
      title="Новий сет"
      onClose={api.closeModal}
      foot={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={api.closeModal}>
            Скасувати
          </button>
          <button type="submit" form="dollAddSetForm" className="btn btn-primary btn-sm" disabled={full || readOnly}>
            Створити
          </button>
        </>
      }
    >
      <form id="dollAddSetForm" className="doll-addset" onSubmit={create}>
        {full && <p className="form-err">Уже {DOC_LIMITS.sets} сетів — це максимум. Видали зайвий, щоб додати новий.</p>}
        <fieldset className="doll-addset-kinds">
          <legend>Який сет?</legend>
          {SET_KINDS.map((k) => (
            <label key={k} className={'doll-addset-kind' + (kind === k ? ' is-on' : '')}>
              <input type="radio" name="dollSetKind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              <span className="doll-addset-kind-t">
                <b>{kindTitle(k, doc.cls)}</b>
                <span className="hint">Поріг для балів: {SPECIAL_SET_HINTS[k]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="dollSetName">Назва</label>
          <input
            id="dollSetName"
            type="text"
            data-autofocus={fine ? '' : undefined}
            value={name}
            maxLength={DOC_LIMITS.setNameLen}
            placeholder={placeholder}
            onChange={(e) => setName(e.target.value)}
          />
          <span className="hint">Необовʼязково. Порожньо — буде «{placeholder}». Наприклад: «ПЗ проти магів».</span>
        </div>
        <p className="doll-addset-note">
          Сет створюється порожнім. Речі Головного лежать в інвентарі з позначкою «Г» — клікни по речі, щоб надіти її в сет, або натисни «Надіти решту з
          головного». Порожні слоти для балів рахуються як у Головному.
        </p>
      </form>
    </ModalShell>
  );
}
