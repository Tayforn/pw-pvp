// =========================================================
// Адмінка → «Ставки» (лише суперадмін; RLS bets — is_superadmin()).
//
//  * налаштування ставок турніру: увімкнено, комісія %, мін/макс сума, скарбник;
//  * ринки: стан, пул оплачених (і скільки ще чекає оплати), коефіцієнти, кнопки
//    «Бій почався» (закрити прийом) / «Відкрити знову»;
//  * таблиця ставок: хто, на кого, скільки, статус; «Оплачено» — коли юані прийшли
//    в грі (тоді ставка йде в пул), «Відхилити», «Виплачено» — коли виграш чи
//    повернення передано в грі. Сума до виплати рахується з результату (betMath.ts);
//    якщо записана виплата з нею розійшлась (переможця змінили) — попередження.
// =========================================================

import { useEffect, useMemo, useState } from 'react';
import '../../components/bets/bets.css';
import { reportError } from '../../app/errorMessage';
import { formatPrice, formatPriceExact, formatPriceInputMask, parsePriceInput } from '../../app/formatPrice';
import { useTournamentLive } from '../../app/useTournamentLive';
import type { Tournament } from '../../data/types';
import { fetchAdminTournaments } from '../../data/tournaments';
import {
  bracketParticipants, formatOdds, marketPool, matchMarketState, oddsFor, payoutOf, poolTotal, poolsFromBets, settleBet,
  tournamentMarketState, type AdminBet, type MarketState,
} from '../../data/betMath';
import {
  fetchAdminBets, setBetPayout, setBetStatus, setMatchBetsClosed, setOutrightBetsClosed, subscribeToBetChanges, updateBetSettings,
} from '../../data/bets';
import { bracketInfo, byBracketOrder, matchRef, nameFor, stageName } from '../../components/bracket/model';
import { marketLabel, marketStateLabel, outcomeLabel } from '../../components/bets/labels';

const STATUS_FILTERS = {
  all: 'Усі',
  pending: 'Очікують оплати',
  paid: 'Оплачені',
  payout: 'До виплати',
  closed: 'Відхилені й скасовані',
} as const;
type StatusFilter = keyof typeof STATUS_FILTERS;

export default function BetsTab({ currentUserId }: { currentUserId: string }) {
  const [list, setList] = useState<Tournament[] | null>(null);
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminTournaments(currentUserId, true).then(
      (ts) => {
        // ставки приймаються лише на публічні турніри (place_bet)
        const pub = ts.filter((t) => t.visibility === 'public' && t.status !== 'draft');
        setList(pub);
        setId((cur) => cur ?? (pub.find((t) => t.bets?.enabled && t.status !== 'completed') ?? pub[0])?.id ?? null);
      },
      reportError,
    );
  }, [currentUserId]);

  if (list === null) return <p className="hint">Завантаження…</p>;
  if (list.length === 0) return <p className="hint">Немає публічних турнірів.</p>;

  return (
    <div>
      <label className="field" style={{ maxWidth: 480, marginBottom: 16 }}>
        <span>Турнір</span>
        <select value={id ?? ''} onChange={(e) => setId(e.target.value)}>
          {list.map((t) => (
            <option key={t.id} value={t.id}>{t.eventDate} · {t.name}{t.bets?.enabled ? ' · ставки' : ''}</option>
          ))}
        </select>
      </label>
      {id && <TournamentBets key={id} id={id} />}
    </div>
  );
}

function TournamentBets({ id }: { id: string }) {
  const { tournament, registrations, bracket } = useTournamentLive(id);
  const [bets, setBets] = useState<AdminBet[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchAdminBets(id).then((b) => { if (alive) setBets(b); }, reportError);
    return () => { alive = false; };
  }, [id, tick]);
  useEffect(() => subscribeToBetChanges(id, () => setTick((x) => x + 1)), [id]);

  if (tournament === undefined) return <p className="hint">Завантаження…</p>;
  if (tournament === null) return <p className="hint">Турнір не знайдено.</p>;
  if (!tournament.bets) {
    return <p className="hint">Ставки ще не ввімкнено в базі — спершу виконайте міграцію supabase/migrations/0036_bets.sql.</p>;
  }

  const reload = () => setTick((x) => x + 1);
  return (
    <>
      <SettingsCard tournament={tournament} />
      <MarketsCard tournament={tournament} bracket={bracket} registrations={registrations} bets={bets} onChanged={reload} />
      <BetsTable tournament={tournament} bracket={bracket} bets={bets} onChanged={reload} />
    </>
  );
}

