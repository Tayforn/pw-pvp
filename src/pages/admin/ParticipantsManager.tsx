// =========================================================
// Адмінка: список учасників по всій історії турнірів (не по одному турніру,
// як RegistrationsPanel) — кількість заявок, призові місця, перейменування/
// об'єднання ніків (перейменування на вже наявний нік — і є об'єднання).
// =========================================================

import { useEffect, useState } from 'react';
import { errorMessage, reportError } from '../../app/errorMessage';
import { subscribeToTournamentChanges } from '../../data/tournaments';
import { fetchParticipantStats, renameParticipant, type ParticipantStat } from '../../data/participants';

export default function ParticipantsManager() {
  const [stats, setStats] = useState<ParticipantStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => fetchParticipantStats().then(setStats).catch(reportError).finally(() => setLoading(false));
  useEffect(() => {
    reload();
    return subscribeToTournamentChanges(reload);
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

  const cols = 'minmax(140px,2fr) 90px 160px 170px';

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
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            style={{
              display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '10px 18px',
              borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--text-mute)',
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}
          >
            <span>Нік</span>
            <span>Заявок</span>
            <span>Призові місця</span>
            <span />
          </div>
          {filtered.map((s) => (
            <div
              key={s.nickname}
              style={{ display: 'grid', gridTemplateColumns: renaming === s.nickname ? '1fr' : cols, gap: 10, alignItems: 'center', padding: '10px 18px', borderBottom: '1px solid var(--line)' }}
            >
              {renaming === s.nickname ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
                    style={{ flex: 1, padding: '7px 10px', borderRadius: 'var(--radius)', background: 'var(--bg-3)', color: 'var(--text)', border: '1px solid var(--accent)' }}
                  />
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={confirmRename}>OK</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setRenaming(null)}>Скасувати</button>
                </div>
              ) : (
                <>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nickname}</span>
                  <span className="hint" style={{ margin: 0 }}>{s.registrations}</span>
                  <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {s.wins > 0 && <span className="badge good" title="1-ші місця">🥇 {s.wins}</span>}
                    {s.second > 0 && <span className="badge mute" title="2-гі місця">🥈 {s.second}</span>}
                    {s.third > 0 && <span className="badge mute" title="3-тi місця">🥉 {s.third}</span>}
                    {!s.wins && !s.second && !s.third && <span className="hint" style={{ margin: 0 }}>—</span>}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => startRename(s.nickname)}>
                    ✎ Перейменувати / об'єднати
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
