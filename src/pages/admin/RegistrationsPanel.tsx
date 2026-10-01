// =========================================================
// Адмінка: верифікація заявок конкретного турніру (confirm/reject/delete).
// У балансному фул-рандомі рядок додатково показує клас, компактний гір,
// скор (гір + корекція адміна + бонус за Ело) + tier, бейджі корекції та
// Ело і кнопку «✎» — правка анкети й корекції (верифікація без скріншотів:
// адмін перевірив у грі → виправив грейд → скор перерахувався).
//
// Скор v2 «від речей» (0032): заявка персонажем несе item_points, які
// порахував клієнт гравця, тож до перерахунку зі знімка ляльки в адмінці
// рядок — «не перевірено» (кнопка «↻ зі знімка»; підтвердження заявки
// перераховує само; «Перерахувати всі» — у блоці «Команди»). Рядки без
// item_points у турнірі, де вони вже є, — «таблиця» (скор з анкети). У модалці
// ✎ для v2-рядків анкета не редагується (лялька визначила грейди з речей):
// лише корекція адміна, розклад по речах і перерахунок.
// Team-рядки (згенеровані команди) тут не показуються — вони в блоці
// «Команди»; після формування «Відхилити/✕» блокуються.
// =========================================================

import { useEffect, useState } from 'react';
import { errorMessage, reportError } from '../../app/errorMessage';
import type { PlayerGear, Registration, Tournament } from '../../data/types';
import { isBalancedRandom } from '../../data/types';
import { deleteRegistration, fetchRegistrations, setRegistrationStatus, subscribeToTournamentChanges, updateRegistrationAdjust, updateRegistrationGear } from '../../data/tournaments';
import { CLASS_LABELS, classPointsFor, gearSummary, gemMixLabel, registrationScore, rulesFor, tierFor } from '../../data/gearRules';
import { useRules } from '../../data/rulesStore';
import { fetchRatings, ratingOf, type PlayerRating } from '../../data/ratings';
import { NO_SNAPSHOT_HINT, canRecalc, recalcRegistration, recalcSummary } from '../../data/itemPointsRecalc';
import { hasItemPointsRows, isUnverifiedV2, rulesVersionFor, scoreBreakdown, teamRows } from '../../data/teams';
import GearFields, { isGearComplete } from '../../components/GearFields';
import TierBadge from '../../components/PlayerPopover';
import ScoreBreakdown, { fmtPoints, setNamesOf } from '../../components/ScoreBreakdown';
import { weaponAbilityName } from '../../data/weaponAbilities';

const STATUS_LABEL: Record<Registration['status'], string> = { pending: 'Очікує', confirmed: 'Підтверджено', rejected: 'Відхилено' };
const STATUS_CLASS: Record<Registration['status'], string> = { pending: 'warn', confirmed: 'good', rejected: 'bad' };

/** «+5» / «−3» / «0» — знак завжди явний, мінус типографський. */
const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);

const clampAdjust = (n: number) => Math.max(-100, Math.min(100, Math.round(n)));

type ItemNameResolver = (catId: number, slot: string) => string | null;
/** Назви речей для розкладів — з каталогу ляльки: модуль перерахунку (окремий
 * чанк) довантажує потрібні категорії лише тут, в адмінці. */
const loadRecompute = () => import('../../doll/recompute');

/** Стан перерахунку одного рядка (живе в панелі — спільний для рядка й модалки). */
interface RecalcState { busy?: boolean; msg?: string; err?: string }

const UNVERIFIED_TITLE = 'Бали за речі порахував клієнт гравця — перед жеребкою перерахуй зі знімка ляльки (підтвердження заявки робить це само)';
const CHECKED_TITLE = 'Бали за речі перераховано зі знімка ляльки в адмінці';
const TABLE_TITLE = 'Скор за таблицею анкети — заявка без балів за речі; решта заявок турніру рахується з речей ляльки';

/** Модалка «✎»: для заявки зі скором v2 — розклад по речах, перерахунок і
 * «Корекція адміна» (± бали з причиною, 0021); для старої анкети — той самий
 * GearFields, що й у формі гравця, плюс корекція. */
