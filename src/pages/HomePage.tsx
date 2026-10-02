// =========================================================
// Головна: п'єдестал (топ-3) найсвіжішого зіграного турніру (серійного чи
// одноразового — без прив'язки до єдиної активної серії) + статистика
// перемог по нікам + велика кнопка реєстрації + список найближчих турнірів.
// =========================================================

import { useEffect, useState } from 'react';
import type { Route } from '../app/useRoute';
import PageMeta from '../app/PageMeta';
import type { Tournament, TournamentSeries } from '../data/types';
import { isRegistrationOpen, STATUS_LABELS } from '../data/types';
import { fetchPublicTournaments, subscribeToTournamentChanges } from '../data/tournaments';
import { fetchPodium, type Podium as PodiumData } from '../data/bracket';
import WinnersCard, { type WinStat } from '../components/WinnersCard';

export default function HomePage({ series, onNavigate }: { series: TournamentSeries[]; onNavigate: (r: Route) => void }) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [latest, setLatest] = useState<Tournament | null>(null);
  const [podium, setPodium] = useState<PodiumData | null>(null);
  const [winStats, setWinStats] = useState<WinStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => fetchPublicTournaments().then(setTournaments).finally(() => setLoading(false));
    load();
    return subscribeToTournamentChanges(load);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function build() {
      // Усі зіграні турніри — і серійні, і одноразові, без прив'язки до
      // єдиної активної серії (раніше "Переможці"/статистика бачили лише
      // турніри активної серії й ігнорували окремі одноразові турніри).
      // Майбутні дати відсікаємо одразу (результатів бути не може);
      // сьогоднішній лишається — якщо переможець вирішального матчу вже
      // проставлений, показуємо одразу, не чекаючи на статус "Завершено".
      const todayStr = new Date().toISOString().slice(0, 10);
      const played = tournaments
        .filter((t) => t.eventDate <= todayStr)
        .sort((a, b) => (a.eventDate < b.eventDate ? 1 : -1));

      const podiums = await Promise.all(played.map((t) => fetchPodium(t.id)));
      if (cancelled) return;

      let l: Tournament | null = played[0] ?? null;
      let p: PodiumData | null = null;
      const decidedIdx = podiums.findIndex((pd) => pd);
      if (decidedIdx !== -1) {
        l = played[decidedIdx];
        p = podiums[decidedIdx];
      }

      // Статистика: нік → кількість турнірних перемог (чемпіонств) по всій
      // історії зіграних турнірів. Згенерована команда фул-рандому (є склад
      // у members.first) — перемога кожному її гравцю; готова команда /
      // соло — як і було, на назву заявки.
      const wins = new Map<string, number>();
      podiums.forEach((pd) => {
        if (!pd) return;
        const credited = pd.members.first && pd.members.first.length > 0 ? pd.members.first : [pd.first];
        for (const n of credited) wins.set(n, (wins.get(n) ?? 0) + 1);
      });
      const stats = Array.from(wins, ([nickname, count]) => ({ nickname, count }))
        .sort((a, b) => b.count - a.count || a.nickname.localeCompare(b.nickname));

      if (!cancelled) {
        setLatest(l);
        setPodium(p);
        setWinStats(stats);
      }
    }
    build();
    return () => {
      cancelled = true;
    };
  }, [tournaments]);

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

  const seriesName = (id: string | null) => series.find((s) => s.id === id)?.name ?? null;

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

      <WinnersCard
        name={latest?.name ?? null}
        eventDate={latest?.eventDate ?? null}
        statusLabel={latest ? STATUS_LABELS[latest.status] : null}
        podium={podium}
        stats={winStats}
        onOpen={latest ? () => onNavigate({ name: 'tournament', id: latest.id }) : null}
      />

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
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name} · {t.eventDate}</span>
                {seriesName(t.seriesId) && <span className="badge mute" style={{ whiteSpace: 'nowrap' }}>{seriesName(t.seriesId)}</span>}
              </span>
              <span className="badge warn" style={{ flex: '0 0 auto' }}>{STATUS_LABELS[t.status]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