function SettingsCard({ tournament }: { tournament: Tournament }) {
  const s = tournament.bets!;
  const [enabled, setEnabled] = useState(s.enabled);
  const [commission, setCommission] = useState(String(s.commissionPct));
  const [min, setMin] = useState(formatPriceInputMask(s.minStake));
  const [max, setMax] = useState(s.maxStake == null ? '' : formatPriceInputMask(s.maxStake));
  const [treasurer, setTreasurer] = useState(s.treasurer ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const pct = Number(commission.replace(',', '.'));
  const minN = parsePriceInput(min);
  const maxN = max.trim() ? parsePriceInput(max) : null;
  const err =
    !Number.isFinite(pct) || pct < 0 || pct > 50 ? 'Комісія — від 0 до 50 %.'
      : minN < 1 ? 'Мінімальна ставка — хоча б 1 юань.'
        : maxN != null && maxN < minN ? 'Максимальна ставка менша за мінімальну.'
          : treasurer.trim().length > 40 ? 'Нік скарбника — до 40 символів.'
            : null;

  const save = async () => {
    if (err) return;
    setBusy(true);
    setSaved(false);
    try {
      await updateBetSettings(tournament.id, {
        enabled, commissionPct: Math.round(pct * 100) / 100, minStake: minN, maxStake: maxN, treasurer: treasurer.trim() || null,
      });
      setSaved(true);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card bets-card">
      <h3>Налаштування</h3>
      <label className="checkbox-row">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Приймати ставки на цей турнір
      </label>
      <div className="field-row">
        <label className="field" style={{ flex: '0 1 150px' }}>
          <span>Комісія, %</span>
          <input type="text" inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} />
        </label>
        <label className="field">
          <span>Мін. ставка = {formatPrice(minN)}</span>
          <input type="text" inputMode="numeric" value={min} onChange={(e) => setMin(formatPriceInputMask(e.target.value))} />
        </label>
        <label className="field">
          <span>Макс. ставка {maxN != null ? `= ${formatPrice(maxN)}` : '(порожньо — без межі)'}</span>
          <input type="text" inputMode="numeric" value={max} onChange={(e) => setMax(formatPriceInputMask(e.target.value))} />
        </label>
        <label className="field">
          <span>Скарбник (кому передавати юані)</span>
          <input type="text" maxLength={40} value={treasurer} onChange={(e) => setTreasurer(e.target.value)} placeholder="нік у грі" />
        </label>
      </div>
      <span className="hint" style={{ margin: 0 }}>Комісію міняйте до початку прийому: виплати перераховуються за поточною.</span>
      {err && <p className="form-err">{err}</p>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !!err} onClick={save}>{busy ? 'Зберігаю…' : 'Зберегти'}</button>
        {saved && <span className="bet-ok">Збережено</span>}
      </div>
    </div>
  );
}

interface MarketView {
  matchId: string | null;
  title: string;
  state: MarketState;
  picks: string[];
}

function MarketsCard({ tournament, bracket, registrations, bets, onChanged }: {
  tournament: Tournament; bracket: ReturnType<typeof useTournamentLive>['bracket']; registrations: ReturnType<typeof useTournamentLive>['registrations'];
  bets: AdminBet[]; onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const pools = useMemo(() => poolsFromBets(bets), [bets]);
  const c = tournament.bets!.commissionPct;

  const markets = useMemo<MarketView[]>(() => {
    const info = bracketInfo(bracket);
    const out: MarketView[] = [{
      matchId: null, title: 'Переможець турніру', state: tournamentMarketState(tournament, bracket), picks: bracketParticipants(bracket),
    }];
    for (const m of [...bracket].sort(byBracketOrder)) {
      if (!m.participant1Id || !m.participant2Id) continue;
      out.push({
        matchId: m.id, title: `Матч ${matchRef(m, info.doubleElim)} · ${stageName(m, info)}`,
        state: matchMarketState(tournament, m), picks: [m.participant1Id, m.participant2Id],
      });
    }
    return out;
  }, [bracket, tournament]);

  const toggle = async (mk: MarketView, close: boolean) => {
    const key = mk.matchId ?? 'tournament';
    setBusy(key);
    try {
      if (mk.matchId) await setMatchBetsClosed(mk.matchId, close);
      else await setOutrightBetsClosed(tournament.id, close);
      onChanged();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  };

  /** Сума неоплачених ставок на учасника ринку — щоб бачити, чиїх переказів чекати. */
  const pending = (matchId: string | null, pickId: string) =>
    bets.filter((b) => b.status === 'pending' && b.pickId === pickId && (matchId ? b.matchId === matchId : b.market === 'tournament'))
      .reduce((s, b) => s + b.stake, 0);

  if (bracket.length === 0) return <div className="card bets-card"><h3>Ринки</h3><p className="hint" style={{ margin: 0 }}>Сітки ще немає — ринки з’являться після її генерації.</p></div>;

  return (
    <div className="card bets-card">
      <h3>Ринки</h3>
      <span className="hint" style={{ margin: 0 }}>
        Прийом на матч закривається сам, щойно з’являється рахунок чи переможець, а на переможця турніру — з першим закритим матчем.
        Перед боєм тисніть «Бій почався». Коефіцієнти — за оплаченими ставками.
      </span>
      {markets.map((mk) => {
        const key = mk.matchId ?? 'tournament';
        const pool = marketPool(pools, mk.matchId);
        const total = poolTotal(pool);
        const st = marketStateLabel(mk.state);
        const winner = mk.state.kind === 'decided' ? mk.state.winnerId : null;
        const hasBets = bets.some((b) => (mk.matchId ? b.matchId === mk.matchId : b.market === 'tournament'));
        // зіграні матчі без жодної ставки — лише шум
        if (mk.matchId && mk.state.kind === 'decided' && !hasBets) return null;
        const canClose = mk.state.kind === 'open';
        const canReopen = mk.state.kind === 'closed' && (mk.matchId
          ? !bracket.find((m) => m.id === mk.matchId)?.score
          : !bracket.some((m) => m.participant1Id && m.participant2Id && (m.winnerId || m.score || m.betsClosedAt)));
        return (
          <div key={key} className="bet-market">
            <div className="bet-market-head">
              <b>{mk.title}</b>
              <span className={'badge ' + st.tone}>{st.text}</span>
              <span className="hint" style={{ margin: 0 }} title={formatPriceExact(total)}>пул {formatPrice(total)}</span>
              <span style={{ flex: 1 }} />
              {canClose && <button type="button" className="btn btn-ghost btn-sm" disabled={busy === key} onClick={() => toggle(mk, true)}>{mk.matchId ? 'Бій почався — закрити прийом' : 'Закрити прийом'}</button>}
              {canReopen && <button type="button" className="btn btn-ghost btn-sm" disabled={busy === key} onClick={() => toggle(mk, false)}>Відкрити знову</button>}
            </div>
            <div className="bet-picks">
              {mk.picks.map((pid) => {
                const wait = pending(mk.matchId, pid);
                return (
                  <span key={pid} className={'bet-pick' + (winner === pid ? ' win' : '')}>
                    <span className="bet-pick-name">{winner === pid ? '✓ ' : ''}{nameFor(pid, registrations)}</span>
                    <span className="bet-odds">{formatOdds(oddsFor(pool, pid, c))}</span>
                    <span className="hint" style={{ margin: 0 }}>
                      {formatPrice(pool.get(pid) ?? 0)}{wait > 0 ? ` (+${formatPrice(wait)} чекає оплати)` : ''}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BetsTable({ tournament, bracket, bets, onChanged }: {
  tournament: Tournament; bracket: ReturnType<typeof useTournamentLive>['bracket']; bets: AdminBet[]; onChanged: () => void;
}) {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const pools = useMemo(() => poolsFromBets(bets), [bets]);

  const rows = useMemo(
    () => bets.map((b) => {
      const outcome = settleBet(b, tournament, bracket, pools);
      return { b, outcome, due: payoutOf(outcome) };
    }),
    [bets, tournament, bracket, pools],
  );

  const shown = rows.filter(({ b, due }) => {
    switch (filter) {
      case 'pending': return b.status === 'pending';
      case 'paid': return b.status === 'paid';
      case 'payout': return due > 0 && b.payoutAmount !== due;
      case 'closed': return b.status === 'rejected' || b.status === 'cancelled';
      default: return true;
    }
  });

  const paidIn = rows.filter((r) => r.b.status === 'paid').reduce((s, r) => s + r.b.stake, 0);
  const pendingIn = rows.filter((r) => r.b.status === 'pending').reduce((s, r) => s + r.b.stake, 0);
  const owed = rows.reduce((s, r) => s + r.due, 0);
  const paidOut = rows.reduce((s, r) => s + (r.b.payoutAmount ?? 0), 0);

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
      onChanged();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card bets-card">
      <h3>Ставки ({bets.length})</h3>
      <div className="bets-sum">
        <span>Оплачено: <b title={formatPriceExact(paidIn)}>{formatPrice(paidIn)}</b></span>
        <span>Чекає оплати: <b title={formatPriceExact(pendingIn)}>{formatPrice(pendingIn)}</b></span>
        <span>До виплати всього: <b title={formatPriceExact(owed)}>{formatPrice(owed)}</b></span>
        <span>Уже виплачено: <b title={formatPriceExact(paidOut)}>{formatPrice(paidOut)}</b></span>
      </div>
      <div className="field-row">
        <label className="field" style={{ flex: '0 1 260px' }}>
          <span>Показати</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as StatusFilter)}>
            {(Object.keys(STATUS_FILTERS) as StatusFilter[]).map((k) => <option key={k} value={k}>{STATUS_FILTERS[k]}</option>)}
          </select>
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>Немає ставок.</p>
      ) : (
        <div className="bets-table-wrap">
          <table className="bets-table">
            <thead>
              <tr>
                <th>Час</th><th>Гравець</th><th>Ринок</th><th>На кого</th><th>Сума</th><th>Стан</th><th>До виплати</th><th />
              </tr>
            </thead>
            <tbody>
              {shown.map(({ b, outcome, due }) => {
                const o = outcomeLabel(outcome, b.payoutAmount != null && b.payoutAmount === due);
                const mismatch = b.payoutAmount != null && b.payoutAmount !== due;
                return (
                  <tr key={b.id}>
                    <td className="sub">{new Date(b.createdAt).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>
                      {b.playerNick}
                      {b.gameNick && <div className="sub">у грі: {b.gameNick}</div>}
                    </td>
                    <td>{marketLabel(b, bracket)}</td>
                    <td>{b.pickName}</td>
                    <td className="num" title={formatPriceExact(b.stake)}>{formatPrice(b.stake)}</td>
                    <td>
                      <span className={'badge ' + o.tone}>{o.text}</span>
                      {mismatch && <div className="form-err">Виплачено {formatPrice(b.payoutAmount!)}, а за результатом — {formatPrice(due)}</div>}
                    </td>
                    <td className="num" title={due ? formatPriceExact(due) : undefined}>{due ? formatPrice(due) : '—'}</td>
                    <td>
                      <div className="actions">
                        {b.status === 'pending' && (
                          <>
                            <button type="button" className="btn btn-primary btn-sm" disabled={busy === b.id} onClick={() => act(b.id, () => setBetStatus(b.id, 'paid'))}>Оплачено</button>
                            <button type="button" className="btn btn-bad btn-sm" disabled={busy === b.id} onClick={() => act(b.id, () => setBetStatus(b.id, 'rejected'))}>Відхилити</button>
                          </>
                        )}
                        {b.status === 'paid' && b.payoutAmount == null && outcome.kind === 'active' && (
                          <button type="button" className="btn btn-ghost btn-sm" disabled={busy === b.id}
                            onClick={() => window.confirm('Повернути ставку в «очікує оплати»? Вона вийде з пулу.') && act(b.id, () => setBetStatus(b.id, 'pending'))}>
                            Скасувати оплату
                          </button>
                        )}
                        {b.status === 'rejected' && (
                          <button type="button" className="btn btn-ghost btn-sm" disabled={busy === b.id} onClick={() => act(b.id, () => setBetStatus(b.id, 'pending'))}>Повернути</button>
                        )}
                        {due > 0 && b.payoutAmount !== due && (
                          <button type="button" className="btn btn-primary btn-sm" disabled={busy === b.id} onClick={() => act(b.id, () => setBetPayout(b.id, due))}>
                            Виплачено {formatPrice(due)}
                          </button>
                        )}
                        {b.payoutAmount != null && (
                          <button type="button" className="btn btn-ghost btn-sm" disabled={busy === b.id}
                            onClick={() => window.confirm('Зняти позначку «виплачено»?') && act(b.id, () => setBetPayout(b.id, null))}>
                            Зняти виплату
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
