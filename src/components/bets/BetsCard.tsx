// =========================================================
// Ставки в юанях на сторінці турніру: коефіцієнти ринків (переможець турніру й
// матчі, де відомі обидва учасники), форма ставки й «Мої ставки».
//
// Хто й скільки поставив, гравцям не видно — лише коефіцієнти й сума пулу (з
// публічної bet_pools, лише оплачені ставки). Ставку приймає бекенд ладдера за
// Discord-сесією; юані гравець передає скарбнику в грі, і в пул ставка йде, коли
// суперадмін підтвердить оплату.
// =========================================================

import { useEffect, useMemo, useState } from 'react';
import './bets.css';
import { useMe } from '../../app/useMe';
import { formatPrice, formatPriceExact, formatPriceInputMask, parsePriceInput } from '../../app/formatPrice';
import type { BracketMatch, Registration, Tournament } from '../../data/types';
import {
  bracketParticipants, formatOdds, marketPool, matchMarketState, oddsFor, poolTotal, projectedPayout, settleBet,
  tournamentMarketState, type Bet, type MarketState, type PoolRow,
} from '../../data/betMath';
import { BetApiError, cancelMyBet, fetchBetPools, fetchMyBets, placeBet, subscribeToBetChanges } from '../../data/bets';
import { bracketInfo, byBracketOrder, matchRef, nameFor, stageName } from '../bracket/model';
import { marketLabel, marketStateLabel, outcomeLabel } from './labels';

interface Market {
  matchId: string | null;
  title: string;
  state: MarketState;
  picks: string[];
}

interface Props {
  tournament: Tournament;
  bracket: BracketMatch[];
  registrations: Registration[];
  onLogin: () => void;
}

export default function BetsCard({ tournament, bracket, registrations, onLogin }: Props) {
  const { me } = useMe();
  const [pools, setPools] = useState<PoolRow[]>([]);
  const [mine, setMine] = useState<Bet[] | null>(null);
  const [tick, setTick] = useState(0);
  const [sel, setSel] = useState<{ matchId: string | null; pickId: string } | null>(null);
  const tid = tournament.id;
  const settings = tournament.bets;

  useEffect(() => {
    if (!settings) return;
    let alive = true;
    fetchBetPools(tid).then((p) => { if (alive) setPools(p); }, () => { /* коефіцієнти — не критично */ });
    return () => { alive = false; };
  }, [tid, tick, settings]);

  useEffect(() => {
    if (!settings) return;
    return subscribeToBetChanges(tid, () => setTick((x) => x + 1));
  }, [tid, settings]);

  // Свої ставки — і після кожної зміни пулів/сітки (оплату адміна видно як зміну пулу).
  useEffect(() => {
    if (!me || !settings) return;
    let alive = true;
    fetchMyBets(tid).then((b) => { if (alive) setMine(b); }, () => { /* покажемо без «Моїх» */ });
    return () => { alive = false; };
  }, [me, tid, tick, bracket, settings]);

  const markets = useMemo<Market[]>(() => {
    const info = bracketInfo(bracket);
    const out: Market[] = [{
      matchId: null, title: 'Переможець турніру',
      state: tournamentMarketState(tournament, bracket), picks: bracketParticipants(bracket),
    }];
    for (const m of [...bracket].sort(byBracketOrder)) {
      if (!m.participant1Id || !m.participant2Id || m.winnerId) continue;
      out.push({
        matchId: m.id, title: `Матч ${matchRef(m, info.doubleElim)} · ${stageName(m, info)}`,
        state: matchMarketState(tournament, m), picks: [m.participant1Id, m.participant2Id],
      });
    }
    return out;
  }, [bracket, tournament]);

  if (!settings) return null;
  const hasMine = !!mine && mine.length > 0;
  if (!settings.enabled && !hasMine) return null;
  if (bracket.length === 0 && !hasMine) return null;

  const name = (id: string) => nameFor(id, registrations);
  const c = settings.commissionPct;
  const visible = markets.filter((m) => m.state.kind === 'open' || m.state.kind === 'closed');

  return (
    <div className="card bets-card">
      <div>
        <h3>Ставки</h3>
        <span className="hint" style={{ marginTop: 6 }}>
          Тоталізатор у юанях: переможці ділять пул ринку{c > 0 ? ` мінус ${c}% комісії` : ''} пропорційно ставкам.
          Після ставки передай суму {settings.treasurer ? <>персонажу <b>{settings.treasurer}</b></> : 'скарбнику'} у грі — у пул і в коефіцієнт
          ставка піде, коли адмін підтвердить оплату. Коефіцієнт остаточний після закриття прийому.
          Ставка від {formatPrice(settings.minStake)}{settings.maxStake ? ` до ${formatPrice(settings.maxStake)}` : ''}.
        </span>
      </div>

      {visible.length === 0 && <p className="hint" style={{ margin: 0 }}>Зараз немає ринків, відкритих для ставок.</p>}

      {visible.map((mk) => {
        const pool = marketPool(pools, mk.matchId);
        const total = poolTotal(pool);
        const st = marketStateLabel(mk.state);
        const open = mk.state.kind === 'open';
        const chosen = sel && sel.matchId === mk.matchId ? sel.pickId : null;
        return (
          <div key={mk.matchId ?? 'tournament'} className="bet-market">
            <div className="bet-market-head">
              <b>{mk.title}</b>
              <span className={'badge ' + st.tone}>{st.text}</span>
              {total > 0 && <span className="hint" style={{ margin: 0 }} title={formatPriceExact(total)}>у пулі {formatPrice(total)}</span>}
            </div>
            <div className="bet-picks">
              {mk.picks.map((pid) => (
                <button
                  key={pid}
                  type="button"
                  className={'bet-pick' + (chosen === pid ? ' sel' : '')}
                  disabled={!open}
                  aria-pressed={chosen === pid}
                  title={open ? 'Поставити на цього учасника' : undefined}
                  onClick={() => setSel(chosen === pid ? null : { matchId: mk.matchId, pickId: pid })}
                >
                  <span className="bet-pick-name">{name(pid)}</span>
                  <span className="bet-odds">{formatOdds(oddsFor(pool, pid, c))}</span>
                </button>
              ))}
            </div>
            {open && chosen && (
              me ? (
                <BetForm
                  key={`${mk.matchId}-${chosen}`}
                  tournament={tournament}
                  matchId={mk.matchId}
                  pickId={chosen}
                  pickName={name(chosen)}
                  pool={pool}
                  onPlaced={() => setTick((x) => x + 1)}
                />
              ) : (
                <div className="bet-form">
                  <span className="hint" style={{ margin: 0 }}>Ставити можуть лише учасники клану — увійди через Discord.</span>
                  <div><button type="button" className="btn btn-primary btn-sm" onClick={onLogin}>Увійти через Discord</button></div>
                </div>
              )
            )}
          </div>
        );
      })}

      {hasMine && <MyBets bets={mine!} tournament={tournament} bracket={bracket} pools={pools} onChanged={() => setTick((x) => x + 1)} />}
    </div>
  );
}

