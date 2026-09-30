// =========================================================
// ЛЯЛЬКА — смужка «Стани» в картці «Характеристики» (розкладка B3). Залежить
// від перемикача «Чисті / У бою»:
//  • «Чисті» — як рахує скор: бафи вимкнено з розрахунку, тут лише пояснення
//    і «+ баф» / «+ дебаф» (додавання одразу перемикає на «У бою» — інакше
//    гравець не побачив би ефекту, див. BuffPickModal);
//  • «У бою» — рядки бафів і дебафів: курований набір класу (buff-defaults) +
//    додані вручну + увімкнені, як у Хелпері. Клік по іконці — рівень і
//    сторона (вікно BuffCfgModal), галочка — увімкнути, «+» — пошук стану,
//    «Вимкнути всі».
// Стани — поле документа (однакові на всіх вкладках) і лише для перегляду
// статів «в бою»: у скор і в дельти сетів вони не входять. Пасивки класу тут
// не показуються — у них своя картка (PassivesCard), вони діють завжди.
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
import { useEditor, type BuffPickTab, type StatsMode } from '../EditorContext';
import { useTip, type TipApi, type TipContent } from '../tip/useTip';
import { calcFor } from './summaryGroups';
import '../doll-panels.css';

const SIDE_NAME: Record<string, string> = { rs: 'світла сторона', je: 'темна сторона' };

export interface StatesStripViewProps {
  build: DollState; // конфігурація з бафами документа (toDollState … { buffs: true })
  mode: StatsMode;
  readOnly: boolean;
  tip: Pick<TipApi, 'show' | 'hide' | 'toggle' | 'hideAll'>;
  onToggle(id: number): void;
  onCfg(id: number): void;
  /** «+ баф» / «+ дебаф» або «+» у рядку — пошук стану з потрібною вкладкою. */
  onAdd(tab: BuffPickTab): void;
  onAllOff(ids: number[]): void;
}

type SlotProps = Pick<StatesStripViewProps, 'build' | 'readOnly' | 'tip' | 'onToggle' | 'onCfg'> & { b: BuffDef };

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

function BuffRow({ title, list, add, props }: { title: string; list: BuffDef[]; add: { label: string; tab: BuffPickTab }; props: StatesStripViewProps }) {
  return (
    <div className="doll-states-row">
      <span className="doll-states-rl">{title}</span>
      <div className="doll-buffs" role="group" aria-label={title}>
        {list.map((b) => (
          <BuffSlot key={b.id} b={b} build={props.build} readOnly={props.readOnly} tip={props.tip} onToggle={props.onToggle} onCfg={props.onCfg} />
        ))}
        {!props.readOnly && (
          <div className="doll-buff">
            <button type="button" className="doll-buff-ic add" title={add.label} aria-label={add.label} onClick={() => props.onAdd(add.tab)}>
              +
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Чиста частина смужки — без контексту (для тестів). */
export function StatesStripView(props: StatesStripViewProps) {
  const { build, mode, readOnly } = props;
  const ready = hasRefData();
  const passiveIds = new Set((ready ? classPassives(build.cls) : []).map((b) => b.id));
  const onIds = Object.keys(build.buffCfg)
    .filter((k) => build.buffCfg[k]?.on)
    .map(Number)
    .filter((id) => !passiveIds.has(id));
  const battle = mode === 'battle';
  return (
    <div className="doll-states" role="group" aria-label="Стани">
      <div className="doll-states-bar">
        <span className="doll-states-l">Стани</span>
        <span className="doll-states-note">
          {battle
            ? 'Бафи й дебафи — у скор не входять' + (readOnly ? '' : '; іконка — рівень і сторона')
            : 'Бафи вимкнено з розрахунку — так рахує скор'}
        </span>
        {(onIds.length > 0 || (!readOnly && !battle)) && (
          // Праворуч; коли не влазить у рядок — переноситься під пояснення, теж праворуч.
          <span className="doll-states-acts">
            {onIds.length > 0 && (
              <span className={'doll-pn-tag ' + (battle ? 'good' : 'mute')} title={battle ? undefined : 'Діють лише в режимі «У бою»'}>
                увімкнено {onIds.length}
              </span>
            )}
            {!readOnly && battle && onIds.length > 0 && (
              <button type="button" className="doll-states-btn" onClick={() => props.onAllOff(onIds)}>
                Вимкнути всі
              </button>
            )}
            {!readOnly && !battle && (
              <>
                <button type="button" className="doll-states-btn add" onClick={() => props.onAdd('buff')}>
                  + баф
                </button>
                <button type="button" className="doll-states-btn add" onClick={() => props.onAdd('debuff')}>
                  + дебаф
                </button>
              </>
            )}
          </span>
        )}
      </div>
      {battle &&
        (!ready ? (
          <p className="doll-pn-note">Завантаження станів…</p>
        ) : (
          <>
            <BuffRow title="Бафи" list={shownBuffs(build).filter((b) => !passiveIds.has(b.id))} add={{ label: 'Додати баф', tab: 'buff' }} props={props} />
            <BuffRow title="Дебафи" list={shownDebuffs(build)} add={{ label: 'Додати дебаф', tab: 'debuff' }} props={props} />
          </>
        ))}
    </div>
  );
}

/** Смужка станів для конфігурації cfgId — дані й дії з контексту редактора. */
export function StatesStrip({ cfgId }: { cfgId: string }) {
  const api = useEditor();
  const tip = useTip();
  // Рядки бафів — з конфігурації «з бафами»: лише в ній видно, які стани увімкнено.
  const calc = useMemo(() => calcFor(api.model, cfgId, true), [api.model, cfgId]);
  // Вимкнення не зачіпає конфлікти (їх гасить лише вмикання), тож toggle по черзі безпечний.
  const allOff = (ids: number[]) =>
    api.apply((d) => ids.reduce((acc, id) => (acc.buffs?.cfg[String(id)]?.on ? toggleBuff(acc, id) : acc), d));
  return (
    <StatesStripView
      build={calc.build}
      mode={api.statsMode}
      readOnly={api.readOnly}
      tip={tip}
      onToggle={(id) => api.apply((d) => toggleBuff(d, id))}
      onCfg={(id) => api.openBuffCfg(id)}
      onAdd={(tab) => api.openBuffPick(tab)}
      onAllOff={allOff}
    />
  );
}

export default StatesStrip;
