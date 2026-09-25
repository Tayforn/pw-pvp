// =========================================================
// ЛЯЛЬКА — чим сет відрізняється від Головного: ті самі похідні числа ядра
// (derivedNumbers) на ЗАПОВНЕНІЙ конфігурації сету — порожні слоти беруться
// з Головного — і без бафів. Саме такі дельти згодом підуть у бали за сети,
// тож панель показує їх один в один, щоб гравець бачив те, що побачить скор.
// =========================================================

import { useMemo } from 'react';
import type { DerivedNumbers } from '../../core/derived';
import { SET_KIND_LABELS, type SetKind } from '../../model/doc';
import { setDelta, type SetDelta } from '../../model/derivedDelta';
import { findSet } from '../../model/hydrate';
import { useEditor } from '../EditorContext';
import { fmt, signed } from './summaryGroups';
import '../doll-panels.css';

export interface DeltaRow {
  key: keyof DerivedNumbers;
  label: string;
  main: string;
  set: string;
  delta: number; // set − main, округлене як у тексті (для знака й кольору)
  deltaText: string;
  focus: boolean; // рядок, за яким сет цього виду й судять
}

interface RowDef {
  key: keyof DerivedNumbers;
  label: string;
  digits?: number; // дробові (атак/сек)
  suffix?: string;
}

// Порядок — від того, що визначає вид сету (ПЗ / ПА / темп), до решти.
// Усі числа тут «більше — краще» (спів — наскільки швидше), тож плюс завжди зелений.
const ROWS: RowDef[] = [
  { key: 'pz', label: 'ПЗ' },
  { key: 'pa', label: 'ПА' },
  { key: 'aps', label: 'Атак/сек', digits: 2 },
  { key: 'channel', label: 'Спів, швидше на', suffix: '%' },
  { key: 'hp', label: 'Здоровʼя' },
  { key: 'physDef', label: 'Фіз. захист' },
  { key: 'magDefAvg', label: 'Маг. захист (сер.)' },
  { key: 'physAtkMax', label: 'Фіз. атака (макс)' },
  { key: 'magAtkMax', label: 'Маг. атака (макс)' },
];

const FOCUS: Record<SetKind, ReadonlyArray<keyof DerivedNumbers>> = {
  pz: ['pz'],
  pa: ['pa'],
  aspd: ['aps', 'channel'],
};

const num = (n: number, r: RowDef): string => (r.digits ? n.toFixed(r.digits) : fmt(n)) + (r.suffix || '');

/**
 * Рядки таблиці «Головний | Сет | Δ» з дельт ядра — чиста функція. Рядки, де
 * обидва значення нульові (спів у воїна, атак/сек без зброї), не показуємо —
 * вони лише шум; рядок виду сету лишається завжди.
 */
export function deltaRows(d: SetDelta, kind?: SetKind): DeltaRow[] {
  const focus = kind ? FOCUS[kind] : [];
  return ROWS.flatMap((r) => {
    const isFocus = focus.includes(r.key);
    if (!isFocus && d.main[r.key] === 0 && d.set[r.key] === 0) return [];
    const delta = d.delta[r.key];
    const rounded = r.digits ? Number(delta.toFixed(r.digits)) : Math.round(delta);
    return [
      {
        key: r.key,
        label: r.label,
        main: num(d.main[r.key], r),
        set: num(d.set[r.key], r),
        delta: rounded,
        deltaText: signed(delta, r.digits) + (rounded && r.suffix ? r.suffix : ''),
        focus: isFocus,
      },
    ];
  });
}

/** Чиста частина панелі — без контексту (для тестів). */
export function SetDeltaView({ d, name, kind }: { d: SetDelta; name?: string; kind?: SetKind }) {
  const rows = deltaRows(d, kind);
  const any = rows.some((r) => r.delta !== 0);
  return (
    <section className="card doll-pn doll-delta" aria-label="Відмінності від Головного">
      <header className="doll-pn-head">
        <h3>Проти Головного</h3>
        {name && <span className="doll-pn-tag">{name}</span>}
        {kind && SET_KIND_LABELS[kind] !== name && <span className="doll-pn-tag mute">{SET_KIND_LABELS[kind]}</span>}
        <span className="doll-pn-note">порожні слоти рахуються як у Головному; без бафів</span>
      </header>
      {!any && <p className="doll-pn-note">Поки що сет нічим не відрізняється від Головного — надінь у нього інші речі.</p>}
      <div className="doll-delta-rows" role="table" aria-label="Головний, сет і різниця">
        <div className="doll-delta-row head" role="row">
          <span className="doll-delta-l" role="columnheader">
            Показник
          </span>
          <span role="columnheader">Головний</span>
          <span role="columnheader">Сет</span>
          <span role="columnheader">Різниця</span>
        </div>
        {rows.map((r) => (
          <div className={'doll-delta-row' + (r.focus ? ' focus' : '')} role="row" key={r.key}>
            <span className="doll-delta-l" role="rowheader">
              {r.label}
            </span>
            <span role="cell">{r.main}</span>
            <span role="cell">{r.set}</span>
            <b role="cell" className={'doll-delta-d ' + (r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : 'zero')}>
              {r.deltaText}
            </b>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Панель дельт сету setId від Головного — дані з контексту редактора; невідомий сет → нічого. */
export function SetDeltaPanel({ setId }: { setId: string }) {
  const api = useEditor();
  const set = findSet(api.model.doc, setId);
  const d = useMemo(() => (set ? setDelta(api.model, setId) : null), [api.model, setId, set]);
  if (!d || !set) return null;
  return <SetDeltaView d={d} name={set.name} kind={set.kind} />;
}

export default SetDeltaPanel;
