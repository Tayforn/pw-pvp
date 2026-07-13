import { useEffect, useState } from 'react';
import type { Route } from '../app/useRoute';
import PageMeta from '../app/PageMeta';
import type { Tournament, TournamentSeries } from '../data/types';
import { STATUS_LABELS } from '../data/types';
import { fetchPublicTournaments, fetchSeries } from '../data/tournaments';
import { fetchChampion } from '../data/bracket';

export default function SeriesPage({ slug, onNavigate }: { slug: string; onNavigate: (r: Route) => void }) {
  const [series, setSeries] = useState<TournamentSeries | null | undefined>(undefined);
  const [editions, setEditions] = useState<Tournament[]>([]);
  const [champions, setChampions] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const all = await fetchSeries();
      const s = all.find((x) => x.slug === slug) ?? null;
      const tournaments = await fetchPublicTournaments();
      const mine = tournaments.filter((t) => t.seriesId === s?.id).sort((a, b) => (a.eventDate < b.eventDate ? 1 : -1));
      if (cancelled) return;
      setSeries(s);
      setEditions(mine);
      const champ: Record<string, string | null> = {};
      for (const t of mine) {
        if (t.status === 'completed') champ[t.id] = await fetchChampion(t.id);
      }
      if (!cancelled) setChampions(champ);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (series === undefined) return <p className="hint">Завантаження…</p>;
  if (series === null) return <p className="hint">Серію не знайдено.</p>;

  return (
    <div>
      <PageMeta title={`${series.name} — PW PvP`} description={`Історія турнірів серії «${series.name}».`} />
      <div className="section-head">
        <span className="eyebrow">Серія турнірів</span>
        <h2>{series.name}</h2>
      </div>
      {editions.length === 0 ? (
        <p className="hint">Ще не було жодного турніру цієї серії.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {editions.map((t) => (
            <button
              key={t.id}
              type="button"
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'space-between', borderRadius: 0, border: 0, borderBottom: '1px solid var(--line)', flexWrap: 'wrap', gap: 8 }}
              onClick={() => onNavigate({ name: 'tournament', id: t.id })}
            >
              <span>{t.name} · {t.eventDate}</span>
              {t.status === 'completed' ? (
                champions[t.id] ? <span className="badge good">🏆 {champions[t.id]}</span> : <span className="hint">без переможця</span>
              ) : (
                <span className="badge warn">{STATUS_LABELS[t.status]}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
