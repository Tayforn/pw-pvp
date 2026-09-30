// =========================================================
// ЛЯЛЬКА — смужка персонажа над колонками (розкладка B3): «← Мої персонажі»,
// Імʼя / Клас (лише 10 класів сервера) / Стать / Рівень (до 105) / Шлях
// мудрець-демон — підпис ліворуч від поля, в один рядок з переносом — і
// праворуч кнопки сторінки (стан збереження, «Зберегти» тощо). Кнопки
// приходять слотами start / end від сторінки: редактор не знає, де живе
// документ (чернетка, профіль, знімок).
//
// Смужка не залежить від контексту редактора (doc і apply — пропсами): її
// видно й поки вантажиться каталог — тоді поля вимкнені, а кнопка
// збереження не зникає.
// =========================================================

import type { ReactNode } from 'react';
import { CLASS_LABELS, CLASS_ORDER } from '../../data/gearRules';
import { CLS_KEYS, DOC_LIMITS, MAX_LEVEL, type CharacterDoc, type ClsKey } from '../model/doc';
import { setCls, setGender, setLevel, setName, setPath } from '../model/ops';
import { CLS_CHAR } from '../model/sheet';
import { NumInput } from './NumInput';

export { CLS_CHAR };
export const clsLabel = (c: ClsKey): string => CLASS_LABELS[CLS_CHAR[c]];
const CLS_OPTIONS: ClsKey[] = CLASS_ORDER.map((cc) => CLS_KEYS.find((k) => CLS_CHAR[k] === cc)).filter((k): k is ClsKey => !!k);

export interface CharBarProps {
  doc: CharacterDoc;
  /** Поля вимкнені: перегляд чужого знімка або каталог ще вантажиться. */
  readOnly: boolean;
  /** Зміна документа (api.apply редактора); немає — поля лише показують значення. */
  apply?(fn: (doc: CharacterDoc) => CharacterDoc): void;
  /** Ліворуч від полів — «← Мої персонажі». */
  start?: ReactNode;
  /** Праворуч — стан збереження й кнопки сторінки. */
  end?: ReactNode;
}

export default function CharBar({ doc, readOnly, apply, start, end }: CharBarProps) {
  const off = readOnly || !apply;
  const edit = (fn: (d: CharacterDoc) => CharacterDoc) => apply?.(fn);
  return (
    <section className="doll-bar" aria-label="Персонаж">
      {start && <div className="doll-bar-start">{start}</div>}
      <div className="doll-bar-fields">
        <div className="field doll-bar-f doll-bar-name">
          <label htmlFor="dollName">Імʼя</label>
          <input
            id="dollName"
            type="text"
            value={doc.name}
            maxLength={DOC_LIMITS.nameLen}
            placeholder="Нік у грі"
            disabled={off}
            autoComplete="off"
            onChange={(e) => edit((d) => setName(d, e.target.value))}
          />
        </div>

        <div className="field doll-bar-f">
          <label htmlFor="dollClass">Клас</label>
          <select id="dollClass" value={doc.cls} disabled={off} onChange={(e) => edit((d) => setCls(d, e.target.value as ClsKey))}>
            {CLS_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {clsLabel(k)}
              </option>
            ))}
          </select>
        </div>

        <div className="field doll-bar-f">
          <span className="doll-bar-l" id="dollGenderL">
            Стать
          </span>
          <div className="doll-seg doll-seg-sm" role="radiogroup" aria-labelledby="dollGenderL">
            {(['m', 'f'] as const).map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={doc.gender === g}
                className={doc.gender === g ? 'is-on' : ''}
                disabled={off}
                onClick={() => edit((d) => setGender(d, g))}
              >
                {g === 'm' ? 'Чол.' : 'Жін.'}
              </button>
            ))}
          </div>
        </div>

        <div className="field doll-bar-f doll-bar-lvl">
          <label htmlFor="dollLevel">Рівень</label>
          <NumInput id="dollLevel" value={doc.level} min={1} max={MAX_LEVEL} disabled={off} onCommit={(n) => edit((d) => setLevel(d, n))} />
        </div>

        <div className="field doll-bar-f">
          <label htmlFor="dollPath">Шлях</label>
          <select
            id="dollPath"
            value={doc.path ?? ''}
            disabled={off}
            onChange={(e) => {
              const v = e.target.value;
              edit((d) => setPath(d, v === 'rs' || v === 'je' ? v : null));
            }}
          >
            <option value="">Не вказано</option>
            <option value="rs">Мудрець</option>
            <option value="je">Демон</option>
          </select>
        </div>
      </div>
      {end && <div className="doll-bar-end">{end}</div>}
    </section>
  );
}
