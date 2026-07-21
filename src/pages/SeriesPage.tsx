import { useEffect, useState } from 'react';
import type { Route } from '../app/useRoute';
import PageMeta from '../app/PageMeta';
import type { Tournament, TournamentSeries } from '../data/types';
import { STATUS_LABELS, effectiveStatus } from '../data/types';
import { fetchPublicTournaments, fetchSeries } from '../data/tournaments';
import { fetchChampion } from '../data/bracket';
import ChampionBlock from '../components/ChampionBlock';

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
      // Не гейтимо на status==='completed' — показуємо переможця, щойно він
      // проставлений у сітці, навіть якщо формальний статус ще не змінили.
      const champ: Record<string, string | null> = {};
      for (const t of mine) {
        champ[t.id] = await fetchChampion(t.id);
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
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {editions.map((t) => (
            <button
              key={t.id}
              type="button"
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 12,
                padding: 18,
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 15,
                color: 'inherit',
              }}
              onClick={() => onNavigate({ name: 'tournament', id: t.id })}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{t.name}</span>
                {!champions[t.id] && <span className="badge warn">{STATUS_LABELS[effectiveStatus(t)]}</span>}
              </div>
              <span className="hint" style={{ margin: 0 }}>{t.eventDate}</span>
              {champions[t.id] && <ChampionBlock nickname={champions[t.id]!} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
