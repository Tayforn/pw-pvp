import { useEffect, useState } from 'react';
import PageMeta from '../app/PageMeta';
import type { BracketMatch, CharClass, Registration, Tournament } from '../data/types';
import { STATUS_LABELS, effectiveStatus, isBalancedRandom, isBracketParticipant, isRegistrationOpen } from '../data/types';
import { fetchRegistrations, fetchTournament, subscribeToTournamentChanges } from '../data/tournaments';
import { fetchBracket } from '../data/bracket';
import { CLASS_LABELS, computeGearScore, gearSummary } from '../data/gearRules';
import { useRules } from '../data/rulesStore';
import { rulesVersionFor, teamMembers, teamRows } from '../data/teams';
import BracketView from '../components/BracketView';

/** Підтверджені гравці фул-рандому з анкетою — без анкети (старі/зламані
 * заявки) до формування не допускаються, тож і публічно їх не показуємо. */
function gearedPlayers(regs: Registration[]): Registration[] {
  return regs.filter((r) => r.kind === 'player' && r.status === 'confirmed' && !!r.gear);
}

/** «Прист 5 · Воїн 4 · …» — за спаданням кількості (видно, кого бракує). */
function classCountsLine(players: Registration[]): string {
  const counts = new Map<CharClass, number>();
  for (const p of players) counts.set(p.gear!.charClass, (counts.get(p.gear!.charClass) ?? 0) + 1);
  return Array.from(counts, ([cls, n]) => ({ cls, n }))
    .sort((a, b) => b.n - a.n || CLASS_LABELS[a.cls].localeCompare(CLASS_LABELS[b.cls], 'uk'))
    .map(({ cls, n }) => `${CLASS_LABELS[cls]} ${n}`)
    .join(' · ');
}

/** Склади команд балансного фул-рандому: картки команд + резерв + рядок
 * довіри (розкид сум, seed, версія правил). Публічно — нік, клас, відповіді
 * анкети і сума гіру КОМАНДИ; персональний скор/tier не показуємо ніколи
 * (число без контексту породжує суперечки, публічна «D» — стигма). */
function BalancedTeams({ tournament, registrations }: { tournament: Tournament; registrations: Registration[] }) {
  const version = rulesVersionFor(tournament);
  // Сума команди — зі знімка формування (balance_stats): там уже враховані
  // корекції адміна й рейтинг на момент жеребки, а заміни оновлюють знімок
  // (RPC substitute_team_member, 0022). Перерахунок з анкет — лише якщо
  // знімка немає (старі турніри): корекцій і рейтингу анонім не бачить.
  const statTotals = new Map((tournament.balanceStats?.teams ?? []).map((x) => [x.name, x.total] as const));
  const teams = teamRows(tournament, registrations).map((team) => {
    const members = teamMembers(team, registrations);
    const total = statTotals.get(team.nickname) ?? members.reduce((sum, m) => sum + (m.gear ? computeGearScore(m.gear, version) : 0), 0);
    return { team, members, total };
  });
  // Резерв — підтверджені з анкетою, кого не взяли в жодну команду.
  const reserve = gearedPlayers(registrations).filter((r) => !r.teamRegistrationId);
  const totals = teams.map((t) => t.total);
  const spread = totals.length ? Math.max(...totals) - Math.min(...totals) : 0;
  const trust = [`Розкид сум балів між командами: ${spread}`];
  if (tournament.balanceSeed) trust.push(`seed ${tournament.balanceSeed}`);
  if (tournament.balanceRulesVersion) trust.push(tournament.balanceRulesVersion);

  return (
    <div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {teams.map(({ team, members, total }) => (
          <div key={team.id} className="card" style={{ padding: 14 }}>
            <b>{team.nickname}</b>
            <span className="hint">сума балів {total}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {members.map((m) => (
                <span key={m.id} className="badge mute">
                  {m.nickname}
                  {m.gear ? ` · ${CLASS_LABELS[m.gear.charClass]}` : ''}
                </span>
              ))}
            </div>
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-mute)' }}>Заявлене спорядження</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                {members.map((m) => (
                  <span key={m.id} className="hint" style={{ margin: 0 }}>
                    {m.nickname} — {m.gear ? gearSummary(m.gear, version) : 'анкети немає'}
                  </span>
                ))}
              </div>
            </details>
          </div>
        ))}
      </div>
      {reserve.length > 0 && (
        <div className="card" style={{ padding: 14, marginTop: 12 }}>
          <b>Резерв ({reserve.length})</b>
          <span className="hint">заміняють тих, хто не з'явиться на старт</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {reserve.map((r) => (
              <span key={r.id} className="badge mute">{r.nickname} · {CLASS_LABELS[r.gear!.charClass]}</span>
            ))}
          </div>
        </div>
      )}
      <span className="hint" style={{ marginTop: 10 }}>{trust.join(' · ')}</span>
    </div>
  );
}

