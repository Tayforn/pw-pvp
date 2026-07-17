// =========================================================
// Головна: п'єдестал (топ-3) останнього турніру єдиної активної серії +
// велика кнопка реєстрації на найближчий турнір + список найближчих турнірів.
// =========================================================

import { useEffect, useState } from 'react';
import type { Route } from '../app/useRoute';
import PageMeta from '../app/PageMeta';
import type { Tournament, TournamentSeries } from '../data/types';
import { isRegistrationOpen, STATUS_LABELS } from '../data/types';
import { fetchPublicTournaments, subscribeToTournamentChanges } from '../data/tournaments';
import { fetchPodium, type Podium as PodiumData } from '../data/bracket';
import Podium from '../components/Podium';

export default function HomePage({ series, onNavigate }: { series: TournamentSeries[]; onNavigate: (r: Route) => void }) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [latest, setLatest] = useState<Tournament | null>(null);
  const [podium, setPodium] = useState<PodiumData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => fetchPublicTournaments().then(setTournaments).finally(() => setLoading(false));
    load();
    return subscribeToTournamentChanges(load);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function build() {
      const activeSeries = series.find((s) => s.isActive);
      const editions = activeSeries ? tournaments.filter((t) => t.seriesId === activeSeries.id).sort((a, b) => (a.eventDate < b.eventDate ? 1 : -1)) : [];
      // Крон тримає створеним наступний (майбутній) турнір серії, тож
      // найновіший за датою майже ніколи не має результатів — для блоку
      // "Переможці" беремо найсвіжіший турнір, що вже МАЄ п'єдестал.
      // Майбутні дати відсікаємо одразу (у них результатів бути не може);
      // сьогоднішній лишається: не гейтимо на status==='completed' — якщо
      // переможець вирішального матчу вже проставлений, показуємо одразу.
      const todayStr = new Date().toISOString().slice(0, 10);
      const played = editions.filter((t) => t.eventDate <= todayStr);
      let l: Tournament | null = played[0] ?? null;
      let p: PodiumData | null = null;
      for (const t of played) {
        const candidate = await fetchPodium(t.id);
        if (candidate) {
          l = t;
          p = candidate;
          break;
        }
      }
      if (!cancelled) {
        setLatest(l);
        setPodium(p);
      }
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

  const nextOpen = tournaments.filter(isRegistrationOpen).sort((a, b) => (a.eventDate < b.eventDate ? -1 : 1))[0];
  const registerHref = import.meta.env.BASE_URL + 'register' + (nextOpen ? '?t=' + nextOpen.id : '');

  return (
    <div>
      <PageMeta title="PW PvP — турніри сервера" description="Регулярні та одноразові турніри, заявки, сітка, переможці." />
      <div className="section-head">
        <span className="eyebrow">PvP</span>
        <h2>Турніри сервера</h2>
      </div>

      <a className="btn btn-primary btn-lg" href={registerHref} style={{ display: 'inline-block', marginBottom: 24 }}>
        ✍ Зареєструватися
      </a>

      <div className="card" style={{ padding: 20, marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>{latest ? `Переможці: ${latest.name}` : 'Переможці'}</h3>
        {!latest && <p className="hint">Ще не було жодного турніру.</p>}
        {latest && !podium && <span className="badge warn">{STATUS_LABELS[latest.status]}</span>}
        {latest && podium && <Podium podium={podium} caption={latest.eventDate} />}
      </div>

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
