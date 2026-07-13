// =========================================================
// Адмінка: верифікація заявок конкретного турніру (confirm/reject/delete).
// =========================================================

import { useEffect, useState } from 'react';
import { reportError } from '../../app/errorMessage';
import type { Registration } from '../../data/types';
import { deleteRegistration, fetchRegistrations, setRegistrationStatus, subscribeToTournamentChanges } from '../../data/tournaments';

const STATUS_LABEL: Record<Registration['status'], string> = { pending: 'Очікує', confirmed: 'Підтверджено', rejected: 'Відхилено' };
const STATUS_CLASS: Record<Registration['status'], string> = { pending: 'warn', confirmed: 'good', rejected: 'bad' };

export default function RegistrationsPanel({ tournamentId }: { tournamentId: string }) {
  const [regs, setRegs] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = () => fetchRegistrations(tournamentId).then(setRegs).finally(() => setLoading(false));
  useEffect(() => {
    reload();
    // BracketPanel (сусідній компонент нижче) тримає свій ОКРЕМИЙ стан заявок —
    // без підписки підтвердження тут не з'являлося б там, доки не згорнути/
    // розгорнути турнір (ремаунт). Підписка на зміни — і навпаки теж живе.
    return subscribeToTournamentChanges(reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  if (loading) return <p className="hint">Завантаження заявок…</p>;
  if (regs.length === 0) return <p className="hint">Заявок ще немає.</p>;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {regs.map((r) => (
        <div key={r.id} style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>{r.nickname}</span>
            <span className="hint" style={{ margin: 0 }}>{r.rulesAck ? 'з правилами ознайомлений' : 'правила НЕ підтверджено'}</span>
            <span className={'badge ' + STATUS_CLASS[r.status]} style={{ marginLeft: 'auto' }}>{STATUS_LABEL[r.status]}</span>
            {r.status !== 'confirmed' && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRegistrationStatus(r.id, 'confirmed').then(reload).catch(reportError)}>Підтвердити</button>
            )}
            {r.status !== 'rejected' && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRegistrationStatus(r.id, 'rejected').then(reload).catch(reportError)}>Відхилити</button>
            )}
            <button type="button" className="btn btn-bad btn-sm" onClick={() => confirm(`Видалити заявку «${r.nickname}»?`) && deleteRegistration(r.id).then(reload).catch(reportError)}>✕</button>
          </div>
          {r.memberNicknames && r.memberNicknames.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {r.memberNicknames.map((m, i) => (
                <span key={i} className="badge mute">{m}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
