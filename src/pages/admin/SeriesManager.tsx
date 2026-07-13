// =========================================================
// Адмінка: керування регулярними серіями турнірів (Головна/сайдбар
// показують пункт меню на кожну активну серію).
// =========================================================

import { useState } from 'react';
import { errorMessage, reportError } from '../../app/errorMessage';
import type { TournamentSeries } from '../../data/types';
import { createSeries, deleteSeries, updateSeries } from '../../data/tournaments';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яїєіґ]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

export default function SeriesManager({ series, onChanged }: { series: TournamentSeries[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    // slug генерується мовчки з назви — окреме поле для нього лише плутало,
    // адже саме id ідентифікує серію технічно, slug потрібен лише для
    // читабельного URL (/series/:slug). Унікальність: якщо базовий slug вже
    // зайнятий, додаємо -2, -3… (slug має бути unique в БД).
    const base = slugify(name) || 'series';
    let candidate = base;
    let n = 2;
    while (series.some((s) => s.slug === candidate)) {
      candidate = `${base}-${n++}`;
    }
    try {
      await createSeries({ slug: candidate, name: name.trim() });
      setName('');
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
        {series.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
            <span>{s.name}</span>
            <span className="hint" style={{ margin: 0 }}>/{s.slug}</span>
            <span className={'badge ' + (s.isActive ? 'good' : 'mute')} style={{ marginLeft: 'auto' }}>{s.isActive ? 'активна' : 'вимкнена'}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateSeries(s.id, { isActive: !s.isActive }).then(onChanged).catch(reportError)}>
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
        ))}
      </div>

      <div className="card field-row" style={{ alignItems: 'flex-end' }}>
        <label className="field">
          <span>Назва серії</span>
          <input type="text" value={name} placeholder="Регулярний четверговий турнір" onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" disabled={busy || !name.trim()} onClick={add}>+ Додати серію</button>
      </div>
      {err && <p className="form-err">{err}</p>}
    </div>
  );
}
