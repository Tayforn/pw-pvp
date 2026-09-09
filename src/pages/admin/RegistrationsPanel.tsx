// =========================================================
// Адмінка: верифікація заявок конкретного турніру (confirm/reject/delete).
// У балансному фул-рандомі рядок додатково показує клас, компактний гір,
// гір-скор + tier і кнопку «✎» — правка анкети (верифікація без
// скріншотів: адмін перевірив у грі → виправив грейд → скор перерахувався).
// Team-рядки (згенеровані команди) тут не показуються — вони в блоці
// «Команди»; після формування «Відхилити/✕» блокуються.
// =========================================================

import { useEffect, useState } from 'react';
import { errorMessage, reportError } from '../../app/errorMessage';
import type { PlayerGear, Registration, Tournament } from '../../data/types';
import { isBalancedRandom } from '../../data/types';
import { deleteRegistration, fetchRegistrations, setRegistrationStatus, subscribeToTournamentChanges, updateRegistrationGear } from '../../data/tournaments';
import { CLASS_LABELS, computeGearScore, gearSummary, tierFor } from '../../data/gearRules';
import { useRules } from '../../data/rulesStore';
import { rulesVersionFor, teamRows } from '../../data/teams';
import GearFields, { isGearComplete } from '../../components/GearFields';

const STATUS_LABEL: Record<Registration['status'], string> = { pending: 'Очікує', confirmed: 'Підтверджено', rejected: 'Відхилено' };
const STATUS_CLASS: Record<Registration['status'], string> = { pending: 'warn', confirmed: 'good', rejected: 'bad' };

/** Модалка «Анкета: nick» — той самий GearFields, що й у формі гравця. */
function GearModal({ reg, version, onClose, onSaved }: { reg: Registration; version: string; onClose: () => void; onSaved: () => void }) {
  const [gear, setGear] = useState<Partial<PlayerGear>>(reg.gear ?? {});
  const [attack, setAttack] = useState<number | null>(reg.attackLevel);
  const [defense, setDefense] = useState<number | null>(reg.defenseLevel);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const complete = isGearComplete(gear);

  const save = async () => {
    if (!isGearComplete(gear)) return;
    setBusy(true);
    setErr(null);
    try {
      await updateRegistrationGear(reg.id, gear, attack, defense);
      onSaved();
    } catch (e) {
      setErr(errorMessage(e, 'Не вдалося зберегти анкету.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ width: 'min(640px, 100%)' }}>
        <div className="modal-head">
          <h3>Анкета: {reg.nickname}</h3>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <GearFields
            value={gear}
            onChange={setGear}
            attackLevel={attack}
            defenseLevel={defense}
            onExtraChange={(a: number | null, d: number | null) => { setAttack(a); setDefense(d); }}
            rulesVersion={version}
            showScore
          />
          {err && <p className="form-err">{err}</p>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Скасувати</button>
          <button type="button" className="btn btn-primary" disabled={busy || !complete} onClick={save}>Зберегти</button>
        </div>
      </div>
    </div>
  );
}

export default function RegistrationsPanel({ tournament }: { tournament: Tournament }) {
  const tournamentId = tournament.id;
  // скор/tier у рядках рахуються за версією шкали турніру — підписка на реєстр версій
  useRules();
  const [regs, setRegs] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  // Модалка анкети живе тут: живий рефетч не перемонтовує панель, тож
  // напівзаповнена анкета не губиться.
  const [editing, setEditing] = useState<Registration | null>(null);

  const reload = () => fetchRegistrations(tournamentId).then(setRegs).finally(() => setLoading(false));
  useEffect(() => {
    reload();
    // BracketPanel (сусідній компонент нижче) тримає свій ОКРЕМИЙ стан заявок —
    // без підписки підтвердження тут не з'являлося б там, доки не згорнути/
    // розгорнути турнір (ремаунт). Підписка на зміни — і навпаки теж живе.
    return subscribeToTournamentChanges(reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  const balanced = isBalancedRandom(tournament);
  const version = rulesVersionFor(tournament);
  const rows = regs.filter((r) => r.kind === 'player');
  // Після формування команд відхилення/видалення гравця зробило б команду
  // неповною поза алгоритмом — спершу переформувати (або «✎ Замінити»).
  const locked = balanced && teamRows(tournament, regs).length > 0;
  const lockTitle = locked ? 'Спершу переформуй команди' : undefined;
  const substitutedOut = new Set((tournament.balanceStats?.substitutions ?? []).map((s) => s.out));

  if (loading) return <p className="hint">Завантаження заявок…</p>;
  if (rows.length === 0) return <p className="hint">Заявок ще немає.</p>;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {rows.map((r) => {
        const score = r.gear ? computeGearScore(r.gear, version) : null;
        const tier = score !== null ? tierFor(score, version) : null;
        // Вибулий після заміни (RPC ставить rejected) — для адміна «Вибув», а не «Відхилено».
        const statusLabel = balanced && r.status === 'rejected' && substitutedOut.has(r.id) ? 'Вибув' : STATUS_LABEL[r.status];
        return (
          <div key={r.id} style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span>{r.nickname}</span>
              {balanced && (r.gear ? (
                <>
                  <span className="badge mute">{CLASS_LABELS[r.gear.charClass]}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <b>{score}</b>
                    <span className={'badge ' + (tier === 'S' || tier === 'A' ? 'warn' : 'mute')}>{tier}</span>
                  </span>
                </>
              ) : (
                <span className="badge bad">без анкети</span>
              ))}
              <span className="hint" style={{ margin: 0 }}>{r.rulesAck ? 'з правилами ознайомлений' : 'правила НЕ підтверджено'}</span>
              <span className={'badge ' + STATUS_CLASS[r.status]} style={{ marginLeft: 'auto' }}>{statusLabel}</span>
              {balanced && (
                <button type="button" className="btn btn-ghost btn-sm" title="Редагувати анкету спорядження" onClick={() => setEditing(r)}>✎</button>
              )}
              {r.status !== 'confirmed' && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRegistrationStatus(r.id, 'confirmed').then(reload).catch(reportError)}>Підтвердити</button>
              )}
              {r.status !== 'rejected' && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={locked}
                  title={lockTitle}
                  onClick={() => setRegistrationStatus(r.id, 'rejected').then(reload).catch(reportError)}
                >
                  Відхилити
                </button>
              )}
              <button
                type="button"
                className="btn btn-bad btn-sm"
                disabled={locked}
                title={lockTitle}
                onClick={() => confirm(`Видалити заявку «${r.nickname}»?`) && deleteRegistration(r.id).then(reload).catch(reportError)}
              >
                ✕
              </button>
            </div>
            {balanced && r.gear && (
              <span className="hint" style={{ marginTop: 4 }}>{gearSummary(r.gear, version)}</span>
            )}
            {r.memberNicknames && r.memberNicknames.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {r.memberNicknames.map((m, i) => (
                  <span key={i} className="badge mute">{m}</span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {editing && (
        <GearModal
          reg={editing}
          version={version}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}
