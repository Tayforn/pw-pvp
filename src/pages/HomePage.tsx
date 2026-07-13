// =========================================================
// Головна: блок на кожну активну регулярну серію (результат останньої
// завершеної edition, або статус найближчої) + список найближчих турнірів.
// =========================================================

import { useEffect, useState } from 'react';
import type { Route } from '../app/useRoute';
import PageMeta from '../app/PageMeta';
import type { Tournament, TournamentSeries } from '../data/types';
import { STATUS_LABELS } from '../data/types';
import { fetchPublicTournaments, subscribeToTournamentChanges } from '../data/tournaments';
import { fetchChampion } from '../data/bracket';

interface SeriesBlock {
  series: TournamentSeries;
  latest: Tournament | null;
  champion: string | null;
}

export default function HomePage({ series, onNavigate }: { series: TournamentSeries[]; onNavigate: (r: Route) => void }) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [blocks, setBlocks] = useState<SeriesBlock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => fetchPublicTournaments().then(setTournaments).finally(() => setLoading(false));
    load();
    return subscribeToTournamentChanges(load);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function build() {
      const active = series.filter((s) => s.isActive);
      const result: SeriesBlock[] = [];
      for (const s of active) {
        const editions = tournaments.filter((t) => t.seriesId === s.id).sort((a, b) => (a.eventDate < b.eventDate ? 1 : -1));
        const latest = editions[0] ?? null;
        const champion = latest && latest.status === 'completed' ? await fetchChampion(latest.id) : null;
        result.push({ series: s, latest, champion });
      }
      if (!cancelled) setBlocks(result);
    }
    build();
    return () => {
      cancelled = true;
    };
  }, [series, tournaments]);

  // "Найближчі" = ще не минулі (дата >= сьогодні) АБО вже триває — застарілий
  // registration_closed/registration_open з датою в минулому (адмін не
  // перевів статус далі) сюди не потрапляє.
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = tournaments
    .filter((t) => t.status === 'in_progress' || ((t.status === 'registration_open' || t.status === 'registration_closed') && t.eventDate >= today))
    .sort((a, b) => (a.eventDate < b.eventDate ? -1 : 1))
    .slice(0, 6);

  return (
    <div>
      <PageMeta title="PW PvP — турніри сервера" description="Регулярні та одноразові турніри, заявки, сітка, переможці." />
      <div className="section-head">
        <span className="eyebrow">PvP</span>
        <h2>Турніри сервера</h2>
        <p>Заявки на турніри, сітка і результати регулярних змагань.</p>
      </div>

      {blocks.length > 0 && (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', marginBottom: 24 }}>
          {blocks.map(({ series: s, latest, champion }) => (
            <div key={s.id} className="card" style={{ padding: 20 }}>
              <h3 style={{ marginTop: 0 }}>{s.name}</h3>
              {!latest && <p className="hint">Ще не було жодного турніру цієї серії.</p>}
              {latest && latest.status === 'completed' && (
                <>
                  <p className="hint" style={{ marginBottom: 8 }}>{latest.name} · {latest.eventDate}</p>
                  {champion ? <p className="badge good">🏆 Чемпіон: {champion}</p> : <p className="hint">Переможець ще не визначений.</p>}
                </>
              )}
              {latest && latest.status !== 'completed' && (
                <>
                  <p className="hint" style={{ marginBottom: 8 }}>{latest.name} · {latest.eventDate}</p>
                  <span className="badge warn">{STATUS_LABELS[latest.status]}</span>
                </>
              )}
              {latest && (
                <div style={{ marginTop: 14 }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate({ name: 'series', slug: s.slug })}>
                    Історія серії →
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <h3>Найближчі турніри</h3>
      {loading ? (
        <p className="hint">Завантаження…</p>
      ) : upcoming.length === 0 ? (
        <p className="hint">Зараз немає активних турнірів.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {upcoming.map((t) => (
            <button
              key={t.id}
              type="button"
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'space-between', borderRadius: 0, border: 0, borderBottom: '1px solid var(--line)' }}
              onClick={() => onNavigate({ name: 'tournament', id: t.id })}
            >
              <span>{t.name} · {t.eventDate}</span>
              <span className="badge warn">{STATUS_LABELS[t.status]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
