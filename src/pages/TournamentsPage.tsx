import { useEffect, useState } from 'react';
import type { Route } from '../app/useRoute';
import PageMeta from '../app/PageMeta';
import type { Tournament } from '../data/types';
import { STATUS_LABELS, effectiveStatus } from '../data/types';
import { fetchPublicTournaments, subscribeToTournamentChanges } from '../data/tournaments';

export default function TournamentsPage({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => fetchPublicTournaments().then(setTournaments).finally(() => setLoading(false));
    load();
    return subscribeToTournamentChanges(load);
  }, []);

  return (
    <div>
      <PageMeta title="Турніри — PW PvP" description="Усі турніри сервера: минулі й майбутні." />
      <div className="section-head">
        <span className="eyebrow">PvP</span>
        <h2>Усі турніри</h2>
      </div>
      {loading ? (
        <p className="hint">Завантаження…</p>
      ) : tournaments.length === 0 ? (
        <p className="hint">Турнірів ще не створено.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {tournaments.map((t) => (
            <button
              key={t.id}
              type="button"
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'space-between', borderRadius: 0, border: 0, borderBottom: '1px solid var(--line)' }}
              onClick={() => onNavigate({ name: 'tournament', id: t.id })}
            >
              <span>{t.name} · {t.eventDate}</span>
              {(() => {
                const s = effectiveStatus(t);
                return <span className={'badge ' + (s === 'completed' ? 'good' : s === 'cancelled' ? 'bad' : 'warn')}>{STATUS_LABELS[s]}</span>;
              })()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
