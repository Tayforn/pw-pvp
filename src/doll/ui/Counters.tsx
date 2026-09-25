// =========================================================
// ЛЯЛЬКА — лічильники лімітів документа: речей, рядків ручних ролів і розмір.
// Ті самі межі перевірятиме сервер (validateDoc); показуємо їх заздалегідь,
// щоб гравець дізнався про ліміт від редактора, а не від відмови при збереженні.
// =========================================================

import { DOC_LIMITS, docSizeBytes, rollRowCount } from '../model/doc';
import { useEditor } from './EditorContext';

const kb = (bytes: number): string => (bytes / 1024).toLocaleString('uk', { maximumFractionDigits: 1 });

/** Стан лічильника: ближче 90 % — попередження, понад межу — помилка. */
function level(n: number, max: number): string {
  if (n > max) return ' is-bad';
  if (n >= max * 0.9) return ' is-warn';
  return '';
}

export default function Counters() {
  const { doc } = useEditor();
  const items = doc.items.length;
  const rows = rollRowCount(doc);
  const bytes = docSizeBytes(doc);
  return (
    <p className="doll-counters" aria-label="Ліміти персонажа">
      <span className={'doll-counter' + level(items, DOC_LIMITS.items)} title="Скільки речей у персонажа (разом з інвентарем)">
        речей <b>{items}/{DOC_LIMITS.items}</b>
      </span>
      <span className={'doll-counter' + level(rows, DOC_LIMITS.rollRows)} title="Рядки ручних ролів і гравіювання в усіх речах">
        рядків ролів <b>{rows}/{DOC_LIMITS.rollRows}</b>
      </span>
      <span className={'doll-counter' + level(bytes, DOC_LIMITS.bytes)} title="Розмір персонажа при збереженні">
        <b>
          {kb(bytes)}/{kb(DOC_LIMITS.bytes)}
        </b>{' '}
        КБ
      </span>
    </p>
  );
}
