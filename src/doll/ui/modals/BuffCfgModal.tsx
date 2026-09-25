// =========================================================
// ЛЯЛЬКА — налаштування стану (бафа/дебафа): рівень, сторона світла/темна,
// увімкнення, прибрати з рядка. Порт BuffCfgModal Хелпера на документ: рівень
// і сторона пишуться через model/ops (setBuffLvl/setBuffSide), параметри й
// опис ефектів рахуються тими самими buffVal/buffEffects ядра.
// Стани — лише для перегляду статів персонажа: у скор вони не входять.
// =========================================================

import { buffDesc, buffDisplayName, buffEffects, buffHasSides, buffMaxLevel, buffVal } from '../../core/constants';
import { getBuffById } from '../../core/refdata';
import type { BuffDef } from '../../core/types';
import { buffIconStyle } from '../../data/assets';
import type { BuffCfgRow, CharacterDoc } from '../../model/doc';
import { removeExtraBuff, setBuffLvl, setBuffSide, toggleBuff } from '../../model/ops';
import { useEditor } from '../EditorContext';
import { ModalShell } from './ModalShell';

const DEFAULT_ROW: BuffCfgRow = { on: false, lvl: 10, side: '' };

export function buffRow(doc: CharacterDoc, id: number): BuffCfgRow {
  return doc.buffs?.cfg[String(id)] ?? DEFAULT_ROW;
}

/** Рівень, який реально діє: зі стороною — максимальний, без неї — не вище «звичайного» максимуму. */
export function effectiveBuffLvl(b: BuffDef, row: BuffCfgRow): number {
  const max = buffMaxLevel(b);
  const plainMax = buffHasSides(b) ? Math.max(1, max - 1) : max;
  if (buffHasSides(b) && row.side) return max;
  return Math.max(1, Math.min(plainMax, row.lvl));
}

/** Кнопки рівня як у Хелпері: «−1» зі стороною знімає сторону (стає звичайний максимум), «+1» зі стороною нічого не робить. */
export function stepBuffLvl(doc: CharacterDoc, b: BuffDef, spec: '1' | '-1' | '+1' | 'max'): CharacterDoc {
  const row = buffRow(doc, b.id);
  const max = buffMaxLevel(b);
  const plainMax = buffHasSides(b) ? Math.max(1, max - 1) : max;
  const lvl = effectiveBuffLvl(b, row);
  if (spec === '1') return setBuffLvl(doc, b.id, 1);
  if (spec === 'max') return setBuffLvl(doc, b.id, plainMax);
  if (row.side) return spec === '-1' ? setBuffLvl(doc, b.id, plainMax) : doc;
  return setBuffLvl(doc, b.id, spec === '+1' ? Math.min(plainMax, lvl + 1) : Math.max(1, lvl - 1));
}

/** Параметри бафа на рівні/стороні — ті самі поля й підписи, що в Хелпері. */
export function buffParams(b: BuffDef, lvl: number, side: string): Array<[string, string]> {
  const P = (key: string): number | undefined => (b.lm[key] != null || b.qc[key] != null ? buffVal(b, key, lvl, side) : undefined);
  const out: Array<[string, string]> = [];
  let v: number | undefined;
  if ((v = P('oj_for_fu')) != null) out.push([String(v), 'потрібний рівень']);
  if ((v = P('ve')) != null) out.push([v + ' м', 'дальність']);
  if ((v = P('mp')) != null) out.push([String(v), 'маг. енергія']);
  if ((v = P('channel')) != null) out.push([v + ' сек', 'час активації']);
  if ((v = P('vy')) != null) out.push([v + ' сек', 'призивання']);
  if ((v = P('vw')) != null) out.push([v + ' сек', 'перезарядка']);
  return out;
}

