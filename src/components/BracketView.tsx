// =========================================================
// Рендер турнірної сітки. Той самий компонент для публічного read-only
// перегляду (TournamentPage) і адмінського редактора (AdminPage) —
// різниця лише в наявності `editable`.
//
// Картка матчу одна на всі розкладки (TrnMatch): два рядки-слоти в рамці,
// шапка «адреса · формат · ↓ куди йде програвший», порожній слот показує,
// звідки прийде учасник («переможець В1.2», «програвший В2.1»), у командних
// турнірах — склад команди другим рядком, у серіях BO3+ — рахунок цифрами
// біля кожного слота. Стани: очікує (немає обох учасників) · live (обидва
// є, переможця немає — підсвічена рамка) · вирішено.
//
// Редактор: клік по слоту — переможець (BO1) або +1 у серії; проміжний
// рахунок серії зберігається в bracket_matches.score (видно всім і після
// перезавантаження). Вирішений матч не перемикається кліком — лише ↺,
// і лише поки наступний матч не вирішено. Поки запит у дорозі — картка
// заблокована (подвійний тап не дає +2).
//
// Розкладки: single_elim (новий вигляд) — дзеркальна сітка з конекторами й
// короною; double_elim і старий вигляд single_elim — колонки по раундах
// (ColumnsBracket) з конекторами, позиції за реальними звʼязками
// nextMatchId (у нижній сітці раунди «з підсадкою» мають стільки ж матчів,
// як попередній). Гранд-фінал стоїть колонкою після фіналу верхньої, під
// ним корона. «Список» — вертикальний вигляд по раундах для телефонів.
// Пошук («Знайти нік або команду») підсвічує слоти й притемнює решту;
// публічно підставляється нік із localStorage (з форми заявки).
// =========================================================

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { BracketMatch, Registration } from '../data/types';
import { readLastNickname } from '../app/lastNickname';

function nameFor(id: string | null, regs: Registration[]): string {
  if (!id) return '—';
  return regs.find((r) => r.id === id)?.nickname ?? '?';
}

/** Склад команди (у фул-рандомі та fixed-командних турнірах); соло — порожньо. */
function membersFor(id: string | null, regs: Registration[]): string[] {
  if (!id) return [];
  return regs.find((r) => r.id === id)?.memberNicknames ?? [];
}

function roundLabel(depthFromFinal: number): string {
  if (depthFromFinal === 0) return 'Фінал';
  if (depthFromFinal === 1) return 'Півфінал';
  if (depthFromFinal === 2) return 'Чвертьфінал';
  return `1/${2 ** depthFromFinal} фіналу`;
}

const FORMAT_LABELS: Record<string, string> = { bo1: 'BO1', bo3: 'BO3', bo5: 'BO5' };
const KNOWN_FORMATS = ['bo1', 'bo3', 'bo5'];
const DECISIVE_CONFIRM = 'Це вирішальний матч — турнір одразу стане «Завершено». Продовжити?';

function FormatEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [custom, setCustom] = useState(!KNOWN_FORMATS.includes(value));

  if (custom) {
    const commit = (raw: string) => {
      const v = raw.trim().toLowerCase() || 'bo1';
      if (v !== value) onChange(v);
    };
    return (
      <span style={{ display: 'inline-flex', gap: 4 }}>
        <input
          type="text"
          className="trn-ctl"
          defaultValue={KNOWN_FORMATS.includes(value) ? '' : value}
          placeholder="напр. bo7"
          style={{ width: 56 }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
        />
        <button
          type="button"
          className="trn-ctl"
          title="Повернутись до BO1/BO3/BO5"
          onClick={() => {
            setCustom(false);
            onChange('bo1');
          }}
        >
          ↺
        </button>
      </span>
    );
  }
  return (
    // Фіксована ширина: без неї select розтягується під найдовшу опцію
    // («Інший…») і разом із бейджем та іконкою скидання не вміщається в шапку.
    <select
      className="trn-ctl"
      value={KNOWN_FORMATS.includes(value) ? value : 'bo1'}
      style={{ width: 64 }}
      onChange={(e) => {
        if (e.target.value === 'custom') setCustom(true);
        else if (e.target.value !== value) onChange(e.target.value);
      }}
    >
      <option value="bo1">BO1</option>
      <option value="bo3">BO3</option>
      <option value="bo5">BO5</option>
      <option value="custom">Інший…</option>
    </select>
  );
}

export interface BracketEditable {
  /** winnerId=null + score — проміжний рахунок серії; winnerId=null + score=null — скинути. */
  onSetWinner: (matchId: string, winnerId: string | null, score?: string | null) => Promise<void> | void;
  onSetFormat: (matchId: string, format: string) => Promise<void> | void;
}

/** Скільки перемог потрібно для серії даного формату (bo3 → 2, bo5 → 3,
 * bo7 → 4…). Формат без цифри (нетиповий кастом) — 1, щоб адмін завжди мав
 * змогу завершити матч кліком, а не залипав без варіанту зафіксувати результат. */
function requiredWins(format: string): number {
  const digits = format.match(/\d+/);
  const n = digits ? parseInt(digits[0], 10) : 1;
  return Math.max(1, Math.floor(n / 2) + 1);
}

