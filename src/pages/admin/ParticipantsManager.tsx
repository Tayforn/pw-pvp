// =========================================================
// Адмінка: список учасників по всій історії турнірів (не по одному турніру,
// як RegistrationsPanel) — кількість заявок, призові місця, перейменування/
// об'єднання ніків (перейменування на вже наявний нік — і є об'єднання).
// Колонка «Ело» — рейтинг з матчів фул-рандому (src/data/ratings.ts),
// необов'язкова: якщо не завантажилась, показуємо «—», без alert.
// Дія в рядку — компактна «✎ Змінити» (повна назва — у підказці й aria-label):
// довга «Перейменувати / об'єднати» переносилась на два рядки. Колонка дії —
// auto, кнопка праворуч; рядки — subgrid однієї сітки, тож колонки шапки й
// рядків збігаються.
// =========================================================

import { useEffect, useState, type CSSProperties } from 'react';
import { errorMessage, reportError } from '../../app/errorMessage';
import { subscribeToTournamentChanges } from '../../data/tournaments';
import { fetchParticipantStats, renameParticipant, type ParticipantStat } from '../../data/participants';
import { fetchRatings, ratingOf, type PlayerRating } from '../../data/ratings';

/** 1 гра · 2–4 гри · 5+ ігор (11–14 — ігор). */
function gamesWord(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'гра';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'гри';
  return 'ігор';
}

const eloLabel = (r: PlayerRating | undefined) => (r && r.games > 0 ? `${Math.round(r.rating)} · ${r.games} ${gamesWord(r.games)}` : '—');

/** Колонки таблиці: нік, заявок, Ело, призові місця, дія (auto — під кнопку «✎ Змінити»). */
export const PARTICIPANT_COLS = 'minmax(140px,2fr) 90px 130px 160px auto';
/** Повна назва дії «✎ Змінити» — для підказки, aria-label і заголовка рядка перейменування. */
export const RENAME_TITLE = "Перейменувати або об'єднати з іншим учасником";

/** Рядок таблиці — subgrid сітки картки: колонки спільні з шапкою. */
const ROW: CSSProperties = {
  display: 'grid', gridColumn: '1 / -1', gridTemplateColumns: 'subgrid', alignItems: 'center',
  padding: '10px 18px', borderBottom: '1px solid var(--line)',
};

/** Рядок учасника (поза режимом перейменування) — чиста частина для тестів. */
export function ParticipantRow({ s, rating, onRename }: { s: ParticipantStat; rating: PlayerRating | undefined; onRename(): void }) {
  return (
    <div style={ROW}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nickname}</span>
      <span className="hint" style={{ margin: 0 }}>{s.registrations}</span>
      <span className="hint" style={{ margin: 0, whiteSpace: 'nowrap' }} title="Ело-рейтинг з матчів фул-рандому — вкладка «Звіт балансу»">
        {eloLabel(rating)}
      </span>
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {s.wins > 0 && <span className="badge good" title="1-ші місця">🥇 {s.wins}</span>}
        {s.second > 0 && <span className="badge mute" title="2-гі місця">🥈 {s.second}</span>}
        {s.third > 0 && <span className="badge mute" title="3-тi місця">🥉 {s.third}</span>}
        {!s.wins && !s.second && !s.third && <span className="hint" style={{ margin: 0 }}>—</span>}
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ whiteSpace: 'nowrap', justifySelf: 'end' }}
        title={RENAME_TITLE}
        aria-label={RENAME_TITLE + ': ' + s.nickname}
        onClick={onRename}
      >
        ✎ Змінити
      </button>
    </div>
  );
}

export default function ParticipantsManager() {
  const [stats, setStats] = useState<ParticipantStat[]>([]);
  const [ratings, setRatings] = useState<Map<string, PlayerRating> | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => fetchParticipantStats().then(setStats).catch(reportError).finally(() => setLoading(false));
  // force — на живу зміну кеш fetchRatings (60 с) уже застарілий.
  const reloadRatings = (force = false) => fetchRatings(force).then(setRatings).catch(() => setRatings(null));
  useEffect(() => {
    reload();
    reloadRatings();
    return subscribeToTournamentChanges(() => { reload(); reloadRatings(true); });
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q ? stats.filter((s) => s.nickname.toLowerCase().includes(q)) : stats;

  const startRename = (nickname: string) => {
    setRenaming(nickname);
    setRenameValue(nickname);
  };

  const confirmRename = async () => {
    if (!renaming) return;
    const target = renameValue.trim();
    if (!target || target === renaming) {
      setRenaming(null);
      return;
    }
    const merging = stats.some((s) => s.nickname === target);
    const question = merging
      ? `Об'єднати «${renaming}» з наявним учасником «${target}»? Уся статистика й заявки «${renaming}» перейдуть під нік «${target}» — незворотно.`
      : `Перейменувати «${renaming}» на «${target}»? Змінить нік у ВСІХ його заявках/турнірах.`;
    if (!confirm(question)) return;
    setBusy(true);
    try {
      await renameParticipant(renaming, target);
      setRenaming(null);
      await reload();
    } catch (e) {
      alert(errorMessage(e, "Не вдалося перейменувати/об'єднати учасника."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="field" style={{ maxWidth: 320, marginBottom: 16 }}>
        <span>Пошук</span>
        <input type="text" placeholder="Нік учасника…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      {loading ? (
        <p className="hint">Завантаження…</p>
      ) : filtered.length === 0 ? (
        <p className="hint">{q ? 'Нікого не знайдено.' : 'Учасників ще немає.'}</p>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'grid', gridTemplateColumns: PARTICIPANT_COLS, columnGap: 10 }}>
          <div style={{ ...ROW, fontSize: 12, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <span>Нік</span>
            <span>Заявок</span>
            <span>Ело</span>
            <span>Призові місця</span>
            <span />
          </div>
          {filtered.map((s) =>
            renaming === s.nickname ? (
              <div key={s.nickname} style={ROW}>
                <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="hint" style={{ margin: 0 }}>
                    {RENAME_TITLE}: «{s.nickname}» → новий нік (наявний нік — об'єднання)
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      autoFocus
                      aria-label={'Новий нік для «' + s.nickname + '»'}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
                      style={{ flex: 1, minWidth: 0, padding: '7px 10px', borderRadius: 'var(--radius)', background: 'var(--bg-3)', color: 'var(--text)', border: '1px solid var(--accent)' }}
                    />
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={confirmRename}>OK</button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setRenaming(null)}>Скасувати</button>
                  </div>
                </div>
              </div>
            ) : (
              <ParticipantRow key={s.nickname} s={s} rating={ratings ? ratingOf(ratings, s.nickname) : undefined} onRename={() => startRename(s.nickname)} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
