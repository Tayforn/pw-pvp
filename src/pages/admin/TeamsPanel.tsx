// =========================================================
// Адмінка: блок «Команди» балансного фул-рандому — лічильники пулу
// гравців, формування команд (модалка: кількість команд, seed, політика
// резерву, ручні свопи двома кліками), затверджені склади з резервом,
// переформування/розформування і заміна гравця (неявка/дискваліфікація).
//
// Чотири стани (docs/balanced-random-analysis.md §3.3):
//   A. реєстрація відкрита — лише «Закрити реєстрацію»;
//   B. закрита, команд нема — «Сформувати команди»;
//   C. команди затверджені, результатів у сітці нема — картки +
//      «Переформувати» / «Розформувати» + «✎ Замінити»;
//   D. у сітці є результати — лише «✎ Замінити».
//
// Стан модалок живе ТУТ (не в AdminPage), а після першого завантаження
// рендер не гейтиться на loading — живий рефетч заявок (realtime) не
// повинен перемонтувати блок і стерти чернетку розкладу.
// =========================================================

import { useEffect, useRef, useState } from 'react';
import { errorMessage, reportError } from '../../app/errorMessage';
import type { CharClass, Registration, Tier, Tournament } from '../../data/types';
import { isRegistrationOpen } from '../../data/types';
import { fetchRegistrations, setTournamentStatus, subscribeToTournamentChanges } from '../../data/tournaments';
import { bracketHasResults, fetchBracket, isPowerOfTwo } from '../../data/bracket';
import { estimateSpread, evaluateTeams, formTeams, newSeed, spreadOf, suggestReplacement, type BalancePlayer, type ReservePolicy } from '../../data/balance';
import { CLASS_LABELS, CLASS_ORDER, playerProfile, rulesFor, tierFor } from '../../data/gearRules';
import { useRules } from '../../data/rulesStore';
import { fetchRatings, ratingOf, type PlayerRating } from '../../data/ratings';
import TierBadge, { type PlayerCardInfo } from '../../components/PlayerPopover';
import {
  applyBalancedTeams,
  clearBalancedTeams,
  confirmedWithoutGear,
  frozenScores,
  playersForBalance,
  rulesVersionFor,
  scoreBreakdown,
  substituteTeamMember,
  teamMembers,
  teamRows,
  type TeamsDraft,
} from '../../data/teams';

type SubstReason = 'no_show' | 'disqualified';
const REASON_LABELS: Record<SubstReason, string> = { no_show: 'Неявка', disqualified: 'Дискваліфікація' };

/** S/A — помітні (warn), решта — mute: межі tier попередні, не треба їх кричати. */

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Заявка з анкетою → вхід алгоритму; без анкети — null (не бере участі в балансі).
 * Скор — той самий, що й у playersForBalance (гір + корекція адміна + бонус за Ело);
 * frozen — скори зі знімка жеребки (після формування Ело дрейфує, а показувати
 * треба те, за чим балансували). */
function toBalancePlayer(r: Registration, version: string, teamSize: number | null | undefined, ratings?: Map<string, PlayerRating>, frozen?: Map<string, number>): BalancePlayer | null {
  const b = scoreBreakdown(r, version, ratings, teamSize);
  if (!b || !r.gear) return null;
  return {
    id: r.id, nickname: r.nickname, cls: r.gear.charClass, score: frozen?.get(r.id) ?? b.total, createdAt: r.createdAt,
    ...playerProfile(r.gear.charClass, r.gear.build, rulesFor(version).balance.composition),
  };
}

/** Бейджі рольового шару для картки команди (те саме, що штрафує алгоритм;
 * показуємо завжди, навіть якщо ваги в шкалі 0 — адміну корисно бачити). */
function CompositionBadges({ st, teamSize }: { st: { maxKill: number; threats: number; kp: number }; teamSize: number }) {
  return (
    <>
      {st.maxKill < 0.5 ? (
        <span className="badge bad" title="Нема реального ДД — нікому вбивати">без кілера</span>
      ) : st.maxKill < 0.8 ? (
        <span className="badge warn" title="Єдиний урон — половинка (Танк/Вар/кон-збірка)">слабкий кілер</span>
      ) : null}
      {teamSize >= 3 && st.maxKill >= 0.8 && st.threats < 2 && (
        <span className="badge warn" title="Один ДД: сфокусують його — пачка не зробить нічого">1 загроза</span>
      )}
      <span className="badge mute" title="Kill pressure: найкращий кілер × (1 + підсилення тімейтів)">KP {st.kp.toFixed(2)}</span>
    </>
  );
}

/** id заявки → картка гравця для бейджа рангу (PlayerPopover): адмінська —
 * скор зі складовими, Ело, ПА/ПЗ, корекція. frozen — скори зі знімка жеребки
 * (тоді ранг і скор — за ними, живий скор показується поруч). */
