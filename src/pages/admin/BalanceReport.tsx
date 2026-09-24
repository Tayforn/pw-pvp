// =========================================================
// Адмінка: «Звіт балансу» — чи працює шкала балів фул-рандому + Ело-рейтинг.
//
// Нічого не зберігається: усе рахується на льоту з історії вирішених матчів
// між згенерованими командами (src/data/ratings.ts). Логіка перевірки:
// якщо шкала справді міряє силу, сильніша команда має вигравати частіше за
// половину матчів — і тим упевненіше, чим більша різниця. «Сильніша» — за
// силою (гір + бафи тімейтів), коли бафи рахувались у жеребці, інакше за
// гіром; розкид гіру і розкид сили — двома колонками, бо при рівній силі
// гір розходиться сильніше, і підміна однієї цифри іншою збила б з пантелику.
// Пороги висновку грубі, бо матчів поки мало.
// =========================================================

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { errorMessage } from '../../app/errorMessage';
import { subscribeToTournamentChanges } from '../../data/tournaments';
import {
  RATING_BASE, RATING_K, computeBalanceReport, computeRatings, fetchRatingHistory,
  type BalanceReport as Report, type PlayerRating,
} from '../../data/ratings';

/** Менше матчів з відчутною різницею сум — висновок про шкалу не робимо:
 * балансер сам зводить суми майже врівень, і при різниці в кілька балів ~50 %
 * перемог «сильнішої» — норма, а не помилка шкали. Тому висновок — лише по
 * матчах з різницею ≥ 5 % суми (bigDiff у computeBalanceReport). */
const MIN_DECIDED = 8;
/** Скільки гравців показувати в таблиці рейтингу. */
const TOP_PLAYERS = 50;