function RegModal({ reg, tournament, version, recalc, itemName, onRecalc, onClose, onSaved }: {
  reg: Registration; tournament: Tournament; version: string; recalc: RecalcState | undefined; itemName?: ItemNameResolver;
  onRecalc: () => void; onClose: () => void; onSaved: () => void;
}) {
  const v2 = reg.itemPoints != null;
  const [gear, setGear] = useState<Partial<PlayerGear>>(reg.gear ?? {});
  const [attack, setAttack] = useState<number | null>(reg.attackLevel);
  const [defense, setDefense] = useState<number | null>(reg.defenseLevel);
  // Корекція — рядком, щоб можна було набрати «-» перед числом; парситься на читанні.
  const [adjustStr, setAdjustStr] = useState(String(reg.scoreAdjust ?? 0));
  const [note, setNote] = useState(reg.scoreAdjustNote ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // v2-рядок: анкету не редагуємо (грейди визначила лялька), тож повнота анкети не умова.
  const complete = v2 || isGearComplete(gear);
  const adjust = clampAdjust(Number(adjustStr) || 0);
  // Ненульова корекція без причини — не зберігаємо: через місяць ніхто не згадає, за що.
  const noteMissing = adjust !== 0 && !note.trim();
  const adjustChanged = adjust !== (reg.scoreAdjust ?? 0) || note.trim() !== (reg.scoreAdjustNote ?? '');

  const rules = rulesFor(version);
  const teamSize = tournament.teamSize;
  const score = registrationScore(reg, rules, teamSize);
  const b = reg.itemBreakdown;

  const save = async () => {
    if (!complete || noteMissing) return;
    setBusy(true);
    setErr(null);
    try {
      if (!v2) {
        if (!isGearComplete(gear)) return;
        await updateRegistrationGear(reg.id, gear, attack, defense);
      }
      if (adjustChanged) await updateRegistrationAdjust(reg.id, reg.tournamentId, adjust, note);
      onSaved();
    } catch (e) {
      setErr(errorMessage(e, 'Не вдалося зберегти.'));
    } finally {
      setBusy(false);
    }
  };

  const recalcHint = !canRecalc(reg)
    ? NO_SNAPSHOT_HINT
    : v2
      ? 'Бали за речі зі збереженого знімка ляльки за версією шкали турніру — результат пишеться в заявку.'
      : 'Заявка зі знімком ляльки, але без балів за речі (подана до 0032): перерахунок переведе її на скор з речей.';

  return (
    // Закривається лише хрестиком і «Скасувати» — клік повз вікно не губить правки.
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-modal="true" style={{ width: 'min(640px, 100%)' }}>
        <div className="modal-head">
          <h3>{v2 ? 'Заявка' : 'Анкета'}: {reg.nickname}</h3>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {v2 && reg.gear ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b>Скор {score ?? '—'}</b>
                <span className="hint" style={{ margin: 0 }}>
                  = клас {classPointsFor(rules, reg.gear.charClass, teamSize)} + речі {fmtPoints(reg.itemPoints!)} + рівень {rules.level[reg.gear.charLevel ?? 'l90_100']} + джин {rules.genie[reg.gear.genie]}
                  {b ? ` · шкала ${b.ver}` : ''}
                </span>
                {isUnverifiedV2(reg) ? (
                  <span className="badge warn" title={UNVERIFIED_TITLE}>не перевірено</span>
                ) : (
                  <span className="badge mute" title={CHECKED_TITLE}>перевірено ✓</span>
                )}
              </div>
              {b ? (
                <ScoreBreakdown breakdown={b} open resolver={itemName} setNames={setNamesOf(reg.characterSnapshot)} />
              ) : (
                <p className="hint">Розкладу по речах у заявці немає — перерахуй зі знімка.</p>
              )}
              <p className="hint">
                Грейди, точку, камені, трактат і кільця лялька визначила з надітих речей — анкета тут не редагується: скор правлять корекцією адміна, розбіжності зі знімком — перерахунком.
              </p>
            </div>
          ) : (
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
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !!recalc?.busy || !canRecalc(reg)} onClick={onRecalc}>
                {recalc?.busy ? 'Рахую…' : 'Перерахувати зі знімка'}
              </button>
              <span className="hint" style={{ margin: 0, flex: '1 1 240px' }}>{recalcHint}</span>
            </div>
            {recalc?.msg && <span className="hint" style={{ margin: 0 }}>{recalc.msg}</span>}
            {recalc?.err && <p className="form-err">{recalc.err}</p>}
          </div>
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
  // Модалка живе тут: живий рефетч не перемонтовує панель, тож напівзаповнена
  // анкета не губиться; рядок для неї береться з поточних заявок (після
  // перерахунку — свіжий розклад), зникла заявка — модалка закривається.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Перерахунок зі знімка (за id заявки): «Рахую…», підсумок або помилка.
  const [recalc, setRecalc] = useState<Record<string, RecalcState>>({});
  // Назви речей для розкладів — коли модуль ляльки з каталогом довантажився.
  const [names, setNames] = useState<{ fn: ItemNameResolver } | null>(null);

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
  // Є заявки зі скором v2 — рядки без нього позначаємо «таблиця».
  const hasV2 = hasItemPointsRows(rows);
  // Категорії каталогу для назв речей у розкладах — лише коли розклади є; нові
  // рядки з розкладом довантажують свої категорії (ключ — id таких рядків).
  const breakdownKey = rows.filter((r) => r.itemBreakdown).map((r) => r.id).join(',');
  useEffect(() => {
    const withBd = rows.filter((r) => r.itemBreakdown);
    if (!withBd.length) return;
    let alive = true;
    loadRecompute()
      .then(async (m) => {
        await m.ensureBreakdownCats({ rows: withBd.flatMap((r) => r.itemBreakdown!.rows) });
        if (alive) setNames({ fn: m.catalogItemName });
      })
      .catch(() => {
        /* без назв — рядки розкладу лише зі слотами */
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakdownKey]);
  // Після формування команд відхилення/видалення гравця зробило б команду
  // неповною поза алгоритмом — спершу переформувати (або «✎ Замінити»).
  const locked = balanced && teamRows(tournament, regs).length > 0;
  const lockTitle = locked ? 'Спершу переформуй команди' : undefined;
  const substitutedOut = new Set((tournament.balanceStats?.substitutions ?? []).map((s) => s.out));
  // Час останньої зміни тексту правил (0027, проставляє БД): заявка, подана
  // раніше, підтверджувала інший текст — адмін бачить бейдж.
  const rulesChangedAt = tournament.ruleFlagsUpdatedAt ? Date.parse(tournament.ruleFlagsUpdatedAt) : NaN;

  /** Перерахувати бали за речі зі знімка й записати; підсумок/помилка — під рядком і в модалці. */
  const runRecalc = async (r: Registration): Promise<void> => {
    setRecalc((s) => ({ ...s, [r.id]: { busy: true } }));
    try {
      const o = await recalcRegistration(r, tournament);
      setRecalc((s) => ({ ...s, [r.id]: { msg: recalcSummary(o) } }));
      await reload();
    } catch (e) {
      setRecalc((s) => ({ ...s, [r.id]: { err: errorMessage(e, 'Не вдалося перерахувати.') } }));
    }
  };
  /** Підтвердження: неперевірений скор v2 спершу перераховується зі знімка (довіра —
   * бали рахував клієнт гравця); невдача не блокує підтвердження — рядок лишається
   * «не перевірено», і жеребка його не візьме, доки адмін не перерахує. */
  const confirmReg = async (r: Registration): Promise<void> => {
    if (isUnverifiedV2(r) && canRecalc(r)) await runRecalc(r);
    await setRegistrationStatus(r.id, 'confirmed');
    await reload();
  };

  const editing = editingId ? rows.find((r) => r.id === editingId) ?? null : null;

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
        const v2 = r.itemPoints != null;
        const rc = recalc[r.id];
        return (
          <div key={r.id} style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span>{r.nickname}</span>
              {balanced && (r.gear && bd ? (
                <>
                  <span className="badge mute">{CLASS_LABELS[r.gear.charClass]}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <b title={`гір ${bd.gear}${v2 ? ` (речі ${fmtPoints(r.itemPoints!)})` : ' (таблиця)'} · корекція ${signed(bd.adjust)} · рейтинг ${signed(bd.rating)}`}>{bd.total}</b>
                    <TierBadge
                      info={{
                        nickname: r.nickname, gear: r.gear, tier: tierFor(bd.total, version), gemsMix: gemMixLabel(r.dollPower?.gems, rulesFor(version)) || undefined, weaponAbility: weaponAbilityName(r.dollPower?.abil),
                        breakdown: r.itemBreakdown, setNames: setNamesOf(r.characterSnapshot), itemName: names?.fn,
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
                  {v2 ? (
                    isUnverifiedV2(r) ? (
                      <>
                        <span className="badge warn" title={UNVERIFIED_TITLE}>не перевірено</span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={!!rc?.busy || !canRecalc(r)}
                          title={canRecalc(r) ? 'Перерахувати бали за речі зі знімка ляльки за версією шкали турніру' : NO_SNAPSHOT_HINT}
                          onClick={() => runRecalc(r)}
                        >
                          {rc?.busy ? 'Рахую…' : '↻ зі знімка'}
                        </button>
                      </>
                    ) : (
                      <span className="badge mute" title={CHECKED_TITLE}>речі ✓</span>
                    )
                  ) : hasV2 ? (
                    <span className="badge mute" title={TABLE_TITLE}>таблиця</span>
                  ) : null}
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
                <button type="button" className="btn btn-ghost btn-sm" title={v2 ? 'Розклад по речах, перерахунок і корекція адміна' : 'Редагувати анкету спорядження'} onClick={() => setEditingId(r.id)}>✎</button>
              )}
              {r.status !== 'confirmed' && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={!!rc?.busy} onClick={() => confirmReg(r).catch(reportError)}>Підтвердити</button>
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
              <span className="hint" style={{ marginTop: 4 }}>{gearSummary(r.gear, version, gemMixLabel(r.dollPower?.gems, rulesFor(version)) || undefined)}</span>
            )}
            {rc?.msg && <span className="hint" style={{ marginTop: 4 }}>{rc.msg}</span>}
            {rc?.err && <p className="form-err" style={{ marginTop: 4 }}>{rc.err}</p>}
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
        <RegModal
          reg={editing}
          tournament={tournament}
          version={version}
          recalc={recalc[editing.id]}
          itemName={names?.fn}
          onRecalc={() => runRecalc(editing)}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); reload(); }}
        />
      )}
    </div>
  );
}
