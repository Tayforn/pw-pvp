// =========================================================
// ЛЯЛЬКА — картка станів (бафи / дебафи) персонажа. Рядок = курований набір
// класу (buff-defaults) + додані вручну + увімкнені — як у Хелпері. Клік по
// іконці — налаштування рівня й сторони (модалка каркаса), чекбокс —
// увімкнути/вимкнути, «+» — пошук стану. Стани тут лише щоб подивитися стати
// «в бою»: у скор і в дельти сетів вони не входять — підпис про це нагадує.
// Окремий рядок — пасивки класу (model/passives.ts): діють завжди й входять у скор.
// Стани — поле документа, а не конфігурації: однакові на всіх вкладках.
// =========================================================

import { useMemo, type FocusEvent, type MouseEvent } from 'react';
import { buffCfgRead, shownBuffs, shownDebuffs } from '../../core/buffs';
import { buffDisplayName, buffHasSides, buffMaxLevel } from '../../core/constants';
import { hasRefData } from '../../core/refdata';
import type { BuffDef, DollState } from '../../core/types';
import { buffIconStyle } from '../../data/assets';
import { toggleBuff } from '../../model/ops';
import { classPassives } from '../../model/passives';
import { buildBuffTipModel } from '../../model/tipModel';
import { useEditor } from '../EditorContext';
import { useTip, type TipApi, type TipContent } from '../tip/useTip';
import { calcFor } from './summaryGroups';
import '../doll-panels.css';

const SIDE_NAME: Record<string, string> = { rs: 'світла сторона', je: 'темна сторона' };

export interface ModsCardViewProps {
  build: DollState; // конфігурація з бафами документа (toDollState … { buffs: true })
  readOnly: boolean;
  tip: Pick<TipApi, 'show' | 'hide' | 'toggle' | 'hideAll'>;
  onToggle(id: number): void;
  onCfg(id: number): void;
  onAdd(): void;
  onAllOff(ids: number[]): void;
}

type SlotProps = Pick<ModsCardViewProps, 'build' | 'readOnly' | 'tip' | 'onToggle' | 'onCfg'> & { b: BuffDef };