const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)} %` : '—');

function verdict(r: Report): { cls: 'good' | 'warn' | 'bad' | 'mute'; text: string } {
  if (r.bigDiffDecided < MIN_DECIDED) return { cls: 'mute', text: `замало матчів з відчутною різницею сум (${r.bigDiffDecided} з ${MIN_DECIDED} потрібних) — висновку поки немає` };
  const rate = r.bigDiffStrongerWon / r.bigDiffDecided;
  if (rate < 0.55) return { cls: 'bad', text: 'шкала майже не передбачає результат — переглянь ваги' };
  if (rate < 0.7) return { cls: 'warn', text: "слабкий зв'язок" };
  return { cls: 'good', text: 'шкала працює' };
}

/** Grid-«таблиця» у стилі ParticipantsManager; на вузьких екранах — горизонтальний скрол. */
function Table({ cols, minWidth, head, rows }: { cols: string; minWidth: number; head: string[]; rows: { key: string; cells: ReactNode[] }[] }) {
  const row: CSSProperties = { display: 'grid', gridTemplateColumns: cols, gap: 10, alignItems: 'center', padding: '10px 18px', borderTop: '1px solid var(--line)' };
  const cell: CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth }}>
        <div style={{ ...row, fontSize: 12, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {head.map((h) => <span key={h}>{h}</span>)}
        </div>
        {rows.map((r) => (
          <div key={r.key} style={row}>
            {r.cells.map((c, i) => <span key={i} style={cell}>{c}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
}

interface Data {
  report: Report;
  /** лише ті, хто зіграв хоч один матч; за рейтингом униз */
  players: PlayerRating[];
  /** усього вирішених матчів в історії (і з невідомими сумами теж) */
  matches: number;
}

export default function BalanceReport() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => fetchRatingHistory()
      .then(({ history, spreads, names }) => {
        if (!alive) return;
        const players = Array.from(computeRatings(history).values())
          .filter((p) => p.games > 0)
          .sort((a, b) => b.rating - a.rating || b.games - a.games || a.nickname.localeCompare(b.nickname));
        setData({ report: computeBalanceReport(history, spreads, names), players, matches: history.length });
        setError(null);
      })
      .catch((e: unknown) => { if (alive) setError(errorMessage(e, 'Не вдалося завантажити історію матчів.')); })
      .finally(() => { if (alive) setLoading(false); });
    load();
    // Живий рефетч на зміни сітки/заявок — як у ParticipantsManager.
    const unsubscribe = subscribeToTournamentChanges(load);
    return () => { alive = false; unsubscribe(); };
  }, []);

  if (loading) return <p className="hint">Завантаження…</p>;
  if (!data) return <p className="form-err">{error ?? 'Не вдалося завантажити історію матчів.'}</p>;
  if (data.matches === 0) return <p className="hint">Ще немає зіграних фул-рандом турнірів.</p>;

  const { report: r, players } = data;
  const v = verdict(r);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <p className="form-err">{error}</p>}

      {/* ── Підсумок ── */}
      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>Чи працює шкала</b>
          <span className={'badge ' + v.cls}>{v.text}</span>
        </div>
        <p style={{ margin: 0 }}>
          Вирішених матчів між командами: <b>{r.decided}</b> · сильніша перемогла: <b>{r.strongerWon}</b> ({pct(r.strongerWon, r.decided)}) · рівних команд: <b>{r.ties}</b>
        </p>
        <p style={{ margin: 0 }}>
          Великі різниці (≥ 5 % сили команди): сильніша перемогла <b>{r.bigDiffStrongerWon}</b> з <b>{r.bigDiffDecided}</b> ({pct(r.bigDiffStrongerWon, r.bigDiffDecided)})
        </p>
        <p className="hint" style={{ margin: 0 }}>
          Сильніша команда — за силою (сила команди = гір + бафи тімейтів), якщо бафи рахувались у жеребці цього турніру; для старіших турнірів — за сумою гіру.
          Якщо шкала справді міряє силу, сильніша має вигравати частіше за половину матчів — і тим упевненіше, чим більша різниця.
          Висновок робиться лише по матчах з різницею ≥ 5 %: балансер сам зводить команди майже врівень, і при різниці в кілька балів ~50 % — норма, а не помилка шкали.
          Матчі рівних команд, баї та турніри, де склади команд не збереглись, не рахуються.
        </p>
      </div>

      {/* ── За турнірами ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px 10px' }}>
          <b>За турнірами</b>
          <p className="hint" style={{ margin: 0 }}>
            Середня різниця — модуль різниці сили (або гіру, якщо бафи не рахувались) команд у вирішених матчах.
            Розкид гіру — max − min сум гіру команд на момент формування; розкид сили — те саме для сили (гір + бафи) з поточного складу команд, «—» — бафи в цій жеребці не рахувались.
            Приклад: гір 474–530 (розкид 56), сила 546–571 (розкид 25) — алгоритм вирівнював силу, тому гір розійшовся сильніше.
          </p>
        </div>
        {r.tournaments.length === 0 ? (
          <p className="hint" style={{ margin: 0, padding: '0 18px 16px' }}>Немає матчів із відомими складами команд.</p>
        ) : (
          <Table
            cols="minmax(160px,2fr) 100px 110px 170px 130px 100px 100px"
            minWidth={900}
            head={['Турнір', 'Дата', 'Матчів', 'Сильніша перемогла', 'Середня різниця', 'Розкид гіру', 'Розкид сили']}
            rows={r.tournaments.map((t) => ({
              key: t.tournamentId,
              cells: [
                <span title={t.tournamentName}>{t.tournamentName}</span>,
                <span style={{ color: 'var(--text-mute)' }}>{t.eventDate}</span>,
                t.ties ? <>{t.decided} <span style={{ color: 'var(--text-mute)' }}>(+{t.ties} рівних)</span></> : t.decided,
                <span title={t.byStrength ? 'за силою: гір + бафи тімейтів' : 'за сумою гіру: бафи в цій жеребці не рахувались'}>
                  {t.strongerWon} з {t.decided} ({pct(t.strongerWon, t.decided)}) <span style={{ color: 'var(--text-mute)' }}>{t.byStrength ? 'за силою' : 'за гіром'}</span>
                </span>,
                t.avgDiff,
                t.spread === null ? '—' : t.spread,
                t.strengthSpread === null ? <span title="бафи в цій жеребці не рахувались">—</span> : Math.round(t.strengthSpread),
              ],
            }))}
          />
        )}
      </div>

      {/* ── Ело ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px 10px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <b>Ело-рейтинг</b>
            <span className="badge mute">гравців {players.length}</span>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            Рейтинг відтворюється з історії матчів фул-рандом турнірів (командне Ело, K={RATING_K}, старт {RATING_BASE}); у скор гравця входить через поля «Балів за 100 Ело» і «Стеля ±» картки «Рейтинг гравців» на вкладці «Шкала балів».
            {players.length > TOP_PLAYERS ? ` Показано ${TOP_PLAYERS} з ${players.length}.` : ''}
          </p>
        </div>
        <Table
          cols="minmax(160px,2fr) 90px 80px 90px"
          minWidth={440}
          head={['Нік', 'Рейтинг', 'Ігор', 'Перемог']}
          rows={players.slice(0, TOP_PLAYERS).map((p) => ({ key: p.nickname, cells: [p.nickname, Math.round(p.rating), p.games, p.wins] }))}
        />
      </div>
    </div>
  );
}
