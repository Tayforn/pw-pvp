// =========================================================
// ЛЯЛЬКА — картка «Атрибути» у правій колонці (розкладка B3). Рядок атрибута:
// назва, «−», поле, «+», праворуч бонус від речей «+97 → 552» (з активної
// вкладки: у сеті інші речі — інші бонуси). Кнопки — крок 1; поле лишається,
// бо 455 очок кліками не набрати. Бюджет рівня тримає clampAttr (як у Хелпері):
// «+» і введення не дають піти в мінус вільних очок, «−» лише зменшує.
// У шапці — «вільних N» (червоне при перевитраті) і «скинути» з підтвердженням.
// Під рядками — шкала збірки: заливка — частка очок у Тілобудові (vitShare),
// риски й підписи ДД / Гібрид / Кон — за порогами шкали балів
// (rules.doll.buildVit), а не жорсткими 25/50 %. Титули — згорнутий блок унизу.
// Поля КЕРОВАНІ: значення завжди з документа (NumInput).
// =========================================================

import { useMemo, type CSSProperties } from 'react';
import { ATTR_BASE, TITLE_FIELDS, TITLE_LIMIT, computeStats } from '../../core/stats';
import { BUILD_LABELS, rulesFor } from '../../../data/gearRules';
import { useRules } from '../../../data/rulesStore';
import type { Build } from '../../../data/types';
import { attrPointsLeft, type CharacterDoc } from '../../model/doc';
import { resetAttrs, setAttr, setTitle } from '../../model/ops';
import { buildOf, vitShare } from '../../model/sheet';
import { DollCard } from '../DollCard';
import { useEditor } from '../EditorContext';
import { NumInput } from '../NumInput';
import '../doll-panels.css';

type AttrKey = 'str' | 'dex' | 'vit' | 'mag';
const ATTRS: Array<{ k: AttrKey; label: string; bonus: string }> = [
  { k: 'str', label: 'Сила', bonus: 'om' },
  { k: 'dex', label: 'Спритність', bonus: 'uy' },
  { k: 'vit', label: 'Тілобудова', bonus: 'lf' },
  { k: 'mag', label: 'Інтелект', bonus: 'tx' },
];
const BUILDS: Build[] = ['dd', 'hybrid', 'con'];

const fmt = (n: number): string => Math.round(n).toLocaleString('uk');
/** Частка 0..1 → «25%» для ширини й позиції на шкалі. */
const pct = (x: number): string => Math.round(Math.max(0, Math.min(1, x)) * 1000) / 10 + '%';

/**
 * Атрибут не може піти в мінус бюджету: якщо нове значення перевищує вільні
 * очки, воно зрізається до максимуму — як у Хелпері (commitAttr).
 */
export function clampAttr(doc: CharacterDoc, k: AttrKey, raw: number): CharacterDoc {
  let v = Math.max(ATTR_BASE, Math.floor(raw) || 0);
  const over = -attrPointsLeft(doc.level, { ...doc.attrs, [k]: v });
  if (over > 0) v = Math.max(ATTR_BASE, v - over);
  return setAttr(doc, k, v);
}

/** Шкала збірки: заливка — частка Тілобудови, риски й підписи — за порогами шкали. */
export function BuildScale({ doc, hybrid, con, build }: { doc: CharacterDoc; hybrid: number; con: number; build: Build }) {
  const share = vitShare(doc);
  // Униз, а не до найближчого: 24,9 % — ще ДД (buildOf порівнює частку з порогом), і напис
  // не має показувати «25 %». Дрібка — проти плаваючої коми (0,29 · 100 = 28,999…).
  const percent = Math.floor(share * 100 + 1e-9);
  // Ширина підписів — від порогів: «ДД» до гібрида, «Гібрид» до кона, «Кон» — решта.
  const cols: CSSProperties = { gridTemplateColumns: 'minmax(0, ' + pct(hybrid) + ') minmax(0, ' + pct(con - hybrid) + ') minmax(0, 1fr)' };
  const aria = 'Збірка: ' + BUILD_LABELS[build] + '; у Тілобудові ' + percent + '% очок; Гібрид — від ' + pct(hybrid) + ', Кон — від ' + pct(con);
  return (
    <div className="doll-build">
      <div className="doll-build-head">
        <b>Збірка: {BUILD_LABELS[build]}</b>
        <span>у Тілобудові {percent} % очок</span>
      </div>
      <div className="doll-build-bar" role="img" aria-label={aria} title={aria}>
        <span className="doll-build-fill" style={{ width: pct(share) }} />
        <i className="doll-build-tick" style={{ left: pct(hybrid) }} />
        <i className="doll-build-tick" style={{ left: pct(con) }} />
      </div>
      <div className="doll-build-labels" style={cols} aria-hidden="true">
        {BUILDS.map((b) => (
          <span key={b} className={b === build ? 'is-on' : ''}>
            {BUILD_LABELS[b]}
          </span>
        ))}
      </div>
    </div>
  );
}