function BuffSlot({ b, build, readOnly, tip, onToggle, onCfg }: SlotProps) {
  const cfg = buffCfgRead(build, b.id);
  const max = buffMaxLevel(b);
  const lvl = Math.min(max, cfg.lvl); // ефективний рівень, як у тултіпі
  const side = buffHasSides(b) && SIDE_NAME[cfg.side] ? cfg.side : '';
  const name = buffDisplayName(b, side);
  // Модель тултіпа — лише коли його справді показують, а не на кожен рендер рядка.
  const content = (): TipContent => ({ kind: 'buff', model: buildBuffTipModel(build, b) });
  const show = (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => tip.show(e.currentTarget, content());
  const label = name + (max > 1 ? ', рівень ' + lvl : '') + (side ? ', ' + SIDE_NAME[side] : '') + (cfg.on ? ', увімкнено' : '');
  return (
    <div className={'doll-buff' + (cfg.on ? ' on' : '')}>
      <button
        type="button"
        className="doll-buff-ic"
        aria-label={label}
        onMouseEnter={show}
        onMouseLeave={tip.hide}
        onFocus={show}
        onBlur={tip.hide}
        onClick={(e) => {
          // Лише перегляд — налаштовувати нічого, тож клік (і тап) закріплює опис.
          if (readOnly) {
            tip.toggle(e.currentTarget, content());
            return;
          }
          tip.hideAll();
          onCfg(b.id);
        }}
      >
        <span className="doll-buff-img" style={buffIconStyle(b.an)} />
        {/* Рівень важить лише для увімкненого стану; на решті він був би шумом («10» усюди) */}
        {cfg.on && max > 1 && <span className={'doll-buff-lvl' + (side ? ' ' + side : '')}>{lvl}</span>}
      </button>
      <input
        type="checkbox"
        className="doll-buff-cb"
        checked={cfg.on}
        disabled={readOnly}
        aria-label={(cfg.on ? 'Вимкнути: ' : 'Увімкнути: ') + name}
        title={cfg.on ? 'Вимкнути' : 'Увімкнути'}
        onChange={() => onToggle(b.id)}
      />
    </div>
  );
}

function BuffRow({ title, list, addLabel, props }: { title: string; list: BuffDef[]; addLabel: string | null; props: ModsCardViewProps }) {
  return (
    <div className="doll-mods-row">
      <span className="doll-mods-l">{title}</span>
      <div className="doll-buffs" role="group" aria-label={title}>
        {list.map((b) => (
          <BuffSlot key={b.id} b={b} build={props.build} readOnly={props.readOnly} tip={props.tip} onToggle={props.onToggle} onCfg={props.onCfg} />
        ))}
        {!props.readOnly && addLabel && (
          <div className="doll-buff">
            <button type="button" className="doll-buff-ic add" title={addLabel} aria-label={addLabel} onClick={props.onAdd}>
              +
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Чиста частина картки — без контексту (для тестів). */
export function ModsCardView(props: ModsCardViewProps) {
  const ready = hasRefData();
  const passives = ready ? classPassives(props.build.cls) : [];
  const passiveIds = new Set(passives.map((b) => b.id));
  const buffs = ready ? shownBuffs(props.build).filter((b) => !passiveIds.has(b.id)) : [];
  const debuffs = ready ? shownDebuffs(props.build) : [];
  const onIds = Object.keys(props.build.buffCfg)
    .filter((k) => props.build.buffCfg[k]?.on)
    .map(Number)
    .filter((id) => !passiveIds.has(id));
  return (
    <section className="card doll-pn doll-mods" aria-label="Стани">
      <header className="doll-pn-head">
        <h3>Стани</h3>
        <span className="doll-pn-tag mute">бафи в скор не входять</span>
        {onIds.length > 0 && <span className="doll-pn-tag good">увімкнено {onIds.length}</span>}
        <span className="doll-pn-note">
          лише щоб побачити стати в бою
          {props.readOnly ? '' : ': галочка — увімкнути, іконка — рівень і сторона, «+» — додати'}
        </span>
        {!props.readOnly && onIds.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm doll-pn-act" onClick={() => props.onAllOff(onIds)}>
            Вимкнути всі
          </button>
        )}
      </header>
      {!ready ? (
        <p className="doll-pn-note">Завантаження станів…</p>
      ) : (
        <>
          {passives.length > 0 && (
            <>
              <BuffRow title="Пасивки" list={passives} addLabel={null} props={props} />
              <p className="doll-pn-note">
                Пасивки діють завжди, як у грі, і входять у характеристики та скор. За замовчуванням — 11 рівень зі стороною шляху (без шляху — 10).
                Іконка — рівень і сторона; галочку зніми, якщо пасивку не вивчено.
              </p>
            </>
          )}
          <BuffRow title="Бафи" list={buffs} addLabel="Додати баф" props={props} />
          <BuffRow title="Дебафи" list={debuffs} addLabel="Додати дебаф" props={props} />
        </>
      )}
    </section>
  );
}

/** Картка станів — дані й дії з контексту редактора (рахується на активній конфігурації). */
export function ModsCard() {
  const api = useEditor();
  const tip = useTip();
  const calc = useMemo(() => calcFor(api.model, api.activeCfg), [api.model, api.activeCfg]);
  // Вимкнення не зачіпає конфлікти (їх гасить лише вмикання), тож toggle по черзі безпечний.
  const allOff = (ids: number[]) =>
    api.apply((d) => ids.reduce((acc, id) => (acc.buffs?.cfg[String(id)]?.on ? toggleBuff(acc, id) : acc), d));
  return (
    <ModsCardView
      build={calc.build}
      readOnly={api.readOnly}
      tip={tip}
      onToggle={(id) => api.apply((d) => toggleBuff(d, id))}
      onCfg={(id) => api.openBuffCfg(id)}
      onAdd={() => api.openBuffPick()}
      onAllOff={allOff}
    />
  );
}

export default ModsCard;