export default function TournamentPage({ id }: { id: string }) {
  // суми гіру команд рахуються за версією шкали турніру — підписка на реєстр версій
  useRules();
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

  const balanced = isBalancedRandom(tournament);
  // Хто йде в сітку: у фул-рандомі — згенеровані team-рядки, інакше —
  // звичайні підтверджені заявки (для соло/готових команд — як і було).
  const confirmed = registrations.filter((r) => isBracketParticipant(tournament, r));
  const status = effectiveStatus(tournament);
  // Фул-рандом до формування команд: список підтверджених гравців з анкетою.
  const players = balanced ? gearedPlayers(registrations) : [];
  const teamsFormed = balanced && confirmed.length > 0;

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
          <span className={'badge ' + (status === 'completed' ? 'good' : status === 'cancelled' ? 'bad' : 'warn')}>{STATUS_LABELS[status]}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={share}>
            {copied ? 'Скопійовано!' : '🔗 Поділитися'}
          </button>
          {isRegistrationOpen(tournament) && (
            <a className="btn btn-primary btn-sm" href={import.meta.env.BASE_URL + 'register?t=' + tournament.id}>
              ✍ Реєстрація
            </a>
          )}
        </div>
        {balanced && (
          <span className="hint" style={{ marginTop: 8 }}>
            Формат: балансний фул-рандом · команди по {tournament.teamSize} · команду формує система випадково після закриття реєстрації
          </span>
        )}
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

      {/* Фул-рандом: після генерації сітки склади команд НЕ ховаємо (у сітці
          лише назви — гравець інакше не знайде свою команду), а згортаємо
          в акордеон під сіткою; для завершеного турніру — одразу згорнутий. */}
      {bracket.length > 0 && teamsFormed && (
        <details className="card" open={tournament.status !== 'completed'} style={{ marginBottom: 18 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Склади команд</summary>
          <div style={{ marginTop: 12 }}>
            <BalancedTeams tournament={tournament} registrations={registrations} />
          </div>
        </details>
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

      {/* Фул-рандом до сітки: сформовані команди картками, а до формування —
          учасники з класами (щоб було видно, кого бракує). */}
      {bracket.length === 0 && balanced && teamsFormed && (
        <>
          <h3>Команди ({confirmed.length})</h3>
          <div style={{ marginBottom: 18 }}>
            <BalancedTeams tournament={tournament} registrations={registrations} />
          </div>
        </>
      )}

      {bracket.length === 0 && balanced && !teamsFormed && (
        <>
          <h3>Учасники ({players.length})</h3>
          <div className="card" style={{ marginBottom: 18 }}>
            {players.length === 0 ? (
              <p className="hint">Ще немає підтверджених учасників.</p>
            ) : (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {players.map((r) => (
                    <span key={r.id} className="badge mute">{r.nickname} · {CLASS_LABELS[r.gear!.charClass]}</span>
                  ))}
                </div>
                <span className="hint" style={{ marginTop: 10 }}>Класи: {classCountsLine(players)}</span>
              </>
            )}
            {(status === 'registration_closed' || status === 'in_progress') && (
              <span className="hint" style={{ marginTop: 10 }}>Команди формуються — з'являться тут.</span>
            )}
          </div>
        </>
      )}

      {bracket.length === 0 && !balanced && (
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
