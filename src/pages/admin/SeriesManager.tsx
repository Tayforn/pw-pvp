// =========================================================
// Адмінка: керування єдиною активною серією (autoWeekday/активність).
// Сайт спрощено до однієї серії, тож форма створення з'являється лише
// коли серій немає взагалі (напр. після очищення БД) — інакше базу можна
// було б наповнити лише через SQL-редактор Supabase.
// =========================================================

import { useState } from 'react';
import { errorMessage, reportError } from '../../app/errorMessage';
import type { TournamentSeries } from '../../data/types';
import { WEEKDAY_LABELS } from '../../data/types';
import { createSeries, deleteSeries, updateSeries } from '../../data/tournaments';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яїєіґ]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

// Унікальність активної серії гарантує частковий унікальний індекс у БД
// (міграція 0013) — дизейбл кнопки "Увімкнути" нижче лише дублює це
// зручною підказкою на клієнті.
export default function SeriesManager({ series, onChanged }: { series: TournamentSeries[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [autoWeekday, setAutoWeekday] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    // slug генерується мовчки з назви — окреме поле для нього лише плутало,
    // адже саме id ідентифікує серію технічно, slug потрібен лише для
    // читабельного URL (/series/:slug).
    const slug = slugify(name) || 'series';
    try {
      await createSeries({ slug, name: name.trim(), autoWeekday: autoWeekday === '' ? null : autoWeekday });
      setName('');
      setAutoWeekday('');
      onChanged();
    } catch (e) {
      setErr(errorMessage(e, 'Не вдалося створити серію.'));
    } finally {
      setBusy(false);
    }
  };

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
              <button
                type="button"
                className="btn btn-bad btn-sm"
                onClick={() => confirm(`Видалити серію «${s.name}»? Турніри цієї серії стануть одноразовими.`) && deleteSeries(s.id).then(onChanged).catch(reportError)}
              >
                Видалити
              </button>
            </div>
          );
        })}
      </div>

      {series.length === 0 && (
        <div className="card field-row" style={{ alignItems: 'flex-end' }}>
          <label className="field">
            <span>Назва серії</span>
            <input type="text" value={name} placeholder="Регулярний четверговий турнір" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field" style={{ flex: '0 0 220px' }}>
            <span>Автостворення турнірів (необов'язково)</span>
            <select value={autoWeekday} onChange={(e) => setAutoWeekday(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">— не створювати автоматично —</option>
              {WEEKDAY_LABELS.map((label, i) => (
                <option key={i} value={i}>{label}</option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-primary" disabled={busy || !name.trim()} onClick={add}>+ Додати серію</button>
        </div>
      )}
      {err && <p className="form-err">{err}</p>}
      <p className="hint" style={{ marginTop: 8 }}>
        Якщо вказано день — кожні 2 години перевіряється, чи є вже створений турнір на найближчу таку дату для серії; якщо
        немає, він створюється автоматично (реєстрація одразу відкрита, налаштування копіюються з останнього турніру серії).
      </p>
    </div>
  );
}