export function AttrsCard() {
  useRules(); // пороги збірки — з поточної шкали; перемалюватись, коли вона довантажиться
  const api = useEditor();
  const { doc, readOnly, activeCfg } = api;
  const build = api.buildOf(activeCfg);
  const t = useMemo(() => computeStats(build).t, [build]);
  const rules = rulesFor(null);
  const avail = attrPointsLeft(doc.level, doc.attrs);
  const clean = ATTRS.every(({ k }) => doc.attrs[k] === ATTR_BASE);
  const titlesSum = TITLE_FIELDS.reduce((n, f) => n + (doc.titles?.[f.code] ? 1 : 0), 0);
  const reset = () => {
    if (window.confirm('Скинути атрибути? Усі чотири стануть по ' + ATTR_BASE + ', очки рівня знову будуть вільні.')) api.apply(resetAttrs);
  };

  return (
    <DollCard
      title="Атрибути"
      className="doll-attrs-card"
      extra={
        <>
          <span
            className={'doll-card-pill' + (avail < 0 ? ' bad' : avail > 0 ? ' warn' : '')}
            title={avail < 0 ? 'Очок роздано більше, ніж дає рівень' : undefined}
          >
            вільних {avail}
          </span>
          {!readOnly && (
            <button type="button" className="doll-card-act" disabled={clean} onClick={reset}>
              скинути
            </button>
          )}
        </>
      }
    >
      <div className="doll-attrs">
        {ATTRS.map(({ k, label, bonus }) => {
          const base = doc.attrs[k];
          const plus = t[bonus] || 0;
          return (
            <div className="doll-attr-row" key={k}>
              <label className="doll-attr-name" htmlFor={'dollAttr-' + k}>
                {label}
              </label>
              <button
                type="button"
                className="doll-step"
                aria-label={label + ': менше'}
                disabled={readOnly || base <= ATTR_BASE}
                onClick={() => api.apply((d) => setAttr(d, k, d.attrs[k] - 1))}
              >
                −
              </button>
              <NumInput
                id={'dollAttr-' + k}
                className="doll-attr-in"
                value={base}
                min={ATTR_BASE}
                max={9999}
                disabled={readOnly}
                onCommit={(n) => api.apply((d) => clampAttr(d, k, n))}
              />
              <button
                type="button"
                className="doll-step"
                aria-label={label + ': більше'}
                disabled={readOnly || avail <= 0}
                onClick={() => api.apply((d) => clampAttr(d, k, d.attrs[k] + 1))}
              >
                +
              </button>
              <span className="doll-attr-bonus" title={plus ? fmt(base) + ' своїх + ' + fmt(plus) + ' від речей = ' + fmt(base + plus) : undefined}>
                {plus ? '+' + fmt(plus) + ' → ' + fmt(base + plus) : ''}
              </span>
            </div>
          );
        })}
      </div>
      {avail < 0 && <p className="doll-avail-over">Роздано більше очок, ніж дає рівень — зменш атрибути.</p>}

      <BuildScale doc={doc} hybrid={rules.doll.buildVit.hybrid} con={rules.doll.buildVit.con} build={buildOf(doc, rules)} />

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
    </DollCard>
  );
}

export default AttrsCard;
