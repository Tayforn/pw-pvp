import { useEffect, useState } from 'react';
import type { Route } from '../app/useRoute';
import PageMeta from '../app/PageMeta';
import type { Tournament } from '../data/types';
import { STATUS_LABELS, effectiveStatus, isPastTournament, isRegistrationOpen } from '../data/types';
import { fetchPublicTournaments, subscribeToTournamentChanges } from '../data/tournaments';

/** `guest` — не увійшов через Discord: лише минулі турніри + кнопка заявки
 * (це й головна гостя). Поточні турніри бачать свої (app/access.ts). */
export default function TournamentsPage({ onNavigate, guest }: { onNavigate: (r: Route) => void; guest?: boolean }) {
  const [all, setAll] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => fetchPublicTournaments().then(setAll).finally(() => setLoading(false));
    load();
    return subscribeToTournamentChanges(load);
  }, []);

  const tournaments = guest ? all.filter(isPastTournament) : all;
  const nextOpen = all.filter(isRegistrationOpen).sort((a, b) => (a.eventDate < b.eventDate ? -1 : 1))[0];
  const registerHref = import.meta.env.BASE_URL + 'register' + (nextOpen ? '?t=' + nextOpen.id : '');

  return (
    <div>
      <PageMeta title="Турніри — PW PvP" description={guest ? 'Минулі турніри сервера й заявка на наступний.' : 'Усі турніри сервера: минулі й майбутні.'} />
      <div className="section-head">
        <span className="eyebrow">PvP</span>
        <h2>{guest ? 'Минулі турніри' : 'Усі турніри'}</h2>
      </div>
      {guest && (
        <a className="btn btn-primary btn-lg" href={registerHref} style={{ display: 'inline-block', marginBottom: 24 }}>
          ✍ Зареєструватися
        </a>
      )}
      {loading ? (
        <p className="hint">Завантаження…</p>
      ) : tournaments.length === 0 ? (
        <p className="hint">{guest ? 'Минулих турнірів ще немає.' : 'Турнірів ще не створено.'}</p>
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
