import { useEffect, useState } from 'react';
import PageMeta from '../app/PageMeta';
import type { BracketMatch, Registration, Tournament } from '../data/types';
import { STATUS_LABELS } from '../data/types';
import { fetchRegistrations, fetchTournament, subscribeToTournamentChanges } from '../data/tournaments';
import { fetchBracket } from '../data/bracket';
import BracketView from '../components/BracketView';

export default function TournamentPage({ id }: { id: string }) {
  const [tournament, setTournament] = useState<Tournament | null | undefined>(undefined);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [bracket, setBracket] = useState<BracketMatch[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [t, regs, matches] = await Promise.all([fetchTournament(id), fetchRegistrations(id), fetchBracket(id)]);
      setTournament(t);
      setRegistrations(regs);
      setBracket(matches);
    };
    load();
    return subscribeToTournamentChanges(load);
  }, [id]);

  if (tournament === undefined) return <p className="hint">Завантаження…</p>;
  if (tournament === null) return <p className="hint">Турнір не знайдено.</p>;

  const confirmed = registrations.filter((r) => r.status === 'confirmed');

  const share = () => {
    navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <PageMeta title={`${tournament.name} — PW PvP`} description={tournament.rulesMd ?? undefined} />
      <div className="section-head">
        <span className="eyebrow">Турнір · {tournament.eventDate}</span>
        <h2>{tournament.name}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
          <span className={'badge ' + (tournament.status === 'completed' ? 'good' : tournament.status === 'cancelled' ? 'bad' : 'warn')}>
            {STATUS_LABELS[tournament.status]}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={share}>
            {copied ? 'Скопійовано!' : '🔗 Поділитися'}
          </button>
          {tournament.status === 'registration_open' && (
            <a className="btn btn-primary btn-sm" href={import.meta.env.BASE_URL + 'register?t=' + tournament.id}>
              ✍ Реєстрація
            </a>
          )}
        </div>
      </div>

      {/* Коли сітка вже згенерована — вона головний контент сторінки,
          тож іде першою, а правила/призи опускаються під неї. До генерації
          порядок звичний: правила → учасники → заглушка сітки внизу. */}
      {bracket.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <h3>Сітка</h3>
          <BracketView matches={bracket} registrations={registrations} bracketNewLook={tournament.bracketNewLook} />
        </div>
      )}

      {/* Після завершення турніру правила/призи вже не актуальні — ховаємо
          їх у згорнутий <details>-акордеон, щоб не займали місце під сіткою
          (кому треба — розгорне). Для активних турнірів картка як була. */}
      {(tournament.rulesMd || tournament.prizesMd) && (() => {
        const grid = (
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: tournament.rulesMd && tournament.prizesMd ? '1fr 1fr' : '1fr' }}>
            {tournament.rulesMd && (
              <div>
                <h4 style={{ marginTop: 0 }}>Правила</h4>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{tournament.rulesMd}</p>
              </div>
            )}
            {tournament.prizesMd && (
              <div>
                <h4 style={{ marginTop: 0 }}>Призи</h4>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{tournament.prizesMd}</p>
              </div>
            )}
          </div>
        );
        return tournament.status === 'completed' ? (
          <details className="card" style={{ marginBottom: 18 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              {tournament.rulesMd && tournament.prizesMd ? 'Правила та призи' : tournament.rulesMd ? 'Правила' : 'Призи'}
            </summary>
            <div style={{ marginTop: 12 }}>{grid}</div>
          </details>
        ) : (
          <div className="card" style={{ marginBottom: 18 }}>{grid}</div>
        );
      })()}

      {bracket.length === 0 && (
        <>
          <h3>{tournament.teamSize ? `Команди (${confirmed.length})` : `Учасники (${confirmed.length})`}</h3>
          <div className="card" style={{ marginBottom: 18 }}>
            {confirmed.length === 0 ? (
              <p className="hint">Ще немає підтверджених учасників.</p>
            ) : tournament.teamSize ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {confirmed.map((r) => (
                  <div key={r.id}>
                    <b>{r.nickname}</b>
                    {r.memberNicknames && r.memberNicknames.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {r.memberNicknames.map((m, i) => (
                          <span key={i} className="badge mute">{m}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {confirmed.map((r) => (
                  <span key={r.id} className="badge mute">{r.nickname}</span>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {bracket.length === 0 && (
        <>
          <h3>Сітка</h3>
          <BracketView matches={bracket} registrations={registrations} bracketNewLook={tournament.bracketNewLook} />
        </>
      )}
    </div>
  );
}
