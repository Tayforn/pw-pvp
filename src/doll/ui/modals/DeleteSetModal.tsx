// =========================================================
// ЛЯЛЬКА — вікно «Видалити сет?» з меню вкладки сету. Окремим вікном, бо
// там є вибір: прибрати й речі, які після цього ніде не будуть надіті (інакше
// вони просто лишаться в інвентарі). Відкривається через ModalHost, як і всі
// вікна редактора: не всередині колонок, які можуть бути контейнерами
// (@container), — тож затемнення завжди на весь екран.
// =========================================================

import { useState } from 'react';
import { CFG_MAIN, findSet } from '../../model/hydrate';
import { deleteSet, setOrphans } from '../../model/ops';
import { itemsWord } from '../ConfigTabs';
import { useEditor } from '../EditorContext';
import { ModalShell } from './ModalShell';

export function DeleteSetModal({ setId }: { setId: string }) {
  const api = useEditor();
  const set = findSet(api.doc, setId);
  const orphans = set ? setOrphans(api.doc, setId).length : 0;
  const [alsoItems, setAlsoItems] = useState(false);
  const close = () => api.closeModal();
  if (!set) return null;
  const confirm = () => {
    if (api.activeCfg === setId) api.setActiveCfg(CFG_MAIN);
    api.apply((d) => deleteSet(d, setId, alsoItems));
    close();
  };
  return (
    <ModalShell
      title={'Видалити сет «' + set.name + '»?'}
      size="sm"
      onClose={close}
      foot={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
            Скасувати
          </button>
          <button type="button" className="btn btn-bad btn-sm" disabled={api.readOnly} onClick={confirm}>
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

export default DeleteSetModal;
