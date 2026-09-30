// =========================================================
// ЛЯЛЬКА — картка «Характеристики» (середня колонка B3): у шапці назва
// конфігурації й перемикач «Чисті / У бою»; шість плиток (атака й здоровʼя
// — на дві колонки, ПА і ПЗ виділені), смужка «Стани» і таблиці зведення
// ядра «Атака + Інше | Захист» (атрибути — у своїй картці праворуч).
// «Чисті» — як рахує скор: спорядження, камені, заточка, комплекти, титули й
// пасивки класу, без бафів; «У бою» — ще й бафи/дебафи документа (лише для
// перегляду, у скор не входять). Змінене значення на мить підсвічується:
// зелене — виросло, червоне — впало, як у Хелпері; при перемиканні вкладок
// і режиму це заодно показує різницю.
// =========================================================

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { CharacterDoc } from '../../model/doc';
import { CFG_MAIN, findSet } from '../../model/hydrate';
import { useEditor, type StatsMode } from '../EditorContext';
import { DollCard } from '../DollCard';
import { StatesStrip } from './StatesStrip';
import { calcFor, flashDir, groupCells, heroCells, type CfgCalc, type StatGroup } from './summaryGroups';
import '../doll-panels.css';

const MODES: Array<{ k: StatsMode; label: string; title: string }> = [
  { k: 'clean', label: 'Чисті', title: 'Як рахує скор: без бафів, лише пасивки класу' },
  { k: 'battle', label: 'У бою', title: 'З бафами й дебафами — лише для перегляду, у скор не входять' },
];

export interface StatsPanelViewProps {
  calc: CfgCalc;
  doc: CharacterDoc;
  cfgId: string;
  mode: StatsMode;
  onMode(mode: StatsMode): void;
  /** Смужка «Стани» між плитками й таблицями (у контексті редактора — StatesStrip). */
  states?: ReactNode;
}

/** Чиста частина картки — без контексту редактора (для тестів і повторного використання). */
export function StatsPanelView({ calc, doc, cfgId, mode, onMode, states }: StatsPanelViewProps) {
  const hero = heroCells(calc);
  const groups = groupCells(calc.summary);
  const isMain = cfgId === CFG_MAIN;
  const cfgName = isMain ? 'Головний' : findSet(doc, cfgId)?.name;
  const group = (k: StatGroup['key']) => groups.find((g) => g.key === k);

  // Попередні значення за підписом (не за індексом): порівнюємо після кожного
  // рендера і вішаємо клас анімації лише на змінені комірки.
  const prevRef = useRef<Map<string, string>>(new Map());
  const flash = new Map<string, 'up' | 'down'>();
  const next = new Map<string, string>();
  const track = (k: string, val: string) => {
    next.set(k, val);
    const d = flashDir(prevRef.current.get(k), val);
    if (d) flash.set(k, d);
  };
  for (const h of hero) track('hero:' + h.key, h.val);
  for (const g of groups) for (const c of g.cells) track(c.label, c.val);
  useEffect(() => {
    prevRef.current = next;
  });
  const flashCls = (k: string): string => {
    const d = flash.get(k);
    return d ? ' flash-' + d : '';
  };

  const table = (g: StatGroup | undefined) =>
    g && (
      <section className={'doll-stat-group ' + g.key} key={g.key} aria-label={g.title}>
        <h4>{g.title}</h4>
        <div className="doll-stat-rows">
          {g.cells.map((c) => (
            <div className={'doll-stat' + flashCls(c.label)} key={c.label}>
              <span>{c.label}</span>
              <b key={c.val}>{c.val}</b>
            </div>
          ))}
        </div>
      </section>
    );

  return (
    <DollCard
      title="Характеристики"
      className="doll-pn doll-stats"
      label="Характеристики персонажа"
      extra={
        <>
          {cfgName && <span className="doll-stats-cfg">{cfgName}</span>}
          <div className="doll-seg doll-seg-xs" role="radiogroup" aria-label="Як рахувати характеристики">
            {MODES.map((m) => (
              <button
                key={m.k}
                type="button"
                role="radio"
                aria-checked={mode === m.k}
                className={mode === m.k ? 'is-on' : ''}
                title={m.title}
                onClick={() => onMode(m.k)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </>
      }
    >
      <div className="doll-hero">
        {hero.map((h) => (
          <div className={'doll-hero-cell ' + h.key + (h.wide ? ' wide' : '') + flashCls('hero:' + h.key)} key={h.key}>
            {/* Підпис і значення — сусіди в розмітці; примітка («сер.») — ПІСЛЯ значення,
                угору праворуч її ставить сітка (grid-area) */}
            <span className="doll-hero-l">{h.label}</span>
            {/* key = значення: при зміні елемент перестворюється і анімація грає знову,
                навіть якщо напрям той самий, що й минулого разу */}
            <b className="doll-hero-v" key={h.val}>
              {h.val}
            </b>
            {h.note && <span className="doll-hero-n">{h.note}</span>}
          </div>
        ))}
      </div>
      {states}
      <div className="doll-stat-cols">
        <div className="doll-stat-col">
          {table(group('attack'))}
          {table(group('other'))}
        </div>
        <div className="doll-stat-col">{table(group('defense'))}</div>
      </div>
      <p className="doll-pn-note doll-stats-foot">
        Рахується: спорядження + камені + заточка + бонуси комплектів + титули{calc.passives ? ' + пасивки' : ''}
        {calc.buffed ? ' + стани' : ''}
        {isMain ? '' : '; порожні слоти — як у Головному'}.
      </p>
    </DollCard>
  );
}

/** Картка для конфігурації cfgId (Головний або сет) — дані з контексту редактора. */
export function StatsPanel({ cfgId }: { cfgId: string }) {
  const api = useEditor();
  const battle = api.statsMode === 'battle';
  const calc = useMemo(() => calcFor(api.model, cfgId, battle), [api.model, cfgId, battle]);
  return (
    <StatsPanelView
      calc={calc}
      doc={api.model.doc}
      cfgId={cfgId}
      mode={api.statsMode}
      onMode={api.setStatsMode}
      states={<StatesStrip cfgId={cfgId} />}
    />
  );
}

export default StatsPanel;