/** «2-1» → [2, 1]; інше — null. */
function parseScore(score: string | null): [number, number] | null {
  const mm = /^(\d+)-(\d+)$/.exec(score ?? '');
  return mm ? [Number(mm[1]), Number(mm[2])] : null;
}

/** «В1.2» / «Н3.1» / «1.2» (одинарна) / «ГФ» / «3-тє» — коротка адреса матчу
 * для підказок у порожніх слотах і в шапці картки. */
function matchRef(f: BracketMatch, doubleElim: boolean): string {
  if (f.bracketSide === 'final') return 'ГФ';
  if (f.bracketSide === 'third_place') return '3-тє';
  const side = !doubleElim ? '' : f.bracketSide === 'losers' ? 'Н' : 'В';
  return `${side}${f.round}.${f.slot + 1}`;
}

/** Підписи для порожніх слотів матчу: хто сюди прийде (переможець/програвший якого матчу). */
function sourceLabels(m: BracketMatch, all: BracketMatch[], doubleElim: boolean): [string | undefined, string | undefined] {
  const out: [string | undefined, string | undefined] = [undefined, undefined];
  for (const f of all) {
    if (f.nextMatchId === m.id && f.nextMatchSlot) out[f.nextMatchSlot - 1] = `переможець ${matchRef(f, doubleElim)}`;
    if (f.loserNextMatchId === m.id && f.loserNextMatchSlot) out[f.loserNextMatchSlot - 1] = `програвший ${matchRef(f, doubleElim)}`;
  }
  return out;
}

interface Props {
  matches: BracketMatch[];
  registrations: Registration[];
  editable?: BracketEditable;
  /** single_elim: дзеркальна сітка (true, за замовчуванням) чи колонки по
   * раундах (false, старий вигляд) — не впливає на double_elim. */
  bracketNewLook?: boolean;
  /** назва турніру — у шапці повноекранного режиму */
  title?: string;
}

/** Спільні для всіх карток параметри рендеру (щоб не тягнути 6 пропсів у кожен TrnMatch). */
interface MatchCtx {
  registrations: Registration[];
  editable?: BracketEditable;
  /** усі матчі турніру — підписи порожніх слотів, «куди йде програвший», блокування */
  all: BracketMatch[];
  doubleElim: boolean;
  /** підсвітка пошуку: чи збігається учасник з запитом */
  hit: (pid: string | null) => boolean;
  /** показувати склад команди другим рядком слота */
  showMembers: boolean;
  /** матч, результат якого завершує турнір (гранд-фінал / фінал) */
  decisiveId: string | null;
}

// ── Картка матчу ────────────────────────────────────────────────────────

