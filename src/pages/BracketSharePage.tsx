// =========================================================
// Сітка турніру за посиланням «Поділитися» (/t/:id/bracket): назва, дата,
// статус, сама сітка з живим оновленням і під нею згорнуті «Склади команд»
// (фул-рандом) та «Правила та призи» — без шапки сайту, меню, футера й
// посилань кудись далі. Відкривається будь-кому, і без входу:
// посилання дають саме для того, щоб сітку бачили й не свої.
// =========================================================

import PageMeta from '../app/PageMeta';
import { useTournamentLive } from '../app/useTournamentLive';
import { STATUS_LABELS, effectiveStatus, isBalancedRandom, isBracketParticipant } from '../data/types';
import { useRules } from '../data/rulesStore';
import BracketView from '../components/BracketView';
import { BalancedTeams, RulesPrizes } from './TournamentPage';

export default function BracketSharePage({ id }: { id: string }) {
  // суми балів команд рахуються за версією шкали турніру — підписка на реєстр версій
  useRules();
  const { tournament, registrations, bracket, updatedAt, refreshing, reload } = useTournamentLive(id);

  let body;
  if (tournament === undefined) body = <p className="hint">Завантаження…</p>;
  else if (tournament === null) body = <p className="hint">Турнір не знайдено.</p>;
  else {
    const status = effectiveStatus(tournament);
    // Фул-рандом: у сітці лише назви команд — склад розгортається під нею.
    const teamsFormed = isBalancedRandom(tournament) && registrations.some((r) => isBracketParticipant(tournament, r));
    body = (
      <>
        <PageMeta title={`Сітка: ${tournament.name} — PW PvP`} description={`Турнірна сітка «${tournament.name}» (${tournament.eventDate}).`} />
        <div className="section-head">
          <span className="eyebrow">Сітка · {tournament.eventDate}</span>
          <h2>{tournament.name}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
            <span className={'badge ' + (status === 'completed' ? 'good' : status === 'cancelled' ? 'bad' : 'warn')}>{STATUS_LABELS[status]}</span>
            {updatedAt && <span className="hint" style={{ margin: 0 }}>оновлено о {updatedAt.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</span>}
            <button type="button" className="btn btn-ghost btn-sm" disabled={refreshing} title="Перечитати сітку" onClick={reload}>↻</button>
          </div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <BracketView matches={bracket} registrations={registrations} bracketNewLook={tournament.bracketNewLook} title={tournament.name} />
        </div>
        {teamsFormed && (
          <details className="card" open={tournament.status !== 'completed'} style={{ marginBottom: 18 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Склади команд</summary>
            <div style={{ marginTop: 12 }}>
              <BalancedTeams tournament={tournament} registrations={registrations} />
            </div>
          </details>
        )}
        <RulesPrizes tournament={tournament} collapsed />
      </>
    );
  }

  return (
    <div className="container share-page">
      <main>{body}</main>
    </div>
  );
}
