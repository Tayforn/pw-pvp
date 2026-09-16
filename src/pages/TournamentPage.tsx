import { useEffect, useState } from 'react';
import PageMeta from '../app/PageMeta';
import type { BracketMatch, CharClass, Registration, Tier, Tournament } from '../data/types';
import { STATUS_LABELS, effectiveStatus, isBalancedRandom, isBracketParticipant, isRegistrationOpen } from '../data/types';
import { fetchRegistrations, fetchTournament, subscribeToTournamentChanges } from '../data/tournaments';
import { fetchBracket } from '../data/bracket';
import { CLASS_LABELS, computeGearScore, tierFor } from '../data/gearRules';
import { useRules } from '../data/rulesStore';
import { rulesVersionFor, teamMembers, teamRows } from '../data/teams';
import BracketView from '../components/BracketView';
import TierBadge, { type PlayerCardInfo } from '../components/PlayerPopover';

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

/** Публічна картка гравця для бейджа рангу: нік, клас, анкета і ранг — без
 * чисел скору (їх бачить лише адмін). Ранг у сформованих командах — зі
 * знімка жеребки (там урахована корекція й рейтинг, яких анонім не бачить);
 * до формування — з самої анкети. */
function publicInfo(r: Registration, tournament: Tournament, frozenTiers?: Map<string, Tier>): PlayerCardInfo | null {
  if (!r.gear) return null;
  const version = rulesVersionFor(tournament);
  const tier = frozenTiers?.get(r.id) ?? tierFor(computeGearScore(r.gear, version, tournament.teamSize), version);
  return { nickname: r.nickname, gear: r.gear, tier };
}

/** Рядок гравця «як у таблиці» (ті самі колонки, що в адмінці): нік · клас · ранг. */
const COL = { cls: 68, tier: 28 } as const;
function PlayerRow({ reg, info }: { reg: Registration; info: PlayerCardInfo | null }) {
  return (
    <div className="player-row static">
      <span title={reg.nickname} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{reg.nickname}</span>
      {reg.gear ? (
        <span className="badge mute" style={{ width: COL.cls, boxSizing: 'border-box', justifyContent: 'center', padding: '3px 6px', flexShrink: 0 }}>{CLASS_LABELS[reg.gear.charClass]}</span>
      ) : (
        <span className="badge bad">без анкети</span>
      )}
      {info && <TierBadge info={info} width={COL.tier} />}
    </div>
  );
}

/** Склади команд балансного фул-рандому: картки команд + резерв + рядок
 * довіри (розкид сум, seed, версія правил). Публічно — нік, клас, ранг і
 * (у попапі за бейджем рангу) відповіді анкети + сума балів КОМАНДИ;
 * персональний скор числом не показуємо (число без контексту породжує
 * суперечки). */
function BalancedTeams({ tournament, registrations }: { tournament: Tournament; registrations: Registration[] }) {
  const version = rulesVersionFor(tournament);
  const frozenTiers = new Map<string, Tier>();
  for (const team of tournament.balanceStats?.teams ?? []) for (const m of team.members) frozenTiers.set(m.registrationId, m.tier);
  // Сума команди — зі знімка формування (balance_stats): там уже враховані
  // корекції адміна й рейтинг на момент жеребки, а заміни оновлюють знімок
  // (RPC substitute_team_member, 0022). Перерахунок з анкет — лише якщо
  // знімка немає (старі турніри): корекцій і рейтингу анонім не бачить.
  const statTotals = new Map((tournament.balanceStats?.teams ?? []).map((x) => [x.name, x.total] as const));
  const teams = teamRows(tournament, registrations).map((team) => {
    const members = teamMembers(team, registrations);
    const total = statTotals.get(team.nickname) ?? members.reduce((sum, m) => sum + (m.gear ? computeGearScore(m.gear, version, tournament.teamSize) : 0), 0);
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
      <div className="teams-grid">
        {teams.map(({ team, members, total }) => (
          <div key={team.id} className="card team-card">
            <div className="team-card-head">
              <b>{team.nickname}</b>
              <span className="hint" style={{ margin: 0 }}>сума балів {total}</span>
            </div>
            <div className="team-rows">
              {members.map((m) => <PlayerRow key={m.id} reg={m} info={publicInfo(m, tournament, frozenTiers)} />)}
            </div>
          </div>
        ))}
      </div>
      {reserve.length > 0 && (
        <div className="card team-card" style={{ marginTop: 12 }}>
          <div className="team-card-head">
            <b>Резерв ({reserve.length})</b>
            <span className="hint" style={{ margin: 0 }}>заміняють тих, хто не з'явиться на старт</span>
          </div>
          <div className="team-rows">
            {reserve.map((r) => <PlayerRow key={r.id} reg={r} info={publicInfo(r, tournament)} />)}
          </div>
        </div>
      )}
      <span className="hint" style={{ marginTop: 10 }}>{trust.join(' · ')} · натисни на ранг гравця, щоб побачити анкету</span>
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
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setRefreshing(true);
      try {
        const [t, regs, matches] = await Promise.all([fetchTournament(id), fetchRegistrations(id), fetchBracket(id)]);
        if (!alive) return;
        setTournament(t);
        setRegistrations(regs);
        setBracket(matches);
        setUpdatedAt(new Date());
      } finally {
        if (alive) setRefreshing(false);
      }
    };
    load().catch(() => { /* помилка мережі — лишаємо те, що є */ });
    // Телефон заснув → realtime-вебсокет упав, події за цей час втрачено;
    // при поверненні на вкладку перечитуємо все.
    const onWake = () => { if (document.visibilityState === 'visible') load().catch(() => {}); };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    const unsubscribe = subscribeToTournamentChanges(() => { load().catch(() => {}); });
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      unsubscribe();
    };
  }, [id, reloadTick]);

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Сітка</h3>
            {updatedAt && <span className="hint" style={{ margin: 0 }}>оновлено о {updatedAt.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</span>}
            <button type="button" className="btn btn-ghost btn-sm" disabled={refreshing} title="Перечитати сітку" onClick={() => setReloadTick((t) => t + 1)}>↻</button>
          </div>
          <BracketView matches={bracket} registrations={registrations} bracketNewLook={tournament.bracketNewLook} title={tournament.name} />
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
                <div className="participants-grid">
                  {players.map((r) => <PlayerRow key={r.id} reg={r} info={publicInfo(r, tournament)} />)}
                </div>
                <span className="hint" style={{ marginTop: 10 }}>Класи: {classCountsLine(players)} · натисни на ранг гравця, щоб побачити анкету</span>
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
