// =========================================================
// ЛЯЛЬКА — картка «Пасивки класу» у правій колонці (розкладка B3): майстерність
// зброї класу (model/passives.ts). Діють завжди, як у грі, і входять у
// характеристики та скор — тому керування тут, на місці, а не у вікні стану:
// галочка «вивчено», рівень −/N/+, Світла/Темна (повторний клік знімає
// сторону) і короткий ефект («атака луком +90%»). Повний опис — у тултіпі
// іконки. Не налаштовано — 11 рівень зі стороною шляху, без шляху — 10
// (passiveDefault). Класам без пасивок (кастерам) — один рядок.
// Рівень і сторона — ті самі кроки, що у вікні бафа (stepBuffLvl/setBuffSide);
// рівень і ефект показуємо так, як їх бере ядро (buffVal: не вище max).
// =========================================================

import { useMemo, type FocusEvent, type MouseEvent } from 'react';
import { buffDesc, buffDisplayName, buffEffects, buffHasSides, buffMaxLevel } from '../../core/constants';
import { hasRefData } from '../../core/refdata';
import type { BuffDef, DollState } from '../../core/types';
import { buffIconStyle } from '../../data/assets';
import type { CharacterDoc } from '../../model/doc';
import { CFG_MAIN } from '../../model/hydrate';
import { buffRow, setBuffSide, stepBuffLvl, toggleBuff } from '../../model/ops';
import { classPassives } from '../../model/passives';
import { buildBuffTipModel } from '../../model/tipModel';
import { DollCard } from '../DollCard';
import { useEditor } from '../EditorContext';
import { useTip, type TipApi, type TipContent } from '../tip/useTip';
import { calcFor } from './summaryGroups';
import '../doll-panels.css';

/** Код майстерності (gs_oi_<зброя>_av_eg) → коротко, якою зброєю. */
const MASTERY_WEAPON: Record<string, string> = {
  lb: 'клинком',
  gg: 'списом',
  jh: 'молотом',
  wp: 'кастетом',
  ne: 'луком',
  eb: 'кинджалом',
};
const MASTERY_RE = /^gs_oi_([a-z]+)_av_eg$/;

/** Короткий ефект пасивки на рівні/стороні: «атака луком +90%, крит +1%». */
export function passiveShort(b: BuffDef, lvl: number, side: string): string {
  const parts = buffEffects(b, lvl, side)
    .filter((e) => e.val)
    .map((e) => {
      const m = MASTERY_RE.exec(e.type);
      if (m) return 'атака ' + (MASTERY_WEAPON[m[1]] ?? 'зброєю') + ' +' + e.val + '%';
      if (e.type === 'jk') return 'крит +' + e.val + '%';
      return buffDesc(e.type, e.val);
    });
  return parts.length ? parts.join(', ') : 'без ефекту';
}

export interface PassivesCardViewProps {
  doc: CharacterDoc;
  /** Конфігурація Головного (для тултіпа з описом). */
  build: DollState;
  readOnly: boolean;
  tip: Pick<TipApi, 'show' | 'hide' | 'toggle'>;
  apply(fn: (doc: CharacterDoc) => CharacterDoc): void;
}

