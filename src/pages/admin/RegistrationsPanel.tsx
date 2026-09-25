// =========================================================
// Адмінка: верифікація заявок конкретного турніру (confirm/reject/delete).
// У балансному фул-рандомі рядок додатково показує клас, компактний гір,
// скор (гір + корекція адміна + бонус за Ело) + tier, бейджі корекції та
// Ело і кнопку «✎» — правка анкети й корекції (верифікація без скріншотів:
// адмін перевірив у грі → виправив грейд → скор перерахувався).
// Team-рядки (згенеровані команди) тут не показуються — вони в блоці
// «Команди»; після формування «Відхилити/✕» блокуються.
// =========================================================

import { useEffect, useState } from 'react';
import { errorMessage, reportError } from '../../app/errorMessage';
import type { PlayerGear, Registration, Tournament } from '../../data/types';
import { isBalancedRandom } from '../../data/types';
import { deleteRegistration, fetchRegistrations, setRegistrationStatus, subscribeToTournamentChanges, updateRegistrationAdjust, updateRegistrationGear } from '../../data/tournaments';
import { CLASS_LABELS, gearSummary, tierFor } from '../../data/gearRules';
import { useRules } from '../../data/rulesStore';
import { fetchRatings, ratingOf, type PlayerRating } from '../../data/ratings';
import { rulesVersionFor, scoreBreakdown, teamRows } from '../../data/teams';
import GearFields, { isGearComplete } from '../../components/GearFields';
import TierBadge from '../../components/PlayerPopover';

const STATUS_LABEL: Record<Registration['status'], string> = { pending: 'Очікує', confirmed: 'Підтверджено', rejected: 'Відхилено' };
const STATUS_CLASS: Record<Registration['status'], string> = { pending: 'warn', confirmed: 'good', rejected: 'bad' };

/** «+5» / «−3» / «0» — знак завжди явний, мінус типографський. */
const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);

const clampAdjust = (n: number) => Math.max(-100, Math.min(100, Math.round(n)));

/** Модалка «Анкета: nick» — той самий GearFields, що й у формі гравця,
 * плюс секція «Корекція адміна» (± бали з причиною, 0021). */
