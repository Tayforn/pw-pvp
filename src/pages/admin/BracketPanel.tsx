// =========================================================
// Адмінка: керування сіткою турніру — генерація (рандомний шафл
// підтверджених учасників), решафл (доки немає жодного результату),
// і сам редактор сітки (клік по комірці → формат/переможець).
// =========================================================

import { useEffect, useState } from 'react';
import { errorMessage, reportError } from '../../app/errorMessage';
import type { BracketMatch, Registration, Tournament } from '../../data/types';
import { fetchRegistrations, subscribeToTournamentChanges } from '../../data/tournaments';
import {
  bracketHasResults,
  fetchBracket,
  generateDoubleEliminationBracket,
  generateSingleEliminationBracket,
  isPowerOfTwo,
  setMatchFormat,
  setMatchWinner,
} from '../../data/bracket';
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

  const confirmed = registrations.filter((r) => r.status === 'confirmed');

  const isDouble = tournament.bracketType === 'double_elim';

  const generate = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (isDouble) await generateDoubleEliminationBracket(tournament.id, confirmed.map((r) => r.id));
      else await generateSingleEliminationBracket(tournament.id, confirmed.map((r) => r.id), tournament.thirdPlaceMatch);
      await reload();
    } catch (e) {
      setErr(errorMessage(e, 'Не вдалося згенерувати сітку.'));
    } finally {
      setBusy(false);
    }
  };

  const canGenerate = isDouble ? isPowerOfTwo(confirmed.length) : confirmed.length >= 2;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span className="hint" style={{ margin: 0 }}>Підтверджених учасників: {confirmed.length}</span>
        {bracket.length === 0 ? (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !canGenerate} onClick={generate}>
            Згенерувати сітку
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy || hasResults}
            title={hasResults ? 'Уже є зафіксовані результати — решафл заблоковано' : ''}
            onClick={generate}
          >
            Решафл
          </button>
        )}
      </div>
      {!canGenerate && bracket.length === 0 && (
        <p className="hint">
          {isDouble
            ? 'Подвійна елімінація потребує кількість учасників = степінь двійки (4, 8, 16, 32…), без байів.'
            : 'Потрібно щонайменше 2 підтверджені учасники.'}
        </p>
      )}
      {err && <p className="form-err">{err}</p>}

      <BracketView
        matches={bracket}
        registrations={registrations}
        editable={{
          onSetFormat: (matchId, format) => setMatchFormat(matchId, format).then(reload).catch(reportError),
          onSetWinner: (matchId, winnerId, score) => setMatchWinner(matchId, winnerId, score).then(reload).catch(reportError),
        }}
      />
    </div>
  );
}