function playerInfos(regs: Registration[], version: string, teamSize: number | null | undefined, ratings?: Map<string, PlayerRating>, frozen?: Map<string, number>): Map<string, PlayerCardInfo> {
  const m = new Map<string, PlayerCardInfo>();
  for (const r of regs) {
    if (r.kind !== 'player' || !r.gear) continue;
    const b = scoreBreakdown(r, version, ratings, teamSize);
    if (!b) continue;
    const fz = frozen?.get(r.id);
    const score = fz ?? b.total;
    m.set(r.id, {
      nickname: r.nickname,
      gear: r.gear,
      tier: tierFor(score, version),
      admin: {
        score, gearScore: b.gear, adjust: b.adjust, rating: b.rating, adjustNote: r.scoreAdjustNote,
        elo: ratings ? ratingOf(ratings, r.nickname) : undefined,
        attackLevel: r.attackLevel, defenseLevel: r.defenseLevel, version,
        liveScore: fz !== undefined ? b.total : undefined,
      },
    });
  }
  return m;
}

/** Найбільша степінь двійки ≥ 4, що вміщається в n; якщо не вміщається — n. */
function largestPow2(n: number): number {
  let p = 4;
  if (n < 4) return n;
  while (p * 2 <= n) p *= 2;
  return p;
}

// ── Рядок гравця (спільний для модалки і карток) ─────────────────

/** Один рядок «як у таблиці»: нік займає всю вільну ширину (ellipsis + title),
 * а клас / скор / tier — колонки фіксованої ширини, тому вирівняні між
 * рядками картки. Кнопка дії (якщо є) — компактна іконка праворуч. */
const COL = { cls: 68, score: 34, tier: 28 } as const;
function PlayerLine({ p, version, info }: { p: BalancePlayer; version: string; info?: PlayerCardInfo }) {
  const tier = info?.tier ?? tierFor(p.score, version);
  const a = info?.admin;
  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
  const scoreTitle = a ? `гір ${a.gearScore} · корекція ${signed(a.adjust)} · рейтинг ${signed(a.rating)}${a.liveScore !== undefined && a.liveScore !== a.score ? ` · зараз ${a.liveScore}` : ''}` : undefined;
  return (
    <>
      <span title={p.nickname} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, textAlign: 'left' }}>
        {p.nickname}
      </span>
      <span className="badge mute" style={{ width: COL.cls, boxSizing: 'border-box', justifyContent: 'center', padding: '3px 6px', flexShrink: 0 }}>{CLASS_LABELS[p.cls]}</span>
      <b title={scoreTitle} style={{ width: COL.score, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{p.score}</b>
      {info ? <TierBadge info={info} width={COL.tier} /> : <span className="badge mute" style={{ width: COL.tier, boxSizing: 'border-box', justifyContent: 'center', padding: '3px 0', flexShrink: 0 }}>{tier}</span>}
    </>
  );
}