function GearModal({ reg, version, teamSize, onClose, onSaved }: { reg: Registration; version: string; teamSize: number | null; onClose: () => void; onSaved: () => void }) {
  const [gear, setGear] = useState<Partial<PlayerGear>>(reg.gear ?? {});
  const [attack, setAttack] = useState<number | null>(reg.attackLevel);
  const [defense, setDefense] = useState<number | null>(reg.defenseLevel);
  // Корекція — рядком, щоб можна було набрати «-» перед числом; парситься на читанні.
  const [adjustStr, setAdjustStr] = useState(String(reg.scoreAdjust ?? 0));
  const [note, setNote] = useState(reg.scoreAdjustNote ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const complete = isGearComplete(gear);
  const adjust = clampAdjust(Number(adjustStr) || 0);
  // Ненульова корекція без причини — не зберігаємо: через місяць ніхто не згадає, за що.
  const noteMissing = adjust !== 0 && !note.trim();
  const adjustChanged = adjust !== (reg.scoreAdjust ?? 0) || note.trim() !== (reg.scoreAdjustNote ?? '');

  const save = async () => {
    if (!isGearComplete(gear) || noteMissing) return;
    setBusy(true);
    setErr(null);
    try {
      await updateRegistrationGear(reg.id, gear, attack, defense);
      if (adjustChanged) await updateRegistrationAdjust(reg.id, reg.tournamentId, adjust, note);
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
            teamSize={teamSize}
            showScore
          />
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontWeight: 600 }}>Корекція адміна</span>
            <div className="field-row">
              <label className="field">
                <span>Бали (−100…100)</span>
                <input type="number" min={-100} max={100} step={1} value={adjustStr} onChange={(e) => setAdjustStr(e.target.value)} />
              </label>
              <label className="field">
                <span>Причина{adjust !== 0 ? ' *' : ''}</span>
                <input
                  type="text"
                  maxLength={200}
                  value={note}
                  required={adjust !== 0}
                  placeholder="напр. досвідчений ПвП-гравець"
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </div>
            {noteMissing && <p className="form-err" style={{ margin: 0 }}>Вкажи причину корекції.</p>}
            <p className="hint" style={{ margin: 0 }}>Додається до скору при жеребці; зберігається в адмінській таблиці — гравцям (і через API) не видно. Для скілу, якого шкала не бачить.</p>
          </div>
          {err && <p className="form-err">{err}</p>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Скасувати</button>
          <button type="button" className="btn btn-primary" disabled={busy || !complete || noteMissing} onClick={save}>Зберегти</button>
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
  // Ело-рейтинги — лише для балансного: входять у скор (scoreBreakdown) і
  // показуються беджем. Не завантажились → скор без рейтингової складової.
  const [ratings, setRatings] = useState<Map<string, PlayerRating> | undefined>(undefined);
  useEffect(() => {
    if (!balanced) return;
    fetchRatings().then(setRatings).catch(() => {
      /* без рейтингу — скор лише з гіру й корекції */
    });
  }, [balanced]);
  const version = rulesVersionFor(tournament);
  const rows = regs.filter((r) => r.kind === 'player');
  // Після формування команд відхилення/видалення гравця зробило б команду
  // неповною поза алгоритмом — спершу переформувати (або «✎ Замінити»).
  const locked = balanced && teamRows(tournament, regs).length > 0;
  const lockTitle = locked ? 'Спершу переформуй команди' : undefined;
  const substitutedOut = new Set((tournament.balanceStats?.substitutions ?? []).map((s) => s.out));
  // Час останньої зміни тексту правил (0027, проставляє БД): заявка, подана
  // раніше, підтверджувала інший текст — адмін бачить бейдж.
  const rulesChangedAt = tournament.ruleFlagsUpdatedAt ? Date.parse(tournament.ruleFlagsUpdatedAt) : NaN;

  if (loading) return <p className="hint">Завантаження заявок…</p>;
  if (rows.length === 0) return <p className="hint">Заявок ще немає.</p>;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {rows.map((r) => {
        // Скор = гір + корекція адміна + бонус за Ело; tier — від того ж
        // підсумку, що йде в жеребку (buildBalanceStats рахує так само).
        const bd = balanced ? scoreBreakdown(r, version, ratings, tournament.teamSize) : null;
        const elo = balanced && ratings ? ratingOf(ratings, r.nickname) : undefined;
        // Вибулий після заміни (RPC ставить rejected) — для адміна «Вибув», а не «Відхилено».
        const statusLabel = balanced && r.status === 'rejected' && substitutedOut.has(r.id) ? 'Вибув' : STATUS_LABEL[r.status];
        return (
          <div key={r.id} style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span>{r.nickname}</span>
              {balanced && (r.gear && bd ? (
                <>
                  <span className="badge mute">{CLASS_LABELS[r.gear.charClass]}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <b title={`гір ${bd.gear} · корекція ${signed(bd.adjust)} · рейтинг ${signed(bd.rating)}`}>{bd.total}</b>
                    <TierBadge
                      info={{
                        nickname: r.nickname, gear: r.gear, tier: tierFor(bd.total, version),
                        admin: {
                          score: bd.total, gearScore: bd.gear, adjust: bd.adjust, rating: bd.rating, adjustNote: r.scoreAdjustNote,
                          elo, attackLevel: r.attackLevel, defenseLevel: r.defenseLevel, version,
                        },
                      }}
                    />
                    {bd.adjust !== 0 && (
                      <span className="badge warn" title={r.scoreAdjustNote ?? 'Корекція адміна'}>{signed(bd.adjust)}</span>
                    )}
                  </span>
                </>
              ) : (
                <span className="badge bad">без анкети</span>
              ))}
              {elo && elo.games > 0 && (
                <span className="badge mute" title={`${elo.wins} перемог`}>Ело {Math.round(elo.rating)} · {elo.games} ігор</span>
              )}
              <span className="hint" style={{ margin: 0 }}>{r.rulesAck ? 'з правилами ознайомлений' : 'правила НЕ підтверджено'}</span>
              {r.characterId && (
                <span
                  className="badge mute"
                  title={`Подано персонажем із ляльки (ревізія ${r.characterRev ?? '?'}); гравець підтвердив, що лялька актуальна${r.dollConfirmedAt ? ' — ' + new Date(r.dollConfirmedAt).toLocaleString('uk-UA') : ''}. Знімок ляльки збережено в заявці.`}
                >
                  з ляльки ✓
                </span>
              )}
              {Number.isFinite(rulesChangedAt) && Date.parse(r.createdAt) < rulesChangedAt && (
                <span className="badge warn" title="Текст правил змінено після подання цієї заявки — гравець підтверджував інший текст">правила змінено після заявки</span>
              )}
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
          teamSize={tournament.teamSize}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}
