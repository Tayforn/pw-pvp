// =========================================================
// ЛЯЛЬКА — шапка персонажа: імʼя, клас (лише 10 класів сервера), стать,
// рівень (до 105), шлях мудрець/демон, атрибути з бюджетом очок і титули
// (згорнуті). Поля КЕРОВАНІ: у Хелпері інпути були некеровані й після
// імпорту/скидання їх «ремонтували» перемонтуванням через key — тут значення
// завжди з документа, а чернетка вводу живе лише поки поле у фокусі
// (щоб можна було стерти число й набрати нове, не отримавши «5» посередині).
//
// Бонуси атрибутів від речей («+45 (340)») — з активної вкладки: у сеті інші
// речі, отже й інші бонуси.
// =========================================================

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ATTR_BASE, TITLE_FIELDS, TITLE_LIMIT, availPoints, computeStats } from '../core/stats';
import { defaultState } from '../core/types';
import { CLASS_LABELS, CLASS_ORDER } from '../../data/gearRules';
import type { CharClass } from '../../data/types';
import { CLS_KEYS, DOC_LIMITS, MAX_LEVEL, type CharacterDoc, type ClsKey } from '../model/doc';
import { setAttr, setCls, setGender, setLevel, setName, setPath, setTitle } from '../model/ops';
import { useEditor } from './EditorContext';
import { CLS_CHAR } from '../model/sheet';

export { CLS_CHAR };
export const clsLabel = (c: ClsKey): string => CLASS_LABELS[CLS_CHAR[c]];
const CLS_OPTIONS: ClsKey[] = CLASS_ORDER.map((cc) => CLS_KEYS.find((k) => CLS_CHAR[k] === cc)).filter((k): k is ClsKey => !!k);

type AttrKey = 'str' | 'dex' | 'vit' | 'mag';
const ATTRS: Array<{ k: AttrKey; label: string; bonus: string }> = [
  { k: 'str', label: 'Сила', bonus: 'om' },
  { k: 'dex', label: 'Спритність', bonus: 'uy' },
  { k: 'vit', label: 'Тілобудова', bonus: 'lf' },
  { k: 'mag', label: 'Інтелект', bonus: 'tx' },
];

const fmt = (n: number): string => Math.round(n).toLocaleString('uk');
const SHORT: Record<AttrKey, string> = { str: 'Сил.', dex: 'Спр.', vit: 'Тіл.', mag: 'Інт.' };

/** Вузький екран: атрибути згорнуті, щоб фігура й інвентар були ближче до верху сторінки. */
function isNarrow(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 560px)').matches;
  } catch {
    return false;
  }
}

/** Вільні очки за формулою ядра (5 за рівень понад перший мінус витрачені). */
function pointsLeft(doc: CharacterDoc): number {
  return availPoints({ ...defaultState(), level: doc.level, ...doc.attrs });
}

/**
 * Атрибут не може піти в мінус бюджету: якщо нове значення перевищує вільні
 * очки, воно зрізається до максимуму — як у Хелпері (commitAttr).
 */
export function clampAttr(doc: CharacterDoc, k: AttrKey, raw: number): CharacterDoc {
  let v = Math.max(ATTR_BASE, Math.floor(raw) || 0);
  const over = -pointsLeft({ ...doc, attrs: { ...doc.attrs, [k]: v } });
  if (over > 0) v = Math.max(ATTR_BASE, v - over);
  return setAttr(doc, k, v);
}

/** Числове поле з чернеткою вводу: поки фокус — показує те, що набрано; після — значення з документа. */
function NumInput({
  id, value, min, max, disabled, onCommit, label,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit(n: number): void;
  label?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      value={draft}
      disabled={disabled}
      aria-label={label}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const n = Number(raw);
        if (raw.trim() !== '' && Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => {
        focused.current = false;
        setDraft(String(value));
      }}
    />
  );
}

function Field({ id, label, extra, children, className }: { id?: string; label: string; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={'field doll-hf' + (className ? ' ' + className : '')}>
      <label htmlFor={id}>
        <span>{label}</span>
        {extra}
      </label>
      {children}
    </div>
  );
}