/** Іконка дії в рядку — квадратна, щоб колонка дій теж була рівною. */
const ACTION_BTN_STYLE = { width: 30, height: 30, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as const;

// ── Модалка формування команд ─────────────────────────────────────

interface FormModalProps {
  tournament: Tournament;
  players: BalancePlayer[];
  /** id заявки → картка гравця (бейдж рангу з попапом) */
  infos: Map<string, PlayerCardInfo>;
  bracketExists: boolean;
  onClose: () => void;
  onApplied: () => void;
}

/** Оцінка межі розкиду: скільки seed ганяємо і по скільки за один tick
 * setTimeout, щоб UI між чанками встигав перемалюватися (кожен seed ~40–80 мс). */
const EST_SEEDS = 50;
const EST_CHUNK = 5;

interface SpreadEstimate {
  spreads: number[];
  running: boolean;
}

/** Медіана (для парної кількості — середнє двох центральних). */
function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function FormTeamsModal({ tournament: t, players, infos, bracketExists, onClose, onApplied }: FormModalProps) {
  const S = t.teamSize ?? 1;
  const version = rulesVersionFor(t);
  const rules = rulesFor(version).balance;
  const isDouble = t.bracketType === 'double_elim';

  // Пул фіксується на момент відкриття: живий рефетч заявок не має мовчки
  // підміняти чернетку під руками адміна — про зміни лише попереджаємо.
  const [pool] = useState(() => players);
  const maxK = Math.floor(pool.length / S);
  const defaultK = isDouble ? largestPow2(maxK) : maxK;
  // Поле «Команд» — рядком, щоб не клампити на кожному натисканні
  // (інакше «1» → 2 і «12» уже не набрати); у розрахунок іде clamp.
  const [teamCountText, setTeamCountText] = useState(() => String(defaultK));
  const parsedK = parseInt(teamCountText, 10);
  const teamCount = Number.isFinite(parsedK) ? Math.min(maxK, Math.max(2, parsedK)) : defaultK;
  const [seed, setSeed] = useState(() => newSeed());
  const [reservePolicy, setReservePolicy] = useState<ReservePolicy>('latest');
  // Перейменування зберігаються окремо від чернетки — переживають перегенерацію.
  const [names, setNames] = useState<Record<number, string>>({});
  const [draft, setDraft] = useState<TeamsDraft | null>(null);
  const [computing, setComputing] = useState(false);
  const [swapped, setSwapped] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Оцінка межі розкиду для пулу (див. startEstimate). Токен запуску в ref:
  // скасування/скидання просто інкрементує його, і «хвости» старого прогону
  // в setTimeout відпадають самі.
  const [est, setEst] = useState<SpreadEstimate | null>(null);
  const estRun = useRef(0);
  const estTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nameFor = (i: number) => (names[i] ?? '').trim() || `Команда ${i + 1}`;

  // formTeams блокує потік на ~0.5–1 с: спершу малюємо стан «Рахую…», і лише
  // після паузи запускаємо обчислення (пауза ж гасить серію натискань у полі).
  useEffect(() => {
    setComputing(true);
    setErr(null);
    setSelectedId(null);
    const timer = setTimeout(() => {
      try {
        const result = formTeams(pool, { teamSize: S, seed, rules, rulesVersion: version, teamCount, reservePolicy });
        setDraft({ teams: result.teams.map((members, i) => ({ name: `Команда ${i + 1}`, members })), reserve: result.reserve, result });
        setSwapped(false);
      } catch (e) {
        setDraft(null);
        setErr(errorMessage(e, 'Не вдалося сформувати команди.'));
      } finally {
        setComputing(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [pool, S, seed, rules, version, teamCount, reservePolicy]);

  // Esc — скасувати вибір гравця для свопу.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedId(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const cancelEstimate = () => {
    estRun.current++;
    if (estTimer.current) { clearTimeout(estTimer.current); estTimer.current = null; }
  };
  // Оцінка залежить від кількості команд і політики резерву (а пул/розмір/
  // правила в межах модалки сталі) — при їх зміні скидаємо; зміна seed її не
  // чіпає, оновлюється лише «поточний» розклад у підсумку.
  useEffect(() => {
    cancelEstimate();
    setEst(null);
    // cancelEstimate працює лише з ref-ами — стабільна, у deps не потрібна
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, S, rules, version, teamCount, reservePolicy]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelEstimate(), []);

  // formTeams блокує потік, тому ганяємо seed чанками по EST_CHUNK через
  // setTimeout(…, 0): між чанками React малює прогрес, кнопки лишаються живими.
  const startEstimate = () => {
    cancelEstimate();
    const token = ++estRun.current;
    const opts = { teamSize: S, rules, rulesVersion: version, teamCount, reservePolicy };
    const spreads: number[] = [];
    setEst({ spreads: [], running: true });
    const step = () => {
      estTimer.current = null;
      if (token !== estRun.current) return;
      const from = spreads.length;
      const seeds = Array.from({ length: Math.min(EST_CHUNK, EST_SEEDS - from) }, (_, i) => `est-${from + i}`);
      try {
        spreads.push(...estimateSpread(pool, opts, seeds));
      } catch (e) {
        setEst(null);
        setErr(errorMessage(e, 'Не вдалося оцінити межу розкиду.'));
        return;
      }
      const done = spreads.length >= EST_SEEDS;
      setEst({ spreads: spreads.slice(), running: !done });
      if (!done) estTimer.current = setTimeout(step, 0);
    };
    estTimer.current = setTimeout(step, 0);
  };
  // Скасування лишає вже пораховані seed — підсумок буде по них.
  const stopEstimate = () => {
    cancelEstimate();
    setEst((prev) => (prev && prev.spreads.length ? { spreads: prev.spreads, running: false } : null));
  };

  const dirty = swapped || Object.values(names).some((n) => n.trim());
  const requestClose = () => {
    if (dirty && !confirm('Є незбережені зміни в розкладі. Закрити без затвердження?')) return;
    onClose();
  };

  // Своп двома кліками: перший — обрати, другий по іншому гравцю (будь-яка
  // команда чи резерв) — обміняти місцями; клік по тому самому — скасувати.
  const locate = (d: TeamsDraft, id: string): { team: number; idx: number } | null => {
    for (let ti = 0; ti < d.teams.length; ti++) {
      const idx = d.teams[ti].members.findIndex((p) => p.id === id);
      if (idx >= 0) return { team: ti, idx };
    }
    const ri = d.reserve.findIndex((p) => p.id === id);
    return ri >= 0 ? { team: -1, idx: ri } : null;
  };
  const clickPlayer = (id: string) => {
    if (!draft || computing) return;
    if (selectedId === null) { setSelectedId(id); return; }
    if (selectedId === id) { setSelectedId(null); return; }
    const a = locate(draft, selectedId);
    const b = locate(draft, id);
    setSelectedId(null);
    if (!a || !b) return;
    const teams = draft.teams.map((tm) => ({ ...tm, members: tm.members.slice() }));
    const reserve = draft.reserve.slice();
    const get = (loc: { team: number; idx: number }) => (loc.team < 0 ? reserve[loc.idx] : teams[loc.team].members[loc.idx]);
    const set = (loc: { team: number; idx: number }, p: BalancePlayer) => {
      if (loc.team < 0) reserve[loc.idx] = p; else teams[loc.team].members[loc.idx] = p;
    };
    const pa = get(a), pb = get(b);
    set(a, pb);
    set(b, pa);
    setDraft({ ...draft, teams, reserve });
    setSwapped(true);
  };

  const apply = async () => {
    if (!draft) return;
    setSaving(true);
    setErr(null);
    try {
      await applyBalancedTeams(t, { ...draft, teams: draft.teams.map((tm, i) => ({ name: nameFor(i), members: tm.members })) }, { dropBracket: bracketExists });
      onApplied();
    } catch (e) {
      setErr(errorMessage(e, 'Не вдалося затвердити команди.'));
    } finally {
      setSaving(false);
    }
  };

  // Смужка балансу — по поточній чернетці (з урахуванням ручних свопів).
  const ev = draft ? evaluateTeams(draft.teams.map((tm) => tm.members), rules) : null;
  const totals = ev ? ev.stats.map((s) => s.total) : [];
  const minT = totals.length ? Math.min(...totals) : 0;
  const maxT = totals.length ? Math.max(...totals) : 0;
  const spread = maxT - minT;
  const dups = ev ? ev.stats.reduce((s, x) => s + x.dup, 0) : 0;
  // Рольовий шар: пачки без кілера (maxKill < 0.5) і з однією загрозою, понад неминуче.
  const noKiller = ev ? ev.stats.filter((x) => x.maxKill < 0.5).length : 0;
  const unavoidNoKiller = ev ? Math.ceil(ev.unavoidable.killLack - 1e-9) : 0;
  const single = ev && S >= 3 ? ev.stats.filter((x) => x.threats < 2).length : 0;
  const kps = ev ? ev.stats.map((x) => x.kp) : [];
  const kpRange = kps.length ? Math.max(...kps) - Math.min(...kps) : 0;
  const compOn = rules.composition.weights.killer > 0 || rules.composition.weights.twoThreats > 0 || rules.composition.weights.kpRange > 0;

  // Підсумок оцінки межі — проти розкиду поточної чернетки (зі свопами):
  // яка частка прогонів дала розкид НЕ МЕНШИЙ за наш (рівні теж рахуються —
  // розкиди цілі й малі, нічиї звичні; тому в UI «не гірше за», не «краще за»).
  const curSpread = draft ? spreadOf(draft.teams.map((tm) => tm.members)) : null;
  const estDone = est && !est.running && est.spreads.length ? est.spreads : null;
  const estSummary = estDone
    ? {
        min: Math.min(...estDone),
        max: Math.max(...estDone),
        med: median(estDone),
        n: estDone.length,
        betterPct: curSpread === null ? null : Math.round((100 * estDone.filter((s) => s >= curSpread).length) / estDone.length),
      }
    : null;

  const poolChanged = players.length !== pool.length || players.some((p) => !pool.some((q) => q.id === p.id));
  const selected = draft && selectedId ? [...draft.teams.flatMap((tm) => tm.members), ...draft.reserve].find((p) => p.id === selectedId) ?? null : null;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ width: 'min(1000px, 100%)' }}>
        <div className="modal-head">
          <h3>Формування команд</h3>
          <button type="button" className="modal-close" onClick={requestClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="field-row" style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: '0 0 110px' }}>
              <span>Команд</span>
              <input
                type="number"
                min={2}
                max={maxK}
                value={teamCountText}
                disabled={saving}
                onChange={(e) => setTeamCountText(e.target.value)}
                onBlur={() => setTeamCountText(String(teamCount))}
              />
            </label>
            <label className="field" style={{ flex: '0 0 220px' }}>
              <span>Резерв (хто лишається поза командами)</span>
              <select value={reservePolicy} disabled={saving} onChange={(e) => setReservePolicy(e.target.value as ReservePolicy)}>
                <option value="latest">останні за часом реєстрації</option>
                <option value="random">випадково</option>
              </select>
            </label>
            <div className="field" style={{ flex: '1 1 220px' }}>
              <span>Seed</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <code>{seed}</code>
                <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => setSeed(newSeed())}>🎲 Перегенерувати</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={saving || !!est?.running} onClick={startEstimate}>Оцінити межу ({EST_SEEDS} seed)</button>
                {est?.running && (
                  <>
                    <span className="hint" style={{ margin: 0, whiteSpace: 'nowrap' }}>Рахую… {est.spreads.length}/{EST_SEEDS}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={stopEstimate}>Скасувати</button>
                  </>
                )}
              </div>
            </div>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            Гравців з анкетою: {pool.length} · по {S} у команді · максимум {maxK} команд.
            {isDouble && ' Подвійна елімінація: кількість команд має бути степенем двійки (4, 8, 16…), зайві гравці підуть у резерв.'}
            {' '}Той самий seed + той самий пул дають той самий розклад; зміна пулу — інша жеребка.
          </p>
          {estSummary && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span>
                Межа для цього пулу: розкид мін {estSummary.min} · медіана {estSummary.med} · макс {estSummary.max} ({estSummary.n} seed).
                {curSpread !== null && estSummary.betterPct !== null && ` Поточний розклад — ${curSpread}, не гірше за ${estSummary.betterPct} % прогонів.`}
              </span>
              <span className="hint" style={{ margin: 0 }}>
                Оцінка — зменшеним бюджетом пошуку (поточний розклад шукано повним, тому він зазвичай на рівні найкращих прогонів); реальна межа може бути трохи нижчою. Якщо поточний розкид близький до мінімуму — крутити «Перегенерувати» далі немає сенсу.
              </span>
            </div>
          )}
          {isDouble && !isPowerOfTwo(teamCount) && (
            <span className="badge warn" style={{ alignSelf: 'flex-start' }}>{teamCount} команд — не степінь двійки, сітку double_elim не згенерувати</span>
          )}
          {poolChanged && (
            <span className="badge warn" style={{ alignSelf: 'flex-start' }}>Список підтверджених гравців змінився ({pool.length} → {players.length}) — закрий модалку й відкрий знову</span>
          )}

          {computing && <p className="hint" style={{ margin: 0 }}>Рахую розклад…</p>}
          {err && <p className="form-err">{err}</p>}

          {draft && ev && (
            // Поки рахується новий розклад, старий лишається видимим, але
            // притлумлений і неклікабельний — без «блимання» сітки карток.
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, ...(computing ? { opacity: 0.45, pointerEvents: 'none' } : {}) }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className={'badge ' + (spread <= 10 ? 'good' : 'warn')}>Сума гіру {minT}–{maxT} · розкид {spread}</span>
                <span className={'badge ' + (dups === ev.unavoidableDups ? 'good' : 'warn')}>Дублікати класів: {dups}{ev.unavoidableDups > 0 ? ` (неминучих ${ev.unavoidableDups})` : ''}</span>
                <span className={'badge ' + (noKiller > unavoidNoKiller ? 'bad' : noKiller > 0 ? 'warn' : 'good')} title="Пачки, де найкращий урон < 0.5 (нема кілера, лише Страж/сапорти)">
                  Без кілера: {noKiller}{unavoidNoKiller > 0 ? ` (неминучих ${unavoidNoKiller})` : ''}
                </span>
                {S >= 3 && (
                  <span className={'badge ' + (single > ev.unavoidable.singleThreat ? 'warn' : 'mute')} title="Пачки з одним ДД/Танком: сфокусують його — решта нічого не зробить">
                    З однією загрозою: {single}{ev.unavoidable.singleThreat > 0 ? ` (неминучих ${ev.unavoidable.singleThreat})` : ''}
                  </span>
                )}
                <span className="badge mute" title="Kill pressure = найкращий кілер × (1 + підсилення тімейтів); менший розкид — рівніші шанси вбивати">KP {Math.min(...kps).toFixed(2)}–{Math.max(...kps).toFixed(2)} · розкид {kpRange.toFixed(2)}</span>
                <span className="badge mute">Штраф: {ev.penalty.toFixed(1)}</span>
                {!compOn && <span className="hint" style={{ margin: 0 }} title="У версії шкали цього турніру ваги шару «функціональність пачки» = 0: бейджі лише інформують">рольовий шар вимкнено у шкалі</span>}
                <span className="hint" style={{ margin: 0 }}>
                  кандидатів у коридорі: {draft.result.candidates} з {draft.result.distinct}
                  {swapped ? ' · є ручні зміни' : ''}
                </span>
              </div>
              <p className="hint" style={{ margin: 0 }}>
                {selected
                  ? `Обрано ${selected.nickname} — клік по іншому гравцю для обміну, Esc — скасувати`
                  : 'Клік по гравцю — обрати, другий клік по іншому (будь-яка команда чи резерв) — поміняти місцями.'}
              </p>
              <div className="teams-grid">
                {draft.teams.map((tm, ti) => {
                  const st = ev.stats[ti];
                  return (
                    <div key={ti} className="card team-card">
                      <div className="team-card-head">
                        <label className="field" style={{ flex: 1, minWidth: 0 }}>
                          <input type="text" value={nameFor(ti)} maxLength={80} style={{ padding: '8px 10px', fontSize: 14, fontWeight: 600 }} onChange={(e) => setNames({ ...names, [ti]: e.target.value })} />
                        </label>
                        <span className={'badge ' + (st.dup > 0 ? 'warn' : 'mute')} style={{ whiteSpace: 'nowrap' }}>гір {st.total}{st.dup > 0 ? ` · дублі ${st.dup}` : ''}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <CompositionBadges st={st} teamSize={S} />
                      </div>
                      <div className="team-rows">
                        {tm.members.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className={'player-row' + (selectedId === p.id ? ' selected' : '')}
                            style={selectedId === p.id ? { outline: '2px solid var(--accent)', outlineOffset: -1 } : undefined}
                            onClick={() => clickPlayer(p.id)}
                          >
                            <PlayerLine p={p} version={version} info={infos.get(p.id)} />
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div className="card team-card" style={{ borderStyle: 'dashed' }}>
                  <div className="team-card-head">
                    <b style={{ fontSize: 15 }}>Резерв ({draft.reserve.length})</b>
                    <span className="hint" style={{ margin: 0, whiteSpace: 'nowrap' }}>порядок = черга на заміну</span>
                  </div>
                  {draft.reserve.length === 0 && <span className="hint">Усі гравці в командах.</span>}
                  <div className="team-rows">
                    {draft.reserve.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={'player-row' + (selectedId === p.id ? ' selected' : '')}
                        style={selectedId === p.id ? { outline: '2px solid var(--accent)', outlineOffset: -1 } : undefined}
                        onClick={() => clickPlayer(p.id)}
                      >
                        <PlayerLine p={p} version={version} info={infos.get(p.id)} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={requestClose}>Скасувати</button>
          <button type="button" className="btn btn-primary" disabled={!draft || computing || saving} onClick={apply}>
            {saving ? 'Зберігаю…' : bracketExists ? 'Затвердити команди (сітку буде видалено)' : 'Затвердити команди'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Модалка заміни гравця ─────────────────────────────────────────

interface SubstModalProps {
  tournament: Tournament;
  team: Registration;
  out: Registration;
  members: Registration[];
  /** Підтверджені гравці поза командами — у порядку черги на заміну. */
  reserve: Registration[];
  ratings?: Map<string, PlayerRating>;
  onClose: () => void;
  onDone: () => void;
}

function SubstituteModal({ tournament: t, team, out, members, reserve, ratings, onClose, onDone }: SubstModalProps) {
  const version = rulesVersionFor(t);
  const [reason, setReason] = useState<SubstReason>('no_show');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Склад команди — за скорами жеребки, кандидати з резерву — наживо.
  const frozen = frozenScores(t);
  const teamBP = members.map((r) => toBalancePlayer(r, version, t.teamSize, ratings, frozen)).filter((p): p is BalancePlayer => !!p);
  const outBP = toBalancePlayer(out, version, t.teamSize, ratings, frozen);
  const reserveBP = reserve.map((r) => toBalancePlayer(r, version, t.teamSize, ratings)).filter((p): p is BalancePlayer => !!p);
  const infos = playerInfos(reserve, version, t.teamSize, ratings);
  const reserveNoGear = reserve.filter((r) => !r.gear);
  const candidates = outBP ? suggestReplacement(teamBP, outBP, reserveBP) : reserveBP;
  const total = teamBP.reduce((s, p) => s + p.score, 0);
  const outScore = outBP?.score ?? 0;

  const run = async (inId: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      const cand = inId ? candidates.find((p) => p.id === inId) ?? null : null;
      await substituteTeamMember(team.id, out.id, inId, reason, cand?.score ?? null, cand ? tierFor(cand.score, version) : null);
      onDone();
    } catch (e) {
      setErr(errorMessage(e, 'Не вдалося виконати заміну.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ width: 'min(560px, 100%)' }}>
        <div className="modal-head">
          <h3>Замінити: {out.nickname}</h3>
          <button type="button" className="modal-close" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p className="hint" style={{ margin: 0 }}>
            Команда «{team.nickname}» · сума гіру зараз {total}. Вибулий отримає статус «вибув» і не потрапить у наступне переформування; сітка не змінюється.
          </p>
          <label className="field" style={{ maxWidth: 240 }}>
            <span>Причина</span>
            <select value={reason} disabled={busy} onChange={(e) => setReason(e.target.value as SubstReason)}>
              {(Object.keys(REASON_LABELS) as SubstReason[]).map((r) => <option key={r} value={r}>{REASON_LABELS[r]}</option>)}
            </select>
          </label>
          <div>
            <b>Кандидати з резерву ({candidates.length})</b>
            {candidates.length === 0 && <p className="hint">Резерв порожній — можна лише прибрати гравця без заміни.</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
              {candidates.map((p) => {
                const next = total - outScore + p.score;
                const delta = next - total;
                return (
                  <div key={p.id} className="player-row static">
                    <PlayerLine p={p} version={version} info={infos.get(p.id)} />
                    <span className="hint" style={{ margin: 0, whiteSpace: 'nowrap' }}>сума стане {next} ({delta >= 0 ? '+' : ''}{delta})</span>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(p.id)}>Поставити</button>
                  </div>
                );
              })}
            </div>
            {reserveNoGear.length > 0 && (
              <p className="hint">Без анкети (не в списку): {reserveNoGear.map((r) => r.nickname).join(', ')} — дозаповни через ✎ у заявках.</p>
            )}
          </div>
          {err && <p className="form-err">{err}</p>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Скасувати</button>
          <button
            type="button"
            className="btn btn-bad"
            disabled={busy}
            onClick={() => confirm(`Прибрати ${out.nickname} з команди «${team.nickname}» без заміни? Команда гратиме неповним складом.`) && run(null)}
          >
            Прибрати без заміни
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Блок «Команди» ────────────────────────────────────────────────

export default function TeamsPanel({ tournament: t }: { tournament: Tournament }) {
  // до формування скори рахуються за поточною версією шкали — підписка на реєстр
  useRules();
  const [regs, setRegs] = useState<Registration[]>([]);
  // Ело-рейтинги (кеш 60 с у fetchRatings) — бонус входить у скор для жеребки.
  // Не завантажились — панель живе далі, скор просто без бонусу.
  const [ratings, setRatings] = useState<Map<string, PlayerRating> | undefined>(undefined);
  const [bracketLen, setBracketLen] = useState(0);
  const [hasResults, setHasResults] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [forming, setForming] = useState(false);
  const [subst, setSubst] = useState<{ team: Registration; out: Registration } | null>(null);

  const reload = async () => {
    const [r, matches, results, rt] = await Promise.all([
      fetchRegistrations(t.id),
      fetchBracket(t.id),
      bracketHasResults(t.id),
      fetchRatings().catch((e: unknown) => { console.error('fetchRatings', e); return null; }),
    ]);
    setRegs(r);
    setBracketLen(matches.length);
    setHasResults(results);
    if (rt) setRatings(rt);
  };
  useEffect(() => {
    reload().catch((e) => setErr(errorMessage(e, 'Не вдалося завантажити заявки.'))).finally(() => setLoaded(true));
    // Сусідні панелі (заявки, сітка) тримають свій окремий стан — підписка
    // потрібна, щоб підтвердження/результати відображались і тут.
    return subscribeToTournamentChanges(() => { reload().catch(() => undefined); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id]);

  const S = t.teamSize ?? 0;
  const version = rulesVersionFor(t);
  const players = playersForBalance(t, regs, ratings);
  // Для модалки формування — живі скори (нова жеребка), для карток сформованих
  // команд — скори зі знімка (див. frozenScores).
  const infos = playerInfos(regs, version, t.teamSize, ratings);
  const frozen = frozenScores(t);
  const frozenInfos = playerInfos(regs, version, t.teamSize, ratings, frozen);
  const noGear = confirmedWithoutGear(regs);
  const confirmedPlayers = regs.filter((r) => r.kind === 'player' && r.status === 'confirmed');
  const teams = teamRows(t, regs);
  const hasTeams = teams.length > 0;
  const reserve = confirmedPlayers.filter((r) => !r.teamRegistrationId);
  const K = S > 0 ? Math.floor(players.length / S) : 0;
  const R = players.length - K * S;
  const classCounts: [CharClass, number][] = CLASS_ORDER
    .map((c): [CharClass, number] => [c, players.filter((p) => p.cls === c).length])
    .filter(([, n]) => n > 0);
  const overK = K >= 2 ? classCounts.filter(([, n]) => n > K) : [];
  const isDouble = t.bracketType === 'double_elim';
  const regOpen = isRegistrationOpen(t);
  const enoughPlayers = S > 0 && players.length >= 2 * S;
  const stats = t.balanceStats;

  // Резерв у порядку черги на заміну (як при формуванні), пізні заявки — в кінці.
  const reserveOrder = new Map((stats?.reserve ?? []).map((r, i) => [r.registrationId, i] as const));
  const reserveSorted = reserve.slice().sort((a, b) => (reserveOrder.get(a.id) ?? Infinity) - (reserveOrder.get(b.id) ?? Infinity) || a.createdAt.localeCompare(b.createdAt));
  const late = reserve.filter((r) => !reserveOrder.has(r.id));
  const incomplete = teams.filter((team) => teamMembers(team, regs).length < S);

  const closeRegistration = () => {
    if (!confirm('Закрити реєстрацію? Нові заявки більше не прийматимуться.')) return;
    setBusy(true);
    setTournamentStatus(t.id, 'registration_closed').catch(reportError).finally(() => setBusy(false));
  };
  const openForming = () => {
    if (bracketLen > 0 && !confirm('Сітку буде видалено. Переформувати команди?')) return;
    setForming(true);
  };
  const disband = () => {
    if (!confirm('Розформувати команди? Сітка (якщо є) буде видалена.')) return;
    setBusy(true);
    setErr(null);
    clearBalancedTeams(t.id)
      .then(reload)
      .catch((e) => setErr(errorMessage(e, 'Не вдалося розформувати команди.')))
      .finally(() => setBusy(false));
  };

  if (!loaded) return <p className="hint">Завантаження…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="hint" style={{ margin: 0 }}>
          Підтверджено {confirmedPlayers.length} · Команд по {S}: {K}{R > 0 ? ` (+${R} у резерві)` : ''}
          {classCounts.length > 0 ? ' · Класи: ' + classCounts.map(([c, n]) => `${CLASS_LABELS[c]} ${n}`).join(' · ') : ''}
        </span>
        {overK.map(([c, n]) => (
          <span key={c} className="badge warn">{CLASS_LABELS[c]} {n} на {K} команд — дублювання неминуче</span>
        ))}
        {noGear.length > 0 && <span className="badge warn">Без анкети: {noGear.length} — дозаповни через ✎ або відхили</span>}
      </div>

      {/* Затверджені команди мають пріоритет над статусом: якщо адмін знову
          відкрив реєстрацію після формування — картки не ховаємо. */}
      {regOpen && !hasTeams ? (
        <>
          <p className="hint" style={{ margin: 0 }}>Команди формуються після закриття реєстрації.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={closeRegistration}>Закрити реєстрацію</button>
            <button type="button" className="btn btn-primary btn-sm" disabled>Сформувати команди</button>
          </div>
        </>
      ) : !hasTeams ? (
        <>
          {!enoughPlayers && (
            <p className="hint" style={{ margin: 0 }}>Потрібно щонайменше {2 * S} підтверджених гравців з анкетою (зараз {players.length}).</p>
          )}
          {isDouble && K >= 2 && !isPowerOfTwo(K) && (
            <p className="hint" style={{ margin: 0 }}>
              ⚠ Подвійна елімінація: кількість команд має бути степенем двійки (4, 8, 16…).
              {K < 4
                ? ` Зараз уміщається лише ${K} — сітку double_elim не згенерувати, потрібно щонайменше ${4 * S} гравців.`
                : ` Зараз уміщається ${K} — у модалці обери ${largestPow2(K)}, зайві гравці підуть у резерв.`}
            </p>
          )}
          <div>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !enoughPlayers} onClick={openForming}>Сформувати команди</button>
          </div>
        </>
      ) : (
        <>
          {stats && (
            <p className="hint" style={{ margin: 0 }}>
              seed <code>{t.balanceSeed ?? stats.seed}</code> · {t.balanceRulesVersion ?? stats.rulesVersion} · сформовано {fmtDateTime(stats.formedAt)} · замін: {stats.substitutions?.length ?? 0}
            </p>
          )}
          {incomplete.length > 0 && <span className="badge bad" style={{ alignSelf: 'flex-start' }}>Неповних команд: {incomplete.length}</span>}
          {late.length > 0 && (
            <span className="badge warn" style={{ alignSelf: 'flex-start' }}>
              Поза командами: {late.length} — підтверджені після формування; переформуй команди або постав заміною через «✎ Замінити»
            </span>
          )}
          {hasResults && <p className="hint" style={{ margin: 0 }}>У сітці вже є результати — склади зафіксовано, можливі лише заміни.</p>}
          {regOpen && <p className="hint" style={{ margin: 0 }}>Реєстрація знову відкрита — нові підтверджені гравці опиняться поза командами (резерв або переформування).</p>}

          <div className="teams-grid">
            {teams.map((team) => {
              const members = teamMembers(team, regs);
              const total = members.reduce((s, m) => s + (toBalancePlayer(m, version, t.teamSize, ratings, frozen)?.score ?? 0), 0);
              return (
                <div key={team.id} className="card team-card">
                  <div className="team-card-head">
                    <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 15 }}>{team.nickname}</b>
                    <span className="badge mute" style={{ whiteSpace: 'nowrap' }}>гір {total}</span>
                  </div>
                  {members.length < S && <span className="badge bad" style={{ alignSelf: 'flex-start' }}>Неповна: {members.length}/{S}</span>}
                  <div className="team-rows">
                    {members.map((m) => {
                      const bp = toBalancePlayer(m, version, t.teamSize, ratings, frozen);
                      return (
                        <div key={m.id} className="player-row static">
                          {bp ? <PlayerLine p={bp} version={version} info={frozenInfos.get(m.id)} /> : <><span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.nickname}>{m.nickname}</span><span className="badge bad">без анкети</span></>}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={ACTION_BTN_STYLE}
                            disabled={busy}
                            title="Замінити: гравець з резерву або прибрати з команди"
                            aria-label={`Замінити ${m.nickname}`}
                            onClick={() => setSubst({ team, out: m })}
                          >
                            ✎
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div className="card team-card" style={{ borderStyle: 'dashed' }}>
              <div className="team-card-head">
                <b style={{ fontSize: 15 }}>Резерв ({reserveSorted.length})</b>
                <span className="hint" style={{ margin: 0, whiteSpace: 'nowrap' }}>порядок = черга на заміну</span>
              </div>
              {reserveSorted.length === 0 && <span className="hint">Порожньо.</span>}
              <div className="team-rows">
                {reserveSorted.map((m) => {
                  const bp = toBalancePlayer(m, version, t.teamSize, ratings);
                  return (
                    <div key={m.id} className="player-row static">
                      {bp ? <PlayerLine p={bp} version={version} info={infos.get(m.id)} /> : <><span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.nickname}>{m.nickname}</span><span className="badge bad">без анкети</span></>}
                      {/* та сама ширина, що й колонка дій у командах — рядки вирівняні між картками */}
                      <span style={{ width: 30, flexShrink: 0, display: 'inline-flex', justifyContent: 'center' }} title={!reserveOrder.has(m.id) ? 'Підтверджений після формування' : undefined}>
                        {!reserveOrder.has(m.id) ? <span className="badge warn" style={{ padding: '2px 5px', fontSize: 11 }}>+</span> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {!hasResults && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy || !enoughPlayers}
                title={!enoughPlayers ? `Потрібно щонайменше ${2 * S} підтверджених гравців з анкетою` : bracketLen > 0 ? 'Сітку буде видалено' : ''}
                onClick={openForming}
              >
                Переформувати
              </button>
              <button type="button" className="btn btn-bad btn-sm" disabled={busy} onClick={disband}>Розформувати</button>
            </div>
          )}
        </>
      )}
      {err && <p className="form-err">{err}</p>}

      {forming && (
        <FormTeamsModal
          tournament={t}
          players={players}
          infos={infos}
          bracketExists={bracketLen > 0}
          onClose={() => setForming(false)}
          onApplied={() => { setForming(false); reload().catch(reportError); }}
        />
      )}
      {subst && (
        <SubstituteModal
          tournament={t}
          team={subst.team}
          out={subst.out}
          members={teamMembers(subst.team, regs)}
          reserve={reserveSorted}
          ratings={ratings}
          onClose={() => setSubst(null)}
          onDone={() => { setSubst(null); reload().catch(reportError); }}
        />
      )}
    </div>
  );
}
