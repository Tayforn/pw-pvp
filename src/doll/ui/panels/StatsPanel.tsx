// =========================================================
// ЛЯЛЬКА — панель характеристик конфігурації: hero-рядок (те, на що дивляться
// першим) + чотири групи зведення ядра. Числа — computeSummary з бафами
// документа лише для перегляду (у скор вони не входять). Змінене значення на
// мить підсвічується: зелене — виросло, червоне — впало, як у Хелпері; при
// перемиканні вкладок це заодно показує, чим сет відрізняється.
// =========================================================

import { useEffect, useMemo, useRef } from 'react';
import type { CharacterDoc } from '../../model/doc';
import { CFG_MAIN, findSet } from '../../model/hydrate';
import { useEditor } from '../EditorContext';
import { calcFor, flashDir, groupCells, heroCells, type CfgCalc, type GroupKey, type StatGroup } from './summaryGroups';
import '../doll-panels.css';

// Порядок груп у розмітці — під колонки CSS (columns ламає потік лише між групами):
// «Атака + Інше» ≈ «Атрибути + Захист» за висотою, тож у дві колонки вони рівні, а в
// три — «Атака | Інше + Атрибути | Захист». В одну колонку CSS повертає звичний
// порядок «Атака, Захист, Атрибути, Інше» через order.
const LAYOUT: GroupKey[] = ['attack', 'other', 'attrs', 'defense'];
const inLayout = (groups: StatGroup[]): StatGroup[] =>
  LAYOUT.flatMap((k) => groups.filter((g) => g.key === k));

export interface StatsPanelViewProps {
  calc: CfgCalc;
  doc: CharacterDoc;
  cfgId: string;
}

/** Чиста частина панелі — без контексту редактора (для тестів і повторного використання). */
export function StatsPanelView({ calc, doc, cfgId }: StatsPanelViewProps) {
  const hero = heroCells(calc);
  const groups = groupCells(calc.summary, doc.attrs);
  const isMain = cfgId === CFG_MAIN;
  const cfgName = isMain ? 'Головний' : findSet(doc, cfgId)?.name;

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

  return (
    <section className="card doll-pn doll-stats" aria-label="Характеристики персонажа">
      <header className="doll-pn-head">
        <h3>Характеристики</h3>
        {cfgName && <span className="doll-pn-tag">{cfgName}</span>}
        {calc.buffed && <span className="doll-pn-tag mute">з бафами</span>}
        <span className="doll-pn-note">
          спорядження + камені + заточка + бонуси комплектів + титули{calc.buffed ? ' + стани' : ''}
          {isMain ? '' : '; порожні слоти — як у Головному'}
        </span>
      </header>
      <div className="doll-hero">
        {hero.map((h) => (
          <div className={'doll-hero-cell ' + h.key + flashCls('hero:' + h.key)} key={h.key}>
            <span className="doll-hero-l">{h.label}</span>
            {/* key = значення: при зміні елемент перестворюється і анімація грає знову,
                навіть якщо напрям той самий, що й минулого разу */}
            <b className="doll-hero-v" key={h.val}>
              {h.val}
            </b>
          </div>
        ))}
      </div>
      <div className="doll-stat-groups">
        {inLayout(groups).map((g) => (
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
        ))}
      </div>
    </section>
  );
}

/** Панель для конфігурації cfgId (Головний або сет) — дані з контексту редактора. */
export function StatsPanel({ cfgId }: { cfgId: string }) {
  const api = useEditor();
  const calc = useMemo(() => calcFor(api.model, cfgId), [api.model, cfgId]);
  return <StatsPanelView calc={calc} doc={api.model.doc} cfgId={cfgId} />;
}

export default StatsPanel;