export default function DollHeader() {
  const api = useEditor();
  const { doc, readOnly, activeCfg } = api;
  const build = api.buildOf(activeCfg);
  const t = useMemo(() => computeStats(build).t, [build]);
  const avail = pointsLeft(doc);
  const [attrsOpen] = useState(() => !isNarrow());
  const titlesSum = TITLE_FIELDS.reduce((n, f) => n + (doc.titles?.[f.code] ? 1 : 0), 0);

  return (
    <section className="card doll-header" aria-label="Персонаж">
      <div className="doll-header-grid">
        <Field id="dollName" label="Імʼя" className="doll-hf-name">
          <input
            id="dollName"
            type="text"
            value={doc.name}
            maxLength={DOC_LIMITS.nameLen}
            placeholder="Нік у грі"
            disabled={readOnly}
            autoComplete="off"
            onChange={(e) => api.apply((d) => setName(d, e.target.value))}
          />
        </Field>

        <Field id="dollClass" label="Клас">
          <select id="dollClass" value={doc.cls} disabled={readOnly} onChange={(e) => api.apply((d) => setCls(d, e.target.value as ClsKey))}>
            {CLS_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {clsLabel(k)}
              </option>
            ))}
          </select>
        </Field>

        <div className="field doll-hf">
          <span className="doll-hf-l" id="dollGenderL">
            Стать
          </span>
          <div className="doll-seg" role="radiogroup" aria-labelledby="dollGenderL">
            {(['m', 'f'] as const).map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={doc.gender === g}
                className={doc.gender === g ? 'is-on' : ''}
                disabled={readOnly}
                onClick={() => api.apply((d) => setGender(d, g))}
              >
                {g === 'm' ? 'Чол.' : 'Жін.'}
              </button>
            ))}
          </div>
        </div>

        <Field id="dollLevel" label="Рівень">
          <NumInput id="dollLevel" value={doc.level} min={1} max={MAX_LEVEL} disabled={readOnly} onCommit={(n) => api.apply((d) => setLevel(d, n))} />
        </Field>

        <Field id="dollPath" label="Шлях">
          <select
            id="dollPath"
            value={doc.path ?? ''}
            disabled={readOnly}
            onChange={(e) => {
              const v = e.target.value;
              api.apply((d) => setPath(d, v === 'rs' || v === 'je' ? v : null));
            }}
          >
            <option value="">Не вказано</option>
            <option value="rs">Мудрець</option>
            <option value="je">Демон</option>
          </select>
        </Field>
      </div>

      <details className="doll-titles doll-attrs-box" open={attrsOpen}>
        <summary>
          Атрибути{' '}
          <span className={'hint' + (avail < 0 ? ' doll-attrs-over' : '')}>
            {ATTRS.map(({ k }) => SHORT[k] + ' ' + doc.attrs[k]).join(' · ')} · вільних {avail}
          </span>
        </summary>
        <div className="doll-header-grid doll-attrs">
          {ATTRS.map(({ k, label, bonus }) => {
            const base = doc.attrs[k];
            const plus = t[bonus] || 0;
            return (
              <Field
                key={k}
                id={'dollAttr-' + k}
                label={label}
                extra={
                  plus ? (
                    <b className="doll-attr-plus" title={fmt(base) + ' своїх + ' + fmt(plus) + ' від речей = ' + fmt(base + plus)}>
                      +{fmt(plus)} ({fmt(base + plus)})
                    </b>
                  ) : null
                }
              >
                <NumInput id={'dollAttr-' + k} value={base} min={ATTR_BASE} max={9999} disabled={readOnly} onCommit={(n) => api.apply((d) => clampAttr(d, k, n))} />
              </Field>
            );
          })}
          <div className="field doll-hf doll-avail">
            <span className="doll-hf-l">Вільні очки</span>
            <b className={'doll-avail-v' + (avail < 0 ? ' is-over' : '')} title={avail < 0 ? 'Очок витрачено більше, ніж дає рівень' : undefined}>
              {avail}
            </b>
            {avail < 0 && <span className="doll-avail-over">роздано більше, ніж дає рівень — зменш атрибути</span>}
          </div>
        </div>
      </details>

      <details className="doll-titles">
        <summary>
          Титули <span className="hint">сумарні бонуси від титулів, як у грі; до {fmt(TITLE_LIMIT)}{titlesSum ? ' · заповнено ' + titlesSum : ''}</span>
        </summary>
        <div className="doll-titles-grid">
          {TITLE_FIELDS.map((f) => (
            <label className="doll-title-f" key={f.code}>
              <span>{f.label}</span>
              <NumInput
                id={'dollTitle-' + f.code}
                label={'Титули: ' + f.label}
                value={Math.round(Number(doc.titles?.[f.code]) || 0)}
                min={0}
                max={TITLE_LIMIT}
                disabled={readOnly}
                onCommit={(n) => api.apply((d) => setTitle(d, f.code, Math.max(0, Math.min(TITLE_LIMIT, Math.round(n)))))}
              />
            </label>
          ))}
        </div>
      </details>
    </section>
  );
}