function PassiveRow({ b, doc, build, readOnly, tip, apply }: PassivesCardViewProps & { b: BuffDef }) {
  const row = buffRow(doc, b.id);
  const max = buffMaxLevel(b);
  const hasSides = buffHasSides(b);
  const plainMax = hasSides ? Math.max(1, max - 1) : max;
  const side = hasSides ? row.side : '';
  // Рівень так, як його бере ядро (buffVal: Math.min(max, row.lvl)) — імпортований рядок зі
  // стороною на 5 рівні діє на 5-му, а не на максимумі. Без сторони — не вище «звичайного»
  // максимуму: рядок з lvl = max без сторони показуємо як plainMax (і ефект для нього),
  // тоді «+» вимкнено, а «−» веде на plainMax − 1 — кнопки не залипають.
  const coreLvl = Math.max(1, Math.min(max, row.lvl));
  const lvl = side ? coreLvl : Math.min(plainMax, coreLvl);
  const name = buffDisplayName(b, side);
  const full = buffEffects(b, lvl, side)
    .filter((e) => e.val)
    .map((e) => buffDesc(e.type, e.val))
    .join('; ');
  const content = (): TipContent => ({ kind: 'buff', model: buildBuffTipModel(build, b) });
  const show = (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => tip.show(e.currentTarget, content());
  const setSide = (s: 'rs' | 'je') => apply((d) => setBuffSide(d, b.id, side === s ? '' : s));
  return (
    <div className={'doll-psv' + (row.on ? '' : ' is-off')}>
      <div className="doll-psv-top">
        <button
          type="button"
          className="doll-psv-ic"
          aria-label={'Опис: ' + name}
          onMouseEnter={show}
          onMouseLeave={tip.hide}
          onFocus={show}
          onBlur={tip.hide}
          onClick={(e) => tip.toggle(e.currentTarget, content())}
        >
          <span className="doll-psv-img" style={buffIconStyle(b.an)} />
        </button>
        <span className="doll-psv-name" title={name}>
          {name}
        </span>
        <label className="doll-psv-learn">
          <input type="checkbox" checked={row.on} disabled={readOnly} onChange={() => apply((d) => toggleBuff(d, b.id))} />
          вивчено
        </label>
      </div>
      <div className="doll-psv-ctl">
        <div className="doll-psv-lvl" role="group" aria-label={'Рівень: ' + name}>
          <button type="button" aria-label="Нижчий рівень" disabled={readOnly || (lvl <= 1 && !side)} onClick={() => apply((d) => stepBuffLvl(d, b, '-1'))}>
            −
          </button>
          <b>{lvl}</b>
          <button type="button" aria-label="Вищий рівень" disabled={readOnly || !!side || lvl >= plainMax} onClick={() => apply((d) => stepBuffLvl(d, b, '+1'))}>
            +
          </button>
        </div>
        {hasSides && (
          <div className="doll-seg doll-seg-xs" role="group" aria-label={'Сторона: ' + name}>
            {(['rs', 'je'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={side === s} className={side === s ? 'is-on' : ''} disabled={readOnly} onClick={() => setSide(s)}>
                {s === 'rs' ? 'Світла' : 'Темна'}
              </button>
            ))}
          </div>
        )}
        <span className="doll-psv-eff" title={full || undefined}>
          {passiveShort(b, lvl, side)}
        </span>
      </div>
    </div>
  );
}

/** Чиста частина картки — без контексту редактора (для тестів). */
export function PassivesCardView(props: PassivesCardViewProps) {
  const ready = hasRefData();
  const list = ready ? classPassives(props.doc.cls) : [];
  return (
    <DollCard
      title="Пасивки класу"
      className="doll-passives"
      extra={list.length > 0 ? <span className="doll-card-pill good">входять у скор</span> : undefined}
    >
      {!ready ? (
        <p className="doll-pn-note">Завантаження пасивок…</p>
      ) : list.length === 0 ? (
        <p className="doll-pn-note">У цього класу пасивок зброї немає.</p>
      ) : (
        <div className="doll-psv-list">
          {list.map((b) => (
            <PassiveRow key={b.id} b={b} {...props} />
          ))}
        </div>
      )}
    </DollCard>
  );
}

export function PassivesCard() {
  const api = useEditor();
  const tip = useTip();
  // Тултіп рахує ефект на конфігурації Головного без бафів — як скор.
  const calc = useMemo(() => calcFor(api.model, CFG_MAIN, false), [api.model]);
  return <PassivesCardView doc={api.doc} build={calc.build} readOnly={api.readOnly} tip={tip} apply={api.apply} />;
}

export default PassivesCard;