export function BuffCfgModal({ id }: { id: number }) {
  const api = useEditor();
  const { doc, readOnly } = api;
  const close = () => api.closeModal();
  const b = getBuffById(id);
  if (!b) {
    return (
      <ModalShell title="Стан" onClose={close} size="sm">
        <div className="doll-mute">Такого стану немає в довіднику.</div>
      </ModalShell>
    );
  }
  const row = buffRow(doc, id);
  const max = buffMaxLevel(b);
  const hasSides = buffHasSides(b);
  const plainMax = hasSides ? Math.max(1, max - 1) : max;
  const lvl = effectiveBuffLvl(b, row);
  const params = buffParams(b, lvl, row.side);
  const effects = buffEffects(b, lvl, row.side).filter((e) => e.val);
  const isExtra = !!doc.buffs?.extra.includes(id);
  const hasCfg = !!doc.buffs?.cfg[String(id)];
  const step = (spec: '1' | '-1' | '+1' | 'max') => api.apply((d) => stepBuffLvl(d, b, spec));
  const side = (s: 'rs' | 'je') => api.apply((d) => setBuffSide(d, id, row.side === s ? '' : s));

  return (
    <ModalShell
      title={buffDisplayName(b, row.side)}
      onClose={close}
      size="sm"
      className="doll-modal-bcfg"
      foot={
        <>
          {!readOnly && (isExtra || hasCfg) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                api.apply((d) => removeExtraBuff(d, id));
                close();
              }}
            >
              {isExtra ? 'Прибрати з рядка' : 'Скинути'}
            </button>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={close}>
            Готово
          </button>
        </>
      }
    >
      <div className="doll-bcfg-head">
        <span className="doll-bcfg-ic" style={buffIconStyle(b.an)} aria-hidden="true" />
        <div className="doll-bcfg-name">
          <span className="doll-bcfg-lvl">
            {lvl} ур.{row.side === 'rs' ? ' · світла сторона' : row.side === 'je' ? ' · темна сторона' : ''}
          </span>
        </div>
        <label className="doll-bcfg-on">
          <input type="checkbox" checked={row.on} disabled={readOnly} onChange={() => api.apply((d) => toggleBuff(d, id))} /> увімкнено
        </label>
      </div>

      {params.length > 0 && (
        <div className="doll-bcfg-stats">
          {params.map(([val, label], i) => (
            <div className="doll-bcfg-row" key={i}>
              <b>{val}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="doll-bcfg-desc-box">
        {effects.length ? (
          effects.map((e, i) => (
            <div className="doll-bcfg-desc" key={i}>
              {buffDesc(e.type, e.val)}
            </div>
          ))
        ) : (
          <div className="doll-bcfg-desc doll-mute">без ефекту</div>
        )}
      </div>

      {!readOnly && (
        <div className="doll-bcfg-ctrl" role="group" aria-label="Рівень">
          <button type="button" onClick={() => step('1')} disabled={lvl <= 1 && !row.side}>
            1 ур.
          </button>
          <button type="button" onClick={() => step('-1')} disabled={lvl <= 1 && !row.side} aria-label="Рівень −1">
            −1
          </button>
          <button type="button" onClick={() => step('+1')} disabled={!!row.side || lvl >= plainMax} aria-label="Рівень +1">
            +1
          </button>
          <button type="button" onClick={() => step('max')} disabled={!row.side && lvl >= plainMax}>
            {plainMax} ур.
          </button>
          {hasSides && (
            <>
              <button type="button" className={'doll-bcfg-side light' + (row.side === 'rs' ? ' on' : '')} aria-pressed={row.side === 'rs'} onClick={() => side('rs')}>
                світла
              </button>
              <button type="button" className={'doll-bcfg-side dark' + (row.side === 'je' ? ' on' : '')} aria-pressed={row.side === 'je'} onClick={() => side('je')}>
                темна
              </button>
            </>
          )}
        </div>
      )}
      <div className="doll-bcfg-note">Лише для перегляду статів — у скор не входить.</div>
    </ModalShell>
  );
}

export default BuffCfgModal;
