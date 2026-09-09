// =========================================================
// Адмінка: керування сіткою турніру — генерація (seeded шафл
// підтверджених учасників; seed зберігається в tournaments.bracket_seed),
// решафл сітки (доки немає жодного результату — новий seed), видалення
// сітки, і сам редактор сітки (клік по комірці → формат/переможець).
// У балансному фул-рандомі учасники сітки — затверджені team-рядки
// (isBracketParticipant), тож генерація можлива лише після блоку «Команди».
// =========================================================

import { useEffect, useState } from 'react';
import { errorMessage, reportError } from '../../app/errorMessage';
import type { BracketMatch, Registration, Tournament } from '../../data/types';
import { isBalancedRandom, isBracketParticipant } from '../../data/types';
import { fetchRegistrations, setTournamentStatus, subscribeToTournamentChanges } from '../../data/tournaments';
import {
  bracketHasResults,
  deleteBracket,
  fetchBracket,
  generateDoubleEliminationBracket,
  generateSingleEliminationBracket,
  isPowerOfTwo,
  setMatchFormat,
  setMatchWinner,
} from '../../data/bracket';
import { newSeed } from '../../data/balance';
import BracketView from '../../components/BracketView';

export default function BracketPanel({ tournament }: { tournament: Tournament }) {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [bracket, setBracket] = useState<BracketMatch[]>([]);
  const [hasResults, setHasResults] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    const [regs, matches, results] = await Promise.all([
      fetchRegistrations(tournament.id),
      fetchBracket(tournament.id),
      bracketHasResults(tournament.id),
    ]);
    setRegistrations(regs);
    setBracket(matches);
    setHasResults(results);
  };

  useEffect(() => {
    reload();
    // RegistrationsPanel (сусідній компонент вище) тримає свій ОКРЕМИЙ стан —
    // без підписки підтвердження заявки там не відображалось би тут (лічильник
    // "Підтверджених учасників") без згортання/розгортання турніру (ремаунт).
    return subscribeToTournamentChanges(reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament.id]);

  const balanced = isBalancedRandom(tournament);
  // Соло/fixed: підтверджені заявки (усі kind='player'); фул-рандом: team-рядки.
  const confirmed = registrations.filter((r) => isBracketParticipant(tournament, r));

  const isDouble = tournament.bracketType === 'double_elim';

  const generate = async () => {
    setErr(null);
    setBusy(true);
    try {
      // Свіжий seed на кожну генерацію/решафл — інакше з фіксованим seed
      // решафл був би no-op; seed лягає в bracket_seed для відтворюваності.
      const seed = newSeed();
      if (isDouble) await generateDoubleEliminationBracket(tournament.id, confirmed.map((r) => r.id), seed);
      else await generateSingleEliminationBracket(tournament.id, confirmed.map((r) => r.id), tournament.thirdPlaceMatch, seed);
      await reload();
    } catch (e) {
      setErr(errorMessage(e, 'Не вдалося згенерувати сітку.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Видалити сітку? Команди/учасники лишаються, сітку можна згенерувати заново.')) return;
    setErr(null);
    setBusy(true);
    try {
      await deleteBracket(tournament.id);
      await reload();
    } catch (e) {
      setErr(errorMessage(e, 'Не вдалося видалити сітку.'));
    } finally {
      setBusy(false);
    }
  };

  const noTeamsYet = balanced && confirmed.length === 0;
  const canGenerate = !noTeamsYet && (isDouble ? isPowerOfTwo(confirmed.length) : confirmed.length >= 2);

  const finish = () => {
    if (!confirm(`Завершити турнір «${tournament.name}»? Статус одразу стане "Завершено".`)) return;
    setBusy(true);
    setTournamentStatus(tournament.id, 'completed')
      .catch(reportError)
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span className="hint" style={{ margin: 0 }}>{balanced ? 'Підтверджених команд' : 'Підтверджених учасників'}: {confirmed.length}</span>
        {bracket.length > 0 && tournament.status !== 'completed' && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={finish}>
            🏁 Завершити турнір
          </button>
        )}
        {bracket.length === 0 ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || !canGenerate}
            title={noTeamsYet ? 'Спочатку сформуй і затверди команди (блок «Команди» вище).' : ''}
            onClick={generate}
          >
            Згенерувати сітку
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy || hasResults}
              title={hasResults ? 'Уже є зафіксовані результати — решафл заблоковано' : 'Новий посів тих самих учасників (команди не змінюються)'}
              onClick={generate}
            >
              Решафл сітки
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy || hasResults}
              title={hasResults ? 'Уже є зафіксовані результати — видалення заблоковано' : ''}
              onClick={remove}
            >
              Видалити сітку
            </button>
          </>
        )}
      </div>
      {!canGenerate && bracket.length === 0 && (
        <p className="hint">
          {noTeamsYet
            ? 'Спочатку сформуй і затверди команди (блок «Команди» вище).'
            : isDouble
              ? `Подвійна елімінація потребує кількість ${balanced ? 'команд' : 'учасників'} = степінь двійки (4, 8, 16, 32…), без байів.`
              : `Потрібно щонайменше 2 підтверджені ${balanced ? 'команди' : 'учасники'}.`}
        </p>
      )}
      {err && <p className="form-err">{err}</p>}

      <BracketView
        matches={bracket}
        registrations={registrations}
        bracketNewLook={tournament.bracketNewLook}
        editable={{
          onSetFormat: (matchId, format) => setMatchFormat(matchId, format).then(reload).catch(reportError),
          onSetWinner: (matchId, winnerId, score) => setMatchWinner(matchId, winnerId, score).then(reload).catch(reportError),
        }}
      />
    </div>
  );
}