function BetForm({ tournament, matchId, pickId, pickName, pool, onPlaced }: {
  tournament: Tournament; matchId: string | null; pickId: string; pickName: string; pool: Map<string, number>; onPlaced: () => void;
}) {
  const s = tournament.bets!;
  const [amount, setAmount] = useState(formatPriceInputMask(s.minStake));
  const [gameNick, setGameNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const stake = parsePriceInput(amount);
  const tooSmall = stake < s.minStake;
  const tooBig = s.maxStake != null && stake > s.maxStake;
  const payout = projectedPayout(pool, pickId, stake, s.commissionPct);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tooSmall || tooBig || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await placeBet({ tournamentId: tournament.id, matchId, pickId, stake, gameNick: gameNick.trim() || undefined });
      setDone(stake);
      onPlaced();
    } catch (e2) {
      setErr(e2 instanceof BetApiError || e2 instanceof Error ? e2.message : 'Не вдалося поставити.');
    } finally {
      setBusy(false);
    }
  };

  if (done != null) {
    return (
      <div className="bet-form">
        <p className="bet-ok">
          Ставку на <b>{pickName}</b> записано. Передай <b>{formatPriceExact(done)}</b> юанів
          {s.treasurer ? <> персонажу <b>{s.treasurer}</b></> : ' скарбнику'} у грі — коли адмін підтвердить оплату, ставка піде в пул.
        </p>
        <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setDone(null)}>Ще ставка</button></div>
      </div>
    );
  }

  return (
    <form className="bet-form" onSubmit={submit}>
      <label className="field">
        <span>Сума на «{pickName}», юанів</span>
        <div className="bet-amount">
          <input type="text" inputMode="numeric" value={amount} onChange={(e) => setAmount(formatPriceInputMask(e.target.value))} placeholder="10 000 000" />
          <span className="bet-amount-short" title={formatPriceExact(stake)}>= {formatPrice(stake)}</span>
        </div>
      </label>
      <label className="field">
        <span>З якого персонажа переказ (необовʼязково)</span>
        <input type="text" maxLength={40} value={gameNick} onChange={(e) => setGameNick(e.target.value)} placeholder="нік у грі" />
      </label>
      {tooSmall && <p className="form-err">Мінімальна ставка — {formatPrice(s.minStake)}.</p>}
      {tooBig && <p className="form-err">Максимальна ставка — {formatPrice(s.maxStake!)}.</p>}
      {!tooSmall && !tooBig && (
        <span className="hint" style={{ margin: 0 }}>
          Якщо {pickName} виграє і пул не зміниться — отримаєш ≈ <b title={formatPriceExact(payout)}>{formatPrice(payout)}</b>
          {' '}(коеф. ≈ {formatOdds(stake > 0 ? payout / stake : null)}).
        </span>
      )}
      {err && <p className="form-err">{err}</p>}
      <div><button type="submit" className="btn btn-primary btn-sm" disabled={busy || tooSmall || tooBig}>{busy ? 'Записую…' : 'Поставити'}</button></div>
    </form>
  );
}

function MyBets({ bets, tournament, bracket, pools, onChanged }: {
  bets: Bet[]; tournament: Tournament; bracket: BracketMatch[]; pools: PoolRow[]; onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const cancel = async (id: string) => {
    setBusy(id);
    setErr(null);
    try {
      await cancelMyBet(id);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не вдалося скасувати.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bet-mine">
      <h4>Мої ставки</h4>
      {bets.map((b) => {
        const o = outcomeLabel(settleBet(b, tournament, bracket, pools), b.payoutAmount != null);
        return (
          <div key={b.id} className="bet-mine-row">
            <span className="grow">{marketLabel(b, bracket)} · на <b>{b.pickName}</b> · <span title={formatPriceExact(b.stake)}>{formatPrice(b.stake)}</span></span>
            <span className={'badge ' + o.tone}>{o.text}</span>
            {b.status === 'pending' && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy === b.id} onClick={() => cancel(b.id)}>Скасувати</button>
            )}
          </div>
        );
      })}
      {err && <p className="form-err">{err}</p>}
    </div>
  );
}