function TrnMatch({ m, ctx, matchRefLabel }: { m: BracketMatch; ctx: MatchCtx; matchRefLabel?: string }) {
  const { registrations, editable } = ctx;
  const isBo1 = m.format.toLowerCase() === 'bo1';
  const [pending, setPending] = useState(false);
  const score = parseScore(m.score);
  const sources = useMemo(() => sourceLabels(m, ctx.all, ctx.doubleElim), [m, ctx.all, ctx.doubleElim]);
  // Наступний матч уже вирішено — цей чіпати не можна (інакше в наступному
  // лишиться учасник, якого там уже не мало б бути).
  const downstreamDecided = ctx.all.some((x) => (x.id === m.nextMatchId || x.id === m.loserNextMatchId) && !!x.winnerId);
  const dropTarget = m.loserNextMatchId ? ctx.all.find((x) => x.id === m.loserNextMatchId) : undefined;
  const both = !!m.participant1Id && !!m.participant2Id;
  const live = both && !m.winnerId;
  const decisive = ctx.decisiveId === m.id;

  // Поки запит у дорозі — картка заблокована: подвійний тап не дає +2,
  // два швидкі кліки в BO1 не женуть два read-then-write.
  const run = (p: Promise<void> | void) => {
    setPending(true);
    Promise.resolve(p).finally(() => setPending(false));
  };

  const pick = (pid: string | null) => {
    if (!editable || !pid || !both || m.winnerId || pending || downstreamDecided) return;
    if (isBo1) {
      if (decisive && !confirm(DECISIVE_CONFIRM)) return;
      run(editable.onSetWinner(m.id, pid, pid === m.participant1Id ? '1-0' : '0-1'));
      return;
    }
    const cur = score ?? [0, 0];
    const idx = pid === m.participant1Id ? 0 : 1;
    const next: [number, number] = [cur[0], cur[1]];
    next[idx] += 1;
    if (next[idx] >= requiredWins(m.format)) {
      if (decisive && !confirm(DECISIVE_CONFIRM)) return;
      run(editable.onSetWinner(m.id, pid, `${next[0]}-${next[1]}`));
    } else {
      run(editable.onSetWinner(m.id, null, `${next[0]}-${next[1]}`)); // проміжний рахунок — у БД
    }
  };
  const reset = () => {
    if (!editable || pending || downstreamDecided) return;
    run(editable.onSetWinner(m.id, null, null));
  };

  const showReset = !!editable && !downstreamDecided && (!!m.winnerId || (!!score && (score[0] > 0 || score[1] > 0)));
  const cardHit = [m.participant1Id, m.participant2Id].some((pid) => !!pid && ctx.hit(pid));
  const state = m.winnerId ? ' trn-decided' : live ? ' trn-live' : ' trn-pending';

  return (
    <div className="trn-match-outer">
      <div className={'trn-match' + state + (cardHit ? ' trn-hit' : '') + (pending ? ' trn-busy' : '')} aria-busy={pending || undefined}>
        <div className="trn-match-meta">
          <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }} title={matchRefLabel ? `Матч ${matchRefLabel}` : undefined}>
            {matchRefLabel && <span className="trn-match-ref">{matchRefLabel} · </span>}
            {FORMAT_LABELS[m.format] ?? m.format.toUpperCase()}
            {live && !editable && <span className="trn-live-dot" aria-label="матч можна грати" title="Обидва учасники відомі — матч можна грати" />}
          </span>
          {dropTarget && !m.winnerId && (
            <span className="trn-drop" title={`Програвший переходить у матч ${matchRef(dropTarget, ctx.doubleElim)}`}>↓ {matchRef(dropTarget, ctx.doubleElim)}</span>
          )}
          <span style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
            {pending && <span className="hint" style={{ margin: 0 }}>…</span>}
            {showReset && (
              <button type="button" className="trn-ctl" onClick={reset} title={m.winnerId ? 'Скасувати результат матчу' : 'Скинути рахунок серії'}>
                ↺
              </button>
            )}
            {editable && <FormatEditor value={m.format} onChange={(fmt) => run(editable.onSetFormat(m.id, fmt))} />}
          </span>
        </div>
        {[m.participant1Id, m.participant2Id].map((pid, i) => {
          const isWin = !!m.winnerId && pid === m.winnerId;
          const isLose = !!m.winnerId && !!pid && pid !== m.winnerId;
          const clickable = !!editable && !!pid && both && !m.winnerId && !pending && !downstreamDecided;
          const members = ctx.showMembers ? membersFor(pid, registrations) : [];
          const hit = !!pid && ctx.hit(pid);
          const title = clickable
            ? (isBo1 ? 'Клік — переможець матчу' : 'Клік — +1 перемога в серії')
            : editable && downstreamDecided && !!pid ? 'Спочатку скинь результат наступного матчу'
            : members.length ? members.join(', ') : undefined;
          return (
            <div
              key={i}
              className={'trn-slot' + (isWin ? ' win' : '') + (isLose ? ' lose' : '') + (clickable ? ' pickable' : '') + (hit ? ' hit' : '')}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={() => pick(pid)}
              title={title}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pick(pid);
                      }
                    }
                  : undefined
              }
            >
              <span className="trn-slot-body">
                {pid ? (
                  <span className="trn-slot-name">{nameFor(pid, registrations)}</span>
                ) : (
                  <span className="trn-slot-src">{sources[i] ?? '—'}</span>
                )}
                {members.length > 0 && <span className="trn-slot-members" title={members.join(', ')}>{members.join(', ')}</span>}
              </span>
              {!isBo1 && score && <span className="trn-slot-score">{score[i]}</span>}
              {isWin && <span className="trn-win-mark" aria-hidden="true">✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Заголовок секції («Верхня сітка · 4/7 зіграно») ─────────────────────

function Band({ title, matches, hint }: { title: string; matches: BracketMatch[]; hint?: string }) {
  const played = matches.filter((m) => m.winnerId).length;
  return (
    <div className="trn-band">
      <span className="trn-band-title">{title}</span>
      {matches.length > 0 && <span className="badge mute">{played}/{matches.length} зіграно</span>}
      {hint && <span className="hint" style={{ margin: 0 }}>{hint}</span>}
    </div>
  );
}

// ── Колонки по раундах (double_elim, старий вигляд single_elim) ─────────

const COL_MATCH_W = 200;
const COL_CONN_W = 36;
const COL_GAP = 12;
const COL_CHAMPION_H = 64;
const DEFAULT_MATCH_H = 84;

/** Рядок сітки колонками по раундах. Позиція матчу — по центру між
 * матчами попереднього раунду, що ведуть у нього (nextMatchId); якщо в
 * матч веде один (раунд «з підсадкою» в нижній сітці або гранд-фінал після
 * фіналу верхньої) — рівно навпроти нього. Висота картки вимірюється з DOM
 * (максимум по рядку), а не хардкодиться. Конектори між колонками —
 * прямі відрізки під 90°, як у дзеркальній сітці. */
function ColumnsBracket({
  rowMatches,
  roundLabel: label,
  ctx,
  champion,
}: {
  rowMatches: BracketMatch[];
  roundLabel: (r: number) => string;
  ctx: MatchCtx;
  /** під останньою колонкою — корона з іменем чемпіона (або заглушка) */
  champion?: { name: string | null };
}) {
  const [matchH, setMatchH] = useState(DEFAULT_MATCH_H);
  const gridRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const cards = gridRef.current?.querySelectorAll<HTMLElement>('.trn-match');
    if (!cards || cards.length === 0) return;
    let h = 0;
    cards.forEach((c) => { h = Math.max(h, c.getBoundingClientRect().height); });
    if (h && Math.abs(h - matchH) > 1) setMatchH(h);
  });

  const layout = useMemo(() => {
    const rounds = Array.from(new Set(rowMatches.map((m) => m.round))).sort((a, b) => a - b);
    const byRound = new Map<number, BracketMatch[]>(rounds.map((r) => [r, rowMatches.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot)]));
    const pitch = matchH + COL_GAP;
    const maxCount = Math.max(...rounds.map((r) => byRound.get(r)!.length));
    const columnHeight = maxCount * pitch - COL_GAP;
    const centers = new Map<string, number>();
    const feedersOf = new Map<string, BracketMatch[]>();
    rounds.forEach((r, i) => {
      const list = byRound.get(r)!;
      const prev = i > 0 ? byRound.get(rounds[i - 1])! : [];
      list.forEach((m, s) => {
        const feeders = prev.filter((f) => f.nextMatchId === m.id);
        feedersOf.set(m.id, feeders);
        let c: number;
        if (feeders.length > 0) c = feeders.reduce((sum, f) => sum + centers.get(f.id)!, 0) / feeders.length;
        else c = (s + 0.5) * (columnHeight + COL_GAP) / list.length - COL_GAP / 2; // рівномірно, якщо звʼязків немає
        centers.set(m.id, c);
      });
    });
    return { rounds, byRound, columnHeight, centers, feedersOf };
  }, [rowMatches, matchH]);

  if (rowMatches.length === 0) return null;
  const { rounds, byRound, columnHeight, centers, feedersOf } = layout;
  const matchCol = (i: number) => 1 + i * 2;
  const connCol = (i: number) => i * 2;
  const bodyH = columnHeight + (champion ? COL_CHAMPION_H : 0);
  const lastRound = rounds[rounds.length - 1];
  const lastMatch = byRound.get(lastRound)![0];

  return (
    <div className="bracket-scroll" style={{ overflowX: 'auto', paddingBottom: 8 }}>
      <div
        ref={gridRef}
        className="trn-grid"
        style={{
          gridTemplateColumns: rounds.map((_, i) => (i === 0 ? `${COL_MATCH_W}px` : `${COL_CONN_W}px ${COL_MATCH_W}px`)).join(' '),
          gridTemplateRows: `28px ${bodyH}px`,
        }}
      >
        {rounds.map((r, i) => (
          <div key={'h' + r} className="trn-header" style={{ gridColumn: matchCol(i), gridRow: 1 }}>
            {label(r)}
          </div>
        ))}
        {rounds.map((r, i) => (
          <div key={'c' + r} style={{ gridColumn: matchCol(i), gridRow: 2, position: 'relative' }}>
            {/* Комірка фіксованої (максимальної) висоти, картка центрована в ній —
                картки без складу нижчі, а конектор цілить у центр комірки. */}
            {byRound.get(r)!.map((m) => (
              <div key={m.id} style={{ position: 'absolute', left: 0, right: 0, top: centers.get(m.id)! - matchH / 2, height: matchH, display: 'flex', alignItems: 'center' }}>
                <TrnMatch m={m} ctx={ctx} matchRefLabel={ctx.doubleElim ? matchRef(m, true) : undefined} />
              </div>
            ))}
            {champion && i === rounds.length - 1 && lastMatch && (
              <div
                className={'trn-champion' + (champion.name ? ' has-champion' : '')}
                style={{ position: 'absolute', left: 0, right: 0, top: centers.get(lastMatch.id)! + matchH / 2 + 12 }}
              >
                <span className="trn-crown" aria-hidden="true">🏆</span>
                <span>{champion.name || 'Переможець турніру'}</span>
              </div>
            )}
          </div>
        ))}
        {rounds.map((r, i) => {
          if (i === 0) return null;
          const segs: { style: CSSProperties; v?: boolean }[] = [];
          for (const m of byRound.get(r)!) {
            const feeders = feedersOf.get(m.id) ?? [];
            if (feeders.length === 0) continue;
            const y = centers.get(m.id)!;
            const ys = feeders.map((f) => centers.get(f.id)!);
            for (const fy of ys) segs.push({ style: { left: 0, width: '50%', top: fy } });
            segs.push({ style: { left: '50%', width: '50%', top: y } });
            const lo = Math.min(...ys, y), hi = Math.max(...ys, y);
            if (hi - lo > 0.5) segs.push({ v: true, style: { left: '50%', top: lo, height: hi - lo } });
          }
          return (
            <div key={'k' + r} className="trn-conn" style={{ gridColumn: connCol(i), gridRow: 2 }} aria-hidden="true">
              {segs.map((s, j) => <div key={j} className={s.v ? 'trn-conn-v' : 'trn-conn-h'} style={s.style} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Дзеркальна сітка single_elim ────────────────────────────────────────

const TRN_MATCH_W = 176;
const TRN_CONN_W = 36;
const TRN_FINAL_W = 196;
const TRN_ROW_H = 40;
const TRN_ROW_H_EDIT = 48;
const TRN_ROW_GAP = 8;

/** Розкладка колонок/рядків grid-сітки: обидві половини дзеркальні відносно
 * фіналу в центрі (структура завжди — повне бінарне дерево, бай-матчі
 * резолвляться на бекенді одразу при генерації, тож round/slot завжди щільні). */
function buildMirrorLayout(bracketSize: number) {
  const roundCount = Math.log2(bracketSize);
  const halfRounds = roundCount - 1;
  const halfSize = bracketSize / 2;
  const matchesAt = (r: number) => bracketSize / 2 ** (r + 1);
  const halfMatchesAt = (r: number) => matchesAt(r) / 2;
  const localSpan = (r: number) => 2 ** (r + 1);

  let col = 1;
  const leftMatchCol: number[] = [];
  const leftConnCol: number[] = [];
  for (let r = 0; r < halfRounds; r++) {
    leftMatchCol[r] = col++;
    leftConnCol[r] = col++;
  }
  const finalCol = col++;
  const rightConnCol: number[] = [];
  const rightMatchCol: number[] = [];
  for (let r = halfRounds - 1; r >= 0; r--) {
    rightConnCol[r] = col++;
    rightMatchCol[r] = col++;
  }
  const totalCols = col - 1;

  const colWidths: number[] = [];
  for (let c = 1; c <= totalCols; c++) {
    if (c === finalCol) colWidths.push(TRN_FINAL_W);
    else if (leftConnCol.includes(c) || rightConnCol.includes(c)) colWidths.push(TRN_CONN_W);
    else colWidths.push(TRN_MATCH_W);
  }

  interface Cell { round: number; slot: number; gridColumn: number; gridRow: string; }
  const cells: Cell[] = [];
  for (let r = 0; r < halfRounds; r++) {
    const span = localSpan(r);
    const count = halfMatchesAt(r);
    for (let i = 0; i < count; i++) {
      cells.push({ round: r + 1, slot: i, gridColumn: leftMatchCol[r], gridRow: `${i * span + 2} / span ${span}` });
      cells.push({ round: r + 1, slot: halfMatchesAt(r) + i, gridColumn: rightMatchCol[r], gridRow: `${halfSize + i * span + 2} / span ${span}` });
    }
  }

  // points — % висоти комірки, де лінія торкається карток-"дітей" (завжди
  // 25%/75% для звичайного парного злиття — це універсально, не залежить
  // від рівня, бо комірка конектора завжди дзеркально обрамляє рівно двох
  // дітей). Для входу в фінал дитина лише одна (свій бік половини),
  // а друга "точка" — це вже центр фіналу (50%), тому points містить лише
  // одне значення.
  interface Conn { gridColumn: number; gridRow: string; mirrored: boolean; points: number[]; }
  const connectors: Conn[] = [];
  for (let r = 0; r < halfRounds; r++) {
    const toFinal = r === halfRounds - 1;
    if (toFinal) {
      // Останній раунд половини заходить прямо у фінал. Фінал центрований
      // по ВСІЙ висоті сітки (а не по половині), тож щоб лінія дійсно
      // домальовувалась до його центру, конектор теж має займати всю
      // висоту — інакше горизонталь опиняється на висоті центру половини
      // (25%/75%), а не центру фіналу (50%), і лінія "висить у повітрі".
      connectors.push({ gridColumn: leftConnCol[r], gridRow: `2 / span ${bracketSize}`, mirrored: false, points: [25] });
      connectors.push({ gridColumn: rightConnCol[r], gridRow: `2 / span ${bracketSize}`, mirrored: true, points: [75] });
    } else {
      const span = localSpan(r + 1);
      const count = halfMatchesAt(r + 1);
      for (let i = 0; i < count; i++) {
        connectors.push({ gridColumn: leftConnCol[r], gridRow: `${i * span + 2} / span ${span}`, mirrored: false, points: [25, 75] });
        connectors.push({ gridColumn: rightConnCol[r], gridRow: `${halfSize + i * span + 2} / span ${span}`, mirrored: true, points: [25, 75] });
      }
    }
  }

  interface Header { gridColumn: string; label: string; }
  const headers: Header[] = [];
  for (let r = 0; r < halfRounds; r++) {
    const label = roundLabel(roundCount - 1 - r);
    headers.push({ gridColumn: `${leftMatchCol[r]} / span 2`, label });
    headers.push({ gridColumn: `${rightConnCol[r]} / span 2`, label });
  }
  headers.push({ gridColumn: `${finalCol} / span 1`, label: 'Фінал' });

  return { totalCols, colWidths, cells, connectors, headers, finalCol, finalRound: roundCount, bodyRows: bracketSize };
}

/** Лінія-конектор — не суцільний "T", а прямі відрізки під 90°: короткий
 * горизонтальний "вусик" від картки-дитини до вертикалі, вертикаль, і
 * горизонталь у батьківську картку — як на референсі (PW-турнірна сітка),
 * де лінія відходить від блочка під прямим кутом, а не прилягає до нього. */
interface ConnSeg { axis: 'h' | 'v'; pos: number; from: number; to: number }
function connectorSegments(mirrored: boolean, points: number[]): ConnSeg[] {
  const childX = mirrored ? 100 : 0;
  const parentX = mirrored ? 0 : 100;
  const elbowX = 50;
  const segs: ConnSeg[] = points.map((p) => ({ axis: 'h', pos: p, from: Math.min(childX, elbowX), to: Math.max(childX, elbowX) }));
  segs.push({ axis: 'h', pos: 50, from: Math.min(elbowX, parentX), to: Math.max(elbowX, parentX) });
  const allY = [...points, 50];
  segs.push({ axis: 'v', pos: elbowX, from: Math.min(...allY), to: Math.max(...allY) });
  return segs;
}

function TrnConnector({ mirrored, points }: { mirrored: boolean; points: number[] }) {
  return (
    <>
      {connectorSegments(mirrored, points).map((s, i) =>
        s.axis === 'h' ? (
          <div key={i} className="trn-conn-h" style={{ left: `${s.from}%`, width: `${s.to - s.from}%`, top: `${s.pos}%` }} />
        ) : (
          <div key={i} className="trn-conn-v" style={{ top: `${s.from}%`, height: `${s.to - s.from}%`, left: `${s.pos}%` }} />
        ),
      )}
    </>
  );
}

function SingleElimBracket({ matches, ctx, thirdPlace }: { matches: BracketMatch[]; ctx: MatchCtx; thirdPlace: BracketMatch | null }) {
  const round1Count = matches.filter((m) => m.round === 1).length;
  const bracketSize = round1Count * 2;
  const layout = useMemo(() => (bracketSize >= 2 ? buildMirrorLayout(bracketSize) : null), [bracketSize]);

  // Висота рядка НЕ хардкодиться (як і в ColumnsBracket) — вимірюється з
  // реальних карток (.trn-match, максимум), а не з комірок grid: комірка
  // завжди рівно 2 рядки, і по ній не видно, що картка (зі складом команди)
  // вища. TRN_ROW_GAP — гарантований проміжок між сусідніми картками.
  const [rowH, setRowH] = useState(ctx.editable ? TRN_ROW_H_EDIT : TRN_ROW_H);
  const [cardH, setCardH] = useState(rowH * 2 - TRN_ROW_GAP);
  const gridRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const cards = gridRef.current?.querySelectorAll<HTMLElement>('.trn-match');
    if (!cards || cards.length === 0) return;
    let h = 0;
    cards.forEach((c) => { h = Math.max(h, c.getBoundingClientRect().height); });
    if (h) {
      if (Math.abs(h - cardH) > 1) setCardH(h);
      const next = Math.ceil((h - TRN_ROW_GAP) / 2);
      if (Math.abs(next - rowH) > 1) setRowH(next);
    }
  });

  if (!layout) return null;
  const findMatch = (round: number, slot: number) => matches.find((m) => m.round === round && m.slot === slot);
  const finalMatch = findMatch(layout.finalRound, 0);
  const championName = finalMatch?.winnerId ? nameFor(finalMatch.winnerId, ctx.registrations) : null;

  return (
    <div>
      <div className="bracket-scroll" style={{ overflowX: 'auto', paddingBottom: 10 }}>
        <div
          ref={gridRef}
          className="trn-grid"
          style={{
            gridTemplateColumns: layout.colWidths.map((w) => w + 'px').join(' '),
            gridTemplateRows: `28px repeat(${layout.bodyRows}, ${rowH}px)`,
            rowGap: TRN_ROW_GAP,
          }}
        >
          {layout.headers.map((h, i) => (
            <div key={i} className="trn-header" style={{ gridColumn: h.gridColumn, gridRow: '1' }}>
              {h.label}
            </div>
          ))}

          {layout.cells.map((c, i) => {
            const m = findMatch(c.round, c.slot);
            if (!m) return null;
            return (
              <div key={i} style={{ gridColumn: c.gridColumn, gridRow: c.gridRow, display: 'flex', alignItems: 'center' }}>
                <TrnMatch m={m} ctx={ctx} />
              </div>
            );
          })}

          {layout.connectors.map((c, i) => (
            <div key={i} className="trn-conn" style={{ gridColumn: c.gridColumn, gridRow: c.gridRow }} aria-hidden="true">
              <TrnConnector mirrored={c.mirrored} points={c.points} />
            </div>
          ))}

          {finalMatch && (
            <div className="trn-final-cell" style={{ gridColumn: `${layout.finalCol}`, gridRow: `2 / span ${layout.bodyRows}` }}>
              {/* Картка позиціонується абсолютно рівно по центру комірки (50%) —
                  саме туди й цілять конектори. Корону кладемо ПІД нею окремим
                  абсолютним блоком, а не в тому самому flex-centered стеку:
                  інакше центрується пара "картка+корона" разом, і сама картка
                  зсувається вище за 50% — конектори не дотягувались до неї. */}
              <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)' }}>
                <TrnMatch m={finalMatch} ctx={ctx} />
              </div>
              <div
                className={'trn-champion' + (championName ? ' has-champion' : '')}
                style={{ position: 'absolute', left: 0, right: 0, top: `calc(50% + ${cardH / 2 + 14}px)` }}
              >
                <span className="trn-crown" aria-hidden="true">🏆</span>
                <span>{championName || 'Переможець турніру'}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {thirdPlace && (
        <div style={{ marginTop: 20, maxWidth: 240 }}>
          <Band title="Матч за 3-тє місце" matches={[thirdPlace]} />
          <TrnMatch m={thirdPlace} ctx={ctx} />
        </div>
      )}
    </div>
  );
}

// ── Список по раундах (телефони) ────────────────────────────────────────

interface ListSection { title: string; matches: BracketMatch[]; label: (r: number) => string; hint?: string }

function BracketList({ sections, ctx }: { sections: ListSection[]; ctx: MatchCtx }) {
  return (
    <div className="trn-list">
      {sections.filter((s) => s.matches.length > 0).map((s) => {
        const rounds = Array.from(new Set(s.matches.map((m) => m.round))).sort((a, b) => a - b);
        return (
          <div key={s.title}>
            <Band title={s.title} matches={s.matches} hint={s.hint} />
            {rounds.map((r) => {
              const list = s.matches.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot);
              const played = list.filter((m) => m.winnerId).length;
              // Розгорнуто те, що ще грається; зіграні раунди — згорнуті, щоб не скролити повз них.
              const open = played < list.length;
              return (
                <details key={r} className="card trn-list-round" open={open}>
                  <summary>
                    <span className="trn-header" style={{ justifyContent: 'flex-start' }}>{rounds.length > 1 || s.matches.length > 1 ? s.label(r) : s.title}</span>
                    <span className="hint" style={{ margin: 0 }}>{played}/{list.length} зіграно</span>
                  </summary>
                  <div className="trn-list-matches">
                    {list.map((m) => <TrnMatch key={m.id} m={m} ctx={ctx} matchRefLabel={ctx.doubleElim ? matchRef(m, true) : undefined} />)}
                  </div>
                </details>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Обгортка: пошук, вигляд, фулскрін ───────────────────────────────────

type View = 'grid' | 'list';
const VIEW_KEY = 'pw-pvp:bracketView';

function initialView(): View {
  try {
    const stored = localStorage.getItem(VIEW_KEY);
    if (stored === 'grid' || stored === 'list') return stored;
  } catch { /* приватний режим тощо */ }
  return typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches ? 'list' : 'grid';
}

export default function BracketView({ matches, registrations, editable, bracketNewLook = true, title }: Props) {
  const [fullscreen, setFullscreen] = useState(false);
  const [view, setView] = useState<View>(initialView);
  const [query, setQuery] = useState('');
  // Публічно — одразу підсвічуємо «свою» команду за ніком з форми заявки
  // (якщо він узагалі є в цій сітці); в адмінці поле порожнє. Ефект, а не
  // ініціалізатор стану: учасники можуть довантажитись після першого рендеру.
  const prefilled = useRef(false);
  useEffect(() => {
    if (editable || prefilled.current || registrations.length === 0) return;
    prefilled.current = true;
    const nick = readLastNickname().trim();
    const low = nick.toLowerCase();
    if (!low) return;
    const found = registrations.some((r) => r.nickname.toLowerCase().includes(low) || (r.memberNicknames ?? []).some((n) => n.toLowerCase().includes(low)));
    if (found) setQuery(nick);
  }, [editable, registrations]);

  const chooseView = (v: View) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ok */ }
  };

  // Лок скролу сторінки під час фулскріна — інакше видно ОДРАЗУ два скролбари:
  // власний (тематизований, .bracket-scroll) і фоновий скролбар <body>.
  useEffect(() => {
    if (!fullscreen) return;
    document.body.classList.add('modal-open');
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', onKey);
    };
  }, [fullscreen]);

  const winners = matches.filter((m) => m.bracketSide === 'winners');
  const losers = matches.filter((m) => m.bracketSide === 'losers');
  const final = matches.filter((m) => m.bracketSide === 'final');
  const thirdPlace = matches.find((m) => m.bracketSide === 'third_place') ?? null;
  const isDoubleElim = losers.length > 0 || final.length > 0;
  const showMembers = registrations.some((r) => r.memberNicknames && r.memberNicknames.length > 0);
  const wbMaxRound = winners.length > 0 ? Math.max(...winners.map((m) => m.round)) : 0;
  const decisiveId = final[0]?.id ?? winners.find((m) => m.round === wbMaxRound)?.id ?? null;

  // Пошук: збіг по назві учасника/команди або по ніку в складі команди.
  const q = query.trim().toLowerCase();
  const hitIds = useMemo(() => {
    const set = new Set<string>();
    if (!q) return set;
    for (const r of registrations) {
      if (r.nickname.toLowerCase().includes(q) || (r.memberNicknames ?? []).some((n) => n.toLowerCase().includes(q))) set.add(r.id);
    }
    return set;
  }, [q, registrations]);
  const hitMatches = q ? matches.filter((m) => (m.participant1Id && hitIds.has(m.participant1Id)) || (m.participant2Id && hitIds.has(m.participant2Id))).length : 0;

  // Знайшли — підкручуємо до найближчого live-матчу (або першого зі збігом).
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!q || !rootRef.current) return;
    const el = rootRef.current.querySelector('.trn-match.trn-hit.trn-live') ?? rootRef.current.querySelector('.trn-match.trn-hit');
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [q, view, fullscreen]);

  const ctx: MatchCtx = { registrations, editable, all: matches, doubleElim: isDoubleElim, hit: (pid) => !!pid && hitIds.has(pid), showMembers, decisiveId };

  if (matches.length === 0) return <p className="hint">Сітку ще не згенеровано.</p>;

  // Гранд-фінал — колонкою після фіналу верхньої: псевдораунд wbMax+1 у тому
  // ж рядку (у нього веде nextMatchId фіналу верхньої, тож стане навпроти).
  const wbRow = isDoubleElim ? [...winners, ...final.map((f) => ({ ...f, round: wbMaxRound + 1 }))] : winners;
  const wbLabel = (r: number) => (r > wbMaxRound ? 'Гранд-фінал' : r === wbMaxRound ? 'Фінал верхньої' : `Раунд ${r}`);
  const lbMaxRound = losers.length > 0 ? Math.max(...losers.map((m) => m.round)) : 0;
  const lbLabel = (r: number) => (r === lbMaxRound ? 'Фінал нижньої' : `Раунд ${r}`);
  const singleElimLabel = (r: number) => (r === wbMaxRound ? 'Фінал' : r === wbMaxRound - 1 && wbMaxRound > 1 ? 'Півфінал' : `Раунд ${r}`);
  const grandFinal = final[0];
  const decisiveMatch = matches.find((m) => m.id === decisiveId);
  const championName = decisiveMatch?.winnerId ? nameFor(decisiveMatch.winnerId, registrations) : null;
  const lbHint = 'Програвший у верхній переходить сюди; другий програш — виліт. Переможець нижньої грає гранд-фінал.';

  const listSections: ListSection[] = isDoubleElim
    ? [
        { title: 'Верхня сітка', matches: winners, label: wbLabel },
        { title: 'Нижня сітка', matches: losers, label: lbLabel, hint: lbHint },
        { title: 'Гранд-фінал', matches: final, label: () => 'Гранд-фінал' },
        ...(thirdPlace ? [{ title: 'Матч за 3-тє місце', matches: [thirdPlace], label: () => '3-тє місце' }] : []),
      ]
    : [
        { title: 'Сітка', matches: winners, label: singleElimLabel },
        ...(thirdPlace ? [{ title: 'Матч за 3-тє місце', matches: [thirdPlace], label: () => '3-тє місце' }] : []),
      ];

  const viewBtn = (v: View, label: string) => (
    <button type="button" className={'btn btn-sm ' + (view === v ? 'btn-primary' : 'btn-ghost')} onClick={() => chooseView(v)} aria-pressed={view === v}>{label}</button>
  );

  return (
    <div ref={rootRef} className={(fullscreen ? 'trn-fullscreen ' : '') + (q ? 'trn-filtering' : '')}>
      <div className="trn-toolbar">
        {fullscreen && title && <span className="trn-fullscreen-title">{title}</span>}
        <span className="trn-search">
          <input
            type="search"
            value={query}
            placeholder={showMembers ? 'Знайти нік або команду' : 'Знайти учасника'}
            aria-label="Пошук у сітці"
            onChange={(e) => setQuery(e.target.value)}
          />
          {q && <span className="hint" style={{ margin: 0, whiteSpace: 'nowrap' }}>{hitMatches ? `матчів: ${hitMatches}` : 'не знайдено'}</span>}
        </span>
        <span style={{ display: 'inline-flex', gap: 6, marginLeft: 'auto' }}>
          {viewBtn('grid', 'Сітка')}
          {viewBtn('list', 'Список')}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFullscreen((v) => !v)}>
            {fullscreen ? '✕ Згорнути' : '⛶ На весь екран'}
          </button>
        </span>
      </div>

      {/* margin: auto у flex-контейнері центрує сітку по обох осях, коли вона
          менша за екран, і чесно деградує до звичайного скролу (margin 0),
          коли більша — на відміну від align/justify-center, які в скрол-
          контейнері обрізали б початок контенту. */}
      <div style={fullscreen ? { margin: 'auto', maxWidth: '100%' } : undefined}>
        {view === 'list' ? (
          <BracketList sections={listSections} ctx={ctx} />
        ) : isDoubleElim ? (
          <>
            <Band title="Верхня сітка" matches={[...winners, ...final]} />
            <ColumnsBracket rowMatches={wbRow} roundLabel={wbLabel} ctx={ctx} champion={grandFinal ? { name: championName } : undefined} />

            {losers.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Band title="Нижня сітка" matches={losers} hint={lbHint} />
                <ColumnsBracket rowMatches={losers} roundLabel={lbLabel} ctx={ctx} />
              </div>
            )}

            {thirdPlace && (
              <div style={{ marginTop: 8, maxWidth: 240 }}>
                <Band title="Матч за 3-тє місце" matches={[thirdPlace]} />
                <TrnMatch m={thirdPlace} ctx={ctx} />
              </div>
            )}
          </>
        ) : bracketNewLook ? (
          <SingleElimBracket matches={winners} ctx={ctx} thirdPlace={thirdPlace} />
        ) : (
          <>
            <ColumnsBracket rowMatches={winners} roundLabel={singleElimLabel} ctx={ctx} champion={{ name: championName }} />
            {thirdPlace && (
              <div style={{ marginTop: 8, maxWidth: 240 }}>
                <Band title="Матч за 3-тє місце" matches={[thirdPlace]} />
                <TrnMatch m={thirdPlace} ctx={ctx} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
