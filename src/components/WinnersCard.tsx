// =========================================================
// Головна: блок «Переможці» — останній зіграний турнір і зал слави.
// Ліворуч — пʼєдестал у стилі сітки турніру (bracket/PodiumStrip): три
// картки 2–1–3, перше місце по центру, вище й золоте, зі складами
// згенерованих команд фул-рандому. Праворуч — «Зал слави»: перемоги за
// ніками по всій історії зіграних турнірів, зі смужками відносно лідера.
// =========================================================

import type { Podium as PodiumData } from '../data/bracket';

export interface WinStat {
  nickname: string;
  count: number;
}

/** Українська форма слова «перемога» (1 / 2–4 / 5+, 11–14 — «перемог»). */
export function winsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'перемога';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'перемоги';
  return 'перемог';
}

/** «2026-09-25» → «25 вересня 2026» (дата турніру без часу — без зсуву часового поясу). */
export function eventDateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS_GEN[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

/** Місяці в родовому відмінку — сталий формат без «р.» від Intl. */
const MONTHS_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

/** Порядок на екрані — класичний пʼєдестал 2–1–3 (на телефоні CSS ставить 1–2–3). */
const PLACES = [
  { key: 'second' as const, n: 2, label: '2 місце' },
  { key: 'first' as const, n: 1, label: 'Чемпіон' },
  { key: 'third' as const, n: 3, label: '3 місце' },
];

const STATS_SHOWN = 10;

export default function WinnersCard({
  name, eventDate, statusLabel, podium, stats, onOpen,
}: {
  /** Назва останнього зіграного турніру; null — турнірів ще не було. */
  name: string | null;
  eventDate: string | null;
  /** Статус турніру, поки переможця не визначено. */
  statusLabel: string | null;
  podium: PodiumData | null;
  stats: WinStat[];
  /** Відкрити сторінку турніру (сітка й результати). */
  onOpen: (() => void) | null;
}) {
  const places = podium ? PLACES.filter((p) => podium[p.key]) : [];
  const top = stats[0]?.count ?? 0;
  const shown = stats.slice(0, STATS_SHOWN);

  return (
    <section className="home-win" aria-label="Переможці">
      <div className="home-win-main">
        <div className="home-win-head">
          <div className="home-win-titles">
            <span className="home-win-eyebrow">Останній турнір</span>
            <h3 className="home-win-name">{name ?? 'Переможці'}</h3>
            {eventDate && <span className="home-win-date">{eventDateLabel(eventDate)}</span>}
          </div>
          {onOpen && (
            <button type="button" className="btn btn-ghost btn-sm home-win-open" onClick={onOpen}>
              Сітка й результати →
            </button>
          )}
        </div>

        {!name && <p className="hint" style={{ margin: 0 }}>Ще не було жодного турніру.</p>}
        {name && !podium && (
          <p className="hint" style={{ margin: 0 }}>
            Переможця ще не визначено{statusLabel ? ` · ${statusLabel.toLowerCase()}` : ''}.
          </p>
        )}

        {podium && (
          <ol className="home-podium" aria-label="Пʼєдестал">
            {places.map((p) => {
              const team = podium[p.key]!;
              const roster = podium.members[p.key] ?? [];
              return (
                <li key={p.key} className={`home-podium-card p${p.n}`} aria-label={`${p.n} місце: ${team}${roster.length ? ` (${roster.join(', ')})` : ''}`}>
                  <span className={`home-medal m${p.n}`} aria-hidden="true">{p.n}</span>
                  <span className="home-podium-place">{p.label}</span>
                  <span className="home-podium-team">{team}</span>
                  {roster.length > 0 && (
                    <span className="home-podium-roster">
                      {roster.map((nick) => <span key={nick} className="home-podium-nick">{nick}</span>)}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <aside className="home-fame" aria-label="Зал слави">
        <div className="home-fame-head">
          <span className="home-win-eyebrow">Зал слави</span>
          <span className="home-fame-sub">перемоги за всі турніри</span>
        </div>
        {shown.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>Перемог ще немає.</p>
        ) : (
          <ol className="home-fame-list">
            {shown.map((s, i) => {
              // однакова кількість перемог — однакове місце (1, 2, 2, 4…)
              const rank = stats.findIndex((x) => x.count === s.count) + 1;
              return (
                <li key={s.nickname} className={'home-fame-row' + (rank <= 3 ? ` r${rank}` : '')}>
                  <span className="home-fame-rank">{rank}</span>
                  <span className="home-fame-body">
                    <span className="home-fame-line">
                      <span className="home-fame-nick">{s.nickname}</span>
                      <span className="home-fame-count">
                        <b>{s.count}</b> {winsWord(s.count)}
                      </span>
                    </span>
                    <span className="home-fame-bar" aria-hidden="true">
                      <span style={{ width: `${top ? Math.max(6, (s.count / top) * 100) : 0}%` }} />
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {stats.length > STATS_SHOWN && <span className="home-fame-more">і ще {stats.length - STATS_SHOWN}</span>}
      </aside>
    </section>
  );
}
