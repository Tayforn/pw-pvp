// =========================================================
// Адмінка: керування єдиною активною серією (autoWeekday/активність) —
// створення нових серій і видалення прибрано з UI, сайт спрощено до однієї.
// =========================================================

import { reportError } from '../../app/errorMessage';
import type { TournamentSeries } from '../../data/types';
import { WEEKDAY_LABELS } from '../../data/types';
import { updateSeries } from '../../data/tournaments';

// Сайт спрощено до однієї активної серії (публічно вибір серії більше не
// показується) — форму створення нової серії й кнопку видалення прибрано з
// UI, хоча createSeries/deleteSeries лишаються в data/tournaments.ts.
// Унікальність активної серії гарантує частковий унікальний індекс у БД
// (міграція 0013) — дизейбл кнопки "Увімкнути" нижче лише дублює це
// зручною підказкою на клієнті.
export default function SeriesManager({ series, onChanged }: { series: TournamentSeries[]; onChanged: () => void }) {
  return (
    <div>
      <h3>Регулярні серії</h3>
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        {series.length === 0 && <p className="hint" style={{ padding: 16 }}>Серій ще немає.</p>}
        {series.map((s) => {
          const anotherActive = !s.isActive && series.some((x) => x.isActive && x.id !== s.id);
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
              <span>{s.name}</span>
              <span className="hint" style={{ margin: 0 }}>/{s.slug}</span>
              <select
                value={s.autoWeekday ?? ''}
                title="Автостворення турнірів на цей день тижня"
                style={{ fontSize: 12.5, padding: '4px 8px', borderRadius: 8, background: 'var(--bg-3)', color: 'var(--text)', border: '1px solid var(--line-2)' }}
                onChange={(e) => updateSeries(s.id, { autoWeekday: e.target.value === '' ? null : Number(e.target.value) }).then(onChanged).catch(reportError)}
              >
                <option value="">Без автостворення</option>
                {WEEKDAY_LABELS.map((label, i) => (
                  <option key={i} value={i}>Авто: {label}</option>
                ))}
              </select>
              <span className={'badge ' + (s.isActive ? 'good' : 'mute')} style={{ marginLeft: 'auto' }}>{s.isActive ? 'активна' : 'вимкнена'}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={anotherActive}
                title={anotherActive ? 'Активною може бути лише одна серія — спершу вимкни іншу' : ''}
                onClick={() => updateSeries(s.id, { isActive: !s.isActive }).then(onChanged).catch(reportError)}
              >
                {s.isActive ? 'Вимкнути' : 'Увімкнути'}
              </button>
            </div>
          );
        })}
      </div>
      <p className="hint">
        Якщо вказано день — щодня о 03:00 (UTC) перевіряється, чи є вже створений турнір на найближчу таку дату для серії; якщо
        немає, він створюється автоматично (реєстрація одразу відкрита, налаштування копіюються з останнього турніру серії).
      </p>
    </div>
  );
}
