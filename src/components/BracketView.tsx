// =========================================================
// Рендер турнірної сітки. Той самий компонент для публічного read-only
// перегляду (TournamentPage, BracketSharePage) і адмінського редактора
// (BracketPanel) — різниця лише в наявності `editable`.
//
// Візуал B (макети «Ігрове вікно» з нинішніми кольорами): картка матчу —
// шапка «адреса · формат · ↓ куди йде програвший», два рядки-слоти (назва,
// склад скорочено до «+N» — лише в сітці, у списку картка ширша й склад іде
// рядком із трикрапкою; рахунок серії і ✓). Порожній слот показує, звідки
// прийде учасник («переможець В1.2»). Стани: чекає (пунктир) · live (обидва
// є, переможця немає — підсвічена рамка) · вирішено.
//
// Уся сітка — одне полотно з однією прокруткою (bracket/layout.ts): верхня
// й нижня сітки в тих самих колонках, гранд-фінал між ними, під вирішальним
// матчем — блок переможця; лінії — SVG. Над сіткою — «Підсумок турніру»
// (пʼєдестал) і смужка «Шлях».
//
// Шлях команди (картки й лінії золотом, решта притемнена, етапи списком у
// смужці «Шлях») — за пошуком (нік гравця або назва команди), наведенням чи
// фокусом із клавіатури (разом із підказкою: склад з класами й рангами,
// матчі; підказка — aria-describedby рядка) або закріплений (з панелі матчу,
// пʼєдесталу, блоку переможця). Без вибраної команди лінії шляху чемпіона
// трохи яскравіші (у легенді «шлях чемпіона» — лише коли чемпіон уже є).
// Клік по матчу — панель матчу (bracket/MatchPanel.tsx), закривається
// хрестиком або Esc; фокус повертається на рядок (або картку), з якого відкрили.
// Публічно пошук одразу заповнюється ніком із localStorage (з форми заявки).
//
// Редактор: клік по слоту — переможець (BO1) або +1 у серії; проміжний
// рахунок серії зберігається в bracket_matches.score (видно всім і після
// перезавантаження). Вирішений матч не перемикається кліком — лише ↺,
// і лише поки наступний матч не вирішено. Поки запит у дорозі — картка
// заблокована (подвійний тап не дає +2). У редакторі немає наведення й
// панелі матчу — клік належить вибору переможця. Шапка картки в редакторі
// не обрізає керування: коли видно ↺ чи поле власного формату, «↓ Н1.1»
// ховається (адреса є в підказці), а в крайньому разі шапка переноситься.
//
// «Список» — вертикальний вигляд по раундах для телефонів. Розгорнуті раунди,
// що ще граються, і раунди закріпленого / знайденого шляху (не наведення);
// раунд, який користувач сам розгорнув чи згорнув, так і лишається.
// =========================================================

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react';
import type { BalanceStats, BracketMatch, Registration } from '../data/types';
import { readLastNickname } from '../app/lastNickname';
import {
  bracketInfo, byBracketOrder, formatLabel, isBo1, matchRef, nameFor, parseScore, podiumIds, requiredWins, rosterFor, searchParticipants, shortRoster,
  sourceLabels, teamPath, type BracketData, type PathStep, type RosterMember,
} from './bracket/model';
import { edgeKey, LB_HINT, layoutBracket, type LayoutKind } from './bracket/layout';
import MatchPanel from './bracket/MatchPanel';
import TeamPopover from './bracket/TeamPopover';
import { PathBar, PodiumStrip } from './bracket/Strips';
import './bracket/bracket.css';

const KNOWN_FORMATS = ['bo1', 'bo3', 'bo5'];
const DECISIVE_CONFIRM = 'Це вирішальний матч — турнір одразу стане «Завершено». Продовжити?';

/** Ширина картки підлаштовується під ширину сторінки (сітка без прокрутки, коли
 * вміщається), у межах [min, max]; з другим рядком складу — ширша. Гранд-фінал/
 * фінал — на FINAL_EXTRA ширший. Не вміщається навіть з мінімальною — прокрутка. */
const CARD_W = { team: { min: 184, max: 236 }, solo: { min: 168, max: 208 } };
const FINAL_EXTRA = 24;
/** Проміжок між колонками (тут ламаються лінії): звичайний і запасні вужчі. */
const COL_GAPS = [40, 32, 28];
const ROW_GAP = 18;
const HEAD_H = 26;
/** Ключ лінії «вирішальний матч → блок переможця» у наборах підсвічених ліній. */
const CHAMP_EDGE = 'champion';
/** Місце під рахунок/✓ і відступи в рядку слота — решта ширини йде на склад. */
const ROSTER_RESERVE = 65;
const ROSTER_FONT = "500 11px 'e-Ukraine', system-ui, sans-serif";
/** Список: склад не скорочується до «+N» (рядок обрізає CSS-трикрапка). */
const FITS_ALWAYS = (): boolean => true;

/** Скільки колонок карток у полотні (для ширини картки «під сторінку»). */
function columnCount(kind: LayoutKind, matches: BracketMatch[], wbMax: number, lbMax: number): number {
  if (kind === 'double') return Math.max(wbMax, lbMax) + (matches.some((m) => m.bracketSide === 'final') ? 1 : 0);
  if (kind === 'mirror') return Math.max(1, 2 * (wbMax - 1) + 1);
  return Math.max(1, wbMax);
}

/** Ширина картки й проміжок між колонками, з якими сітка вміщається в `avail` px:
 * спершу звужуються картки (до min), потім проміжки (до найменшого); не вміщається —
 * найвужчий варіант і прокрутка. */
export function fitColumns(avail: number, cols: number, range: { min: number; max: number }): { cardW: number; colGap: number } {
  if (!avail) return { cardW: range.min, colGap: COL_GAPS[0] };
  for (const gap of COL_GAPS) {
    const w = Math.floor((avail - FINAL_EXTRA - (cols - 1) * gap) / cols);
    if (w >= range.min) return { cardW: Math.min(range.max, w), colGap: gap };
  }
  return { cardW: range.min, colGap: COL_GAPS[COL_GAPS.length - 1] };
}

// Вимір тексту складу шрифтом картки (canvas) — щоб «+N» з'являвся рівно тоді,
// коли склад не вміщається. Без canvas (тести, SSR) — оцінка за довжиною.
let measureCtx: CanvasRenderingContext2D | null | undefined;
function textWidth(s: string): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      measureCtx = null;
    }
  }
  if (!measureCtx) return s.length * 6.4;
  measureCtx.font = ROSTER_FONT;
  return measureCtx.measureText(s).width;
}

/** Формат матчу в редакторі. `custom` (поле «напр. bo7» замість селекта) тримає картка —
 * від нього залежить, що ще вміщається в шапку. */
function FormatEditor({ value, custom, setCustom, onChange }: { value: string; custom: boolean; setCustom: (v: boolean) => void; onChange: (v: string) => void }) {
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
          aria-label="Формат матчу"
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
      aria-label="Формат матчу"
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

interface Props {
  matches: BracketMatch[];
  registrations: Registration[];
  editable?: BracketEditable;
  /** single_elim: дзеркальна сітка (true, за замовчуванням) чи колонки по
   * раундах (false, старий вигляд) — не впливає на double_elim. */
  bracketNewLook?: boolean;
  /** назва турніру — у шапці повноекранного режиму й у скопійованому підсумку */
  title?: string;
  /** склади зі знімка жеребки (tournament.balanceStats.teams) — класи й ранги в підказці й панелі */
  balanceTeams?: BalanceStats['teams'] | null;
}

/** Спільні для всіх карток параметри рендеру. */
interface MatchCtx {
  data: BracketData;
  editable?: BracketEditable;
  /** підсвітка пошуку, коли збіглось кілька команд */
  hit: (pid: string | null) => boolean;
  /** показувати склад команди другим рядком слота */
  showMembers: boolean;
  /** чи вміщається рядок складу в картку */
  fitsRoster: (text: string) => boolean;
  /** команда, чий шлях показано */
  focusId: string | null;
  pathIds: ReadonlySet<string>;
  /** матчі, з яких команда шляху впала в нижню сітку (↓ підсвічено) */
  dropOut: ReadonlySet<string>;
  /** матч нижньої → матч верхньої, звідки команда шляху туди впала (↑) */
  dropIn: ReadonlyMap<string, string>;
  selectedId: string | null;
  hoverPid: string | null;
  hoverMatchId: string | null;
  /** id підказки (role=tooltip), поки вона показана, — aria-describedby наведеного/фокусованого рядка */
  popoverId?: string;
  /** публічно: клік по матчу — панель */
  onOpen?: (matchId: string, opener: HTMLElement) => void;
  /** публічно: наведення/фокус на команді — шлях і підказка */
  onHover?: (pid: string | null, matchId?: string, el?: HTMLElement) => void;
}

// ── Картка матчу ────────────────────────────────────────────────────────

function TrnMatch({ m, ctx }: { m: BracketMatch; ctx: MatchCtx }) {
  const { data, editable } = ctx;
  const { info, matches: all } = data;
  const de = info.doubleElim;
  const bo1 = isBo1(m);
  const [pending, setPending] = useState(false);
  const [customFmt, setCustomFmt] = useState(() => !KNOWN_FORMATS.includes(m.format));
  const score = parseScore(m.score);
  const sources = useMemo(() => sourceLabels(m, all, de), [m, all, de]);
  // Наступний матч уже вирішено — цей чіпати не можна (інакше в наступному
  // лишиться учасник, якого там уже не мало б бути).
  const downstreamDecided = all.some((x) => (x.id === m.nextMatchId || x.id === m.loserNextMatchId) && !!x.winnerId);
  const dropTarget = m.loserNextMatchId ? info.byId.get(m.loserNextMatchId) : undefined;
  const dropInFrom = ctx.dropIn.get(m.id);
  const fromMatch = dropInFrom ? info.byId.get(dropInFrom) : undefined;
  const both = !!m.participant1Id && !!m.participant2Id;
  const live = both && !m.winnerId;
  const decisive = info.decisive?.id === m.id;
  const ref = matchRef(m, de);
  const interactive = !editable && !!ctx.onOpen;
  const onPath = ctx.pathIds.has(m.id);

  // Поки запит у дорозі — картка заблокована: подвійний тап не дає +2,
  // два швидкі кліки в BO1 не женуть два read-then-write.
  const run = (p: Promise<void> | void) => {
    setPending(true);
    Promise.resolve(p).finally(() => setPending(false));
  };

  const pick = (pid: string | null) => {
    if (!editable || !pid || !both || m.winnerId || pending || downstreamDecided) return;
    if (bo1) {
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
  // Редактор: у шапці ширини 184 px ↺ і поле власного формату не вміщаються разом із «↓ Н1.1»/«↑ В2.1» —
  // тоді ці позначки ховаємо (куди йде програвший — у підказці адреси матчу), а не обрізаємо керування.
  const crowded = !!editable && (showReset || customFmt);
  const dropRef = dropTarget ? matchRef(dropTarget, de) : null;
  const cardHit = [m.participant1Id, m.participant2Id].some((pid) => !!pid && ctx.hit(pid));
  const state = m.winnerId ? ' trn-decided' : live ? ' trn-live' : !m.participant1Id && !m.participant2Id ? ' trn-pending' : '';
  const cls = 'trn-match' + state
    + (ctx.showMembers ? '' : ' no-members')
    + (decisive ? ' decisive' : '')
    + (onPath ? ' on-path' : ctx.focusId ? ' dim' : '')
    + (ctx.selectedId === m.id ? ' selected' : '')
    + (cardHit ? ' trn-hit' : '')
    + (pending ? ' trn-busy' : '')
    + (interactive ? ' clickable' : '')
    + (editable ? ' editing' : '');

  return (
    <div className="trn-match-outer">
      <div
        className={cls}
        data-match-id={m.id}
        aria-busy={pending || undefined}
        // Картка фокусується програмно (tabIndex=-1, у Tab не потрапляє): сюди повертається фокус
        // після закриття панелі, якщо в картці немає жодного рядка-кнопки.
        tabIndex={interactive ? -1 : undefined}
        // Відкривач — рядок команди, по якому клікнули, інакше (клік по шапці) — перший рядок картки:
        // туди повернеться фокус після закриття панелі.
        onClick={interactive ? (e) => ctx.onOpen!(m.id, matchOpener(e.currentTarget, e.target)) : undefined}
        onPointerLeave={interactive ? () => ctx.onHover?.(null) : undefined}
      >
        <div className="trn-match-meta">
          <span className="trn-tag" title={`Матч ${ref}` + (dropRef && crowded ? ` · програвший переходить у ${dropRef}` : '')}>{ref}</span>
          {/* У редакторі формат показує селект праворуч, тож текстовий підпис не дублюємо. */}
          {editable ? <span style={{ flex: '1 1 auto' }} /> : <span className="trn-fmt">{formatLabel(m.format)}</span>}
          {live && !editable && <span className="trn-live-dot" role="img" aria-label="матч можна грати" title="Обидва учасники відомі — матч можна грати" />}
          {fromMatch && !crowded && (
            <span className="trn-drop on" title={`${data.nameOf(ctx.focusId)} прийшла сюди з матчу ${matchRef(fromMatch, de)}`}>↑ {matchRef(fromMatch, de)}</span>
          )}
          {dropRef && !crowded && (
            <span className={'trn-drop' + (ctx.dropOut.has(m.id) ? ' on' : '')} title={`Програвший переходить у матч ${dropRef}`}>↓ {dropRef}</span>
          )}
          {editable && (
            <span className="trn-match-ctl">
              {pending && <span className="hint" style={{ margin: 0 }}>…</span>}
              {showReset && (
                <button type="button" className="trn-ctl" onClick={reset} title={m.winnerId ? 'Скасувати результат матчу' : 'Скинути рахунок серії'}>
                  ↺
                </button>
              )}
              <FormatEditor value={m.format} custom={customFmt} setCustom={setCustomFmt} onChange={(fmt) => run(editable.onSetFormat(m.id, fmt))} />
            </span>
          )}
        </div>
        {[m.participant1Id, m.participant2Id].map((pid, i) => {
          const isWin = !!m.winnerId && pid === m.winnerId;
          const isLose = !!m.winnerId && !!pid && pid !== m.winnerId;
          const clickable = !!editable && !!pid && both && !m.winnerId && !pending && !downstreamDecided;
          const readable = interactive && !!pid;
          const roster: RosterMember[] = ctx.showMembers ? data.rosterOf(pid) : [];
          const names = roster.map((r) => r.nickname);
          const short = shortRoster(names, ctx.fitsRoster);
          const hit = !!pid && ctx.hit(pid);
          const focus = !!pid && pid === ctx.focusId;
          const hovered = !!pid && pid === ctx.hoverPid && m.id === ctx.hoverMatchId;
          const name = data.nameOf(pid);
          const scoreText = !bo1 && score ? String(score[i]) : '';
          const mark = isWin ? '✓' : focus && isLose ? '✕' : '';
          const title = clickable
            ? (bo1 ? 'Клік — переможець матчу' : 'Клік — +1 перемога в серії')
            : editable && downstreamDecided && !!pid ? 'Спочатку скинь результат наступного матчу'
            : !readable && names.length ? names.join(', ') : undefined;
          const ariaLabel = readable
            ? `${name}${names.length ? ` (${names.join(', ')})` : ''}, матч ${ref}`
              + (isWin ? ', перемога' : isLose ? ', поразка' : '')
              + (score && !bo1 ? `, рахунок ${score[i]}:${score[1 - i]}` : '')
              + '. Подробиці матчу'
            : undefined;
          return (
            <div
              key={i}
              className={'trn-slot' + (isWin ? ' win' : '') + (isLose ? ' lose' : '') + (clickable ? ' pickable' : '') + (hit ? ' hit' : '') + (focus ? ' focus' : '') + (hovered ? ' hovered' : '')}
              role={clickable || readable ? 'button' : undefined}
              tabIndex={clickable || readable ? 0 : undefined}
              aria-label={ariaLabel}
              // підказка зі складом (класи, ранги) — опис саме цього рядка, поки вона на екрані
              aria-describedby={hovered ? ctx.popoverId : undefined}
              onClick={editable ? () => pick(pid) : undefined}
              title={title}
              onPointerEnter={readable ? (e: ReactPointerEvent<HTMLDivElement>) => { if (e.pointerType === 'mouse') ctx.onHover?.(pid, m.id, e.currentTarget); } : undefined}
              onFocus={readable ? (e) => { if (focusVisible(e.currentTarget)) ctx.onHover?.(pid, m.id, e.currentTarget); } : undefined}
              onBlur={readable ? () => ctx.onHover?.(null) : undefined}
              onKeyDown={
                clickable || readable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (clickable) pick(pid);
                        else ctx.onOpen?.(m.id, e.currentTarget);
                      }
                    }
                  : undefined
              }
            >
              <span className="trn-slot-bar" aria-hidden="true" />
              <span className="trn-slot-body">
                {pid ? (
                  <span className="trn-slot-name" title={readable ? undefined : name}>{name}</span>
                ) : (
                  <span className="trn-slot-src">{sources[i] ?? '—'}</span>
                )}
                {names.length > 0 && (
                  <span className="trn-slot-members">
                    <span className="trn-slot-members-txt">{short.shown}</span>
                    {short.more > 0 && <span className="trn-slot-more">+{short.more}</span>}
                  </span>
                )}
              </span>
              {(scoreText || mark) && (
                <span className="trn-slot-res">
                  {scoreText}
                  {mark && <span className="mark" aria-hidden="true">{mark}</span>}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Куди повернути фокус після закриття панелі матчу: рядок-кнопка, по якому клікнули; клік по
 * шапці чи порожньому місцю — перший рядок-кнопка картки; таких немає — сама картка (tabIndex=-1). */
export function matchOpener(card: HTMLElement, target: EventTarget | null): HTMLElement {
  const el = target as Element | null;
  const hit = el && typeof el.closest === 'function' ? el.closest<HTMLElement>('[role="button"]') : null;
  if (hit && card.contains(hit)) return hit;
  return card.querySelector<HTMLElement>('[role="button"]') ?? card;
}

function focusVisible(el: HTMLElement): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

// ── Блок переможця під вирішальним матчем ──────────────────────────────

function Trophy({ size = 18 }: { size?: number }) {
  return (
    <svg className="trn-trophy" width={size} height={size} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M8 4h12v7a6 6 0 0 1-12 0z" />
      <path d="M8 6H4v2a4 4 0 0 0 4 4M20 6h4v2a4 4 0 0 1-4 4M14 17v5M9 24h10" />
    </svg>
  );
}

function ChampionCard({ style, data, dim, onShowPath }: { style: CSSProperties; data: BracketData; dim: boolean; onShowPath?: (id: string) => void }) {
  const first = data.podium.first;
  const name = first ? data.nameOf(first) : null;
  const roster = first ? data.rosterOf(first) : [];
  const decisive = data.info.decisive;
  const body = (
    <>
      <span className="trn-champ-head">
        <Trophy />
        <span className="trn-champ-title">Переможець</span>
      </span>
      <span className="trn-champ-body">
        <span className="trn-champ-name">{name ?? 'Ще не визначено'}</span>
        {roster.length > 0 && (
          <span className="trn-champ-roster">
            {roster.map((r, i) => <span key={i}>{r.nickname}</span>)}
          </span>
        )}
        {!name && decisive && <span className="hint" style={{ margin: 0 }}>визначиться в матчі {matchRef(decisive, data.info.doubleElim)}</span>}
      </span>
    </>
  );
  const cls = 'trn-champ' + (name ? '' : ' empty') + (dim ? ' dim' : '');
  if (first && onShowPath) {
    return (
      <button type="button" className={cls} style={style} onClick={() => onShowPath(first)} aria-label={`Переможець: ${name}. Показати шлях у сітці`}>
        {body}
      </button>
    );
  }
  return <div className={cls} style={style}>{body}</div>;
}

// ── Полотно сітки ───────────────────────────────────────────────────────

function BracketCanvas({
  kind, ctx, cardW, colGap, pathEdges, champEdges, onShowPath,
}: {
  kind: LayoutKind;
  ctx: MatchCtx;
  cardW: number;
  colGap: number;
  pathEdges: ReadonlySet<string>;
  champEdges: ReadonlySet<string>;
  onShowPath?: (id: string) => void;
}) {
  const { data } = ctx;
  const canvasRef = useRef<HTMLDivElement>(null);
  // Висота картки й блоку переможця НЕ хардкодиться — вимірюється з DOM
  // (максимум по картках): на сенсорних екранах рядки вищі, у редакторі —
  // шапка з селектом.
  const [cardH, setCardH] = useState(ctx.showMembers ? 98 : 86);
  const [champH, setChampH] = useState(140);
  useLayoutEffect(() => {
    const root = canvasRef.current;
    if (!root) return;
    let h = 0;
    root.querySelectorAll<HTMLElement>('.trn-match').forEach((c) => { h = Math.max(h, c.offsetHeight); });
    if (h && Math.abs(h - cardH) > 1) setCardH(h);
    const ch = root.querySelector<HTMLElement>('.trn-champ')?.offsetHeight;
    if (ch && Math.abs(ch - champH) > 1) setChampH(ch);
  });

  const layout = useMemo(
    () => layoutBracket(kind, data.matches, data.info, { cardW, finalW: cardW + FINAL_EXTRA, cardH, colGap, rowGap: ROW_GAP, headH: HEAD_H, champH }),
    [kind, data.matches, data.info, cardW, colGap, cardH, champH],
  );
  // Картки в DOM — у порядку читання (верхня → нижня → гранд-фінал): ним іде Tab.
  const ordered = useMemo(() => [...data.matches].sort(byBracketOrder), [data.matches]);
  const edgeCls = (key: string) => (pathEdges.has(key) ? ' on' : champEdges.has(key) ? ' champ' : '');
  const rank = (key: string) => (pathEdges.has(key) ? 2 : champEdges.has(key) ? 1 : 0);
  // підсвічені лінії — поверх решти
  const edges = [...layout.edges].sort((a, b) => rank(a.key) - rank(b.key));
  const focusIsChampion = !!ctx.focusId && ctx.focusId === data.podium.first;
  // Пояснення нижньої сітки: коротко — видимим підзаголовком, повністю — у title і описі полотна.
  const descId = useId();
  const noted = layout.heads.find((h) => h.note && h.title);

  return (
    <div
      ref={canvasRef}
      className="trn-canvas"
      style={{ width: layout.width, height: layout.height }}
      role="group"
      aria-label="Турнірна сітка"
      aria-describedby={noted ? descId : undefined}
    >
      <svg className="trn-lines" width={layout.width} height={layout.height} aria-hidden="true">
        {edges.map((e) => <path key={e.key} className={'trn-edge' + edgeCls(e.key)} d={e.d} />)}
        {layout.champion && <path className={'trn-edge' + edgeCls(CHAMP_EDGE)} d={layout.champion.d} />}
      </svg>
      {layout.divider !== null && <div className="trn-divider" style={{ top: layout.divider, width: layout.width }} aria-hidden="true" />}
      {layout.heads.map((h) => (
        <div key={h.key} className="trn-head" style={{ left: h.x, top: h.y, width: h.w }} title={h.title}>
          <span className="trn-head-text">{h.text}</span>
          {h.sub && <span className="trn-head-sub">{h.sub}</span>}
        </div>
      ))}
      {noted && (
        <div className="trn-head-note" style={{ left: noted.x, top: noted.y + HEAD_H, width: noted.w }} title={noted.title}>
          <span aria-hidden="true">{noted.note}</span>
          <span id={descId} className="trn-sr">Нижня сітка. {noted.title}</span>
        </div>
      )}
      {ordered.map((m) => {
        const b = layout.boxes.get(m.id);
        if (!b) return null;
        return (
          <div key={m.id} className="trn-cell" style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
            <TrnMatch m={m} ctx={ctx} />
          </div>
        );
      })}
      {layout.champion && (
        <ChampionCard
          style={{ left: layout.champion.box.x, top: layout.champion.box.y, width: layout.champion.box.w }}
          data={data}
          dim={!!ctx.focusId && !focusIsChampion}
          onShowPath={onShowPath}
        />
      )}
    </div>
  );
}

// ── Заголовок секції списку («Верхня сітка · 4/7 зіграно») ─────────────

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

// ── Список по раундах (телефони) ────────────────────────────────────────

interface ListSection { title: string; matches: BracketMatch[]; label: (r: number) => string; hint?: string }

/** Чи розгорнуто раунд списку сам собою: ще грається або в ньому є матч закріпленого / знайденого
 * шляху (`openIds`). Наведення сюди не входить — інакше від руху миші розділи згортались би й
 * розгортались, а вміст під курсором стрибав. */
export function roundAutoOpen(list: BracketMatch[], openIds: ReadonlySet<string>): boolean {
  return list.some((m) => !m.winnerId || openIds.has(m.id));
}

function BracketList({ sections, ctx, openIds, pinKey }: { sections: ListSection[]; ctx: MatchCtx; openIds: ReadonlySet<string>; pinKey: string | null }) {
  // Раунди, які користувач сам розгорнув чи згорнув, — їх не перезаписує ні живе оновлення сітки, ні
  // наведення. Новий закріплений / знайдений шлях (pinKey) знову розгортає раунди саме цього шляху.
  const [manual, setManual] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [seenKey, setSeenKey] = useState(pinKey);
  const roundKey = (s: ListSection, r: number) => `${s.title}|${r}`;
  if (seenKey !== pinKey) {
    setSeenKey(pinKey);
    if (pinKey && manual.size > 0) {
      const next = new Map(manual);
      for (const s of sections) for (const m of s.matches) if (openIds.has(m.id)) next.delete(roundKey(s, m.round));
      if (next.size !== manual.size) setManual(next);
    }
  }
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
              // Розгорнуто те, що ще грається (і матчі закріпленого шляху); зіграні раунди — згорнуті.
              const key = roundKey(s, r);
              const auto = roundAutoOpen(list, openIds);
              const open = manual.get(key) ?? auto;
              // toggle приходить і від кліку користувача, і коли React сам міняє open — ручним
              // вважаємо лише стан, що розходиться з автоматичним.
              const onToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
                const now = e.currentTarget.open;
                setManual((prev) => {
                  if (now === auto ? !prev.has(key) : prev.get(key) === now) return prev;
                  const next = new Map(prev);
                  if (now === auto) next.delete(key);
                  else next.set(key, now);
                  return next;
                });
              };
              return (
                <details key={r} className="card trn-list-round" open={open} onToggle={onToggle}>
                  <summary>
                    <span className="trn-head-text">{rounds.length > 1 || s.matches.length > 1 ? s.label(r) : s.title}</span>
                    <span className="hint" style={{ margin: 0 }}>{played}/{list.length} зіграно</span>
                  </summary>
                  <div className="trn-list-matches">
                    {list.map((m) => <TrnMatch key={m.id} m={m} ctx={ctx} />)}
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

// ── Обгортка: пошук, шлях, вигляд, фулскрін, панель матчу ──────────────

type View = 'grid' | 'list';
const VIEW_KEY = 'pw-pvp:bracketView';

function initialView(): View {
  try {
    const stored = localStorage.getItem(VIEW_KEY);
    if (stored === 'grid' || stored === 'list') return stored;
  } catch { /* приватний режим тощо */ }
  return typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches ? 'list' : 'grid';
}

/** Лінії шляху: переходи перемогою (злам «матч → наступний») + до блоку переможця. */
function pathEdgeSet(steps: PathStep[], toChampion: boolean): Set<string> {
  const out = new Set<string>();
  for (const s of steps) if (s.via === 'win' && s.fromId) out.add(edgeKey(s.fromId, s.m.id));
  if (toChampion) out.add(CHAMP_EDGE);
  return out;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

export default function BracketView({ matches, registrations, editable, bracketNewLook = true, title, balanceTeams }: Props) {
  const [fullscreen, setFullscreen] = useState(false);
  const [view, setView] = useState<View>(initialView);
  const [query, setQuery] = useState('');
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ pid: string; matchId: string; anchor: DOMRect } | null>(null);
  const [panelId, setPanelId] = useState<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Шрифт складу довантажується — після цього «+N» перераховується точним виміром.
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) setFontsTick((t) => t + 1); }, () => { /* ok */ });
    return () => { alive = false; };
  }, []);

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

  // Лок скролу сторінки під час фулскріна — інакше видно ОДРАЗУ два скролбари.
  useEffect(() => {
    if (!fullscreen) return;
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, [fullscreen]);

  const info = useMemo(() => bracketInfo(matches), [matches]);
  const podium = useMemo(() => podiumIds(matches, info), [matches, info]);
  const rosterOf = useMemo(() => {
    const cache = new Map<string, RosterMember[]>();
    return (id: string | null): RosterMember[] => {
      if (!id) return [];
      let r = cache.get(id);
      if (!r) {
        r = rosterFor(id, registrations, balanceTeams);
        cache.set(id, r);
      }
      return r;
    };
  }, [registrations, balanceTeams]);
  const nameOf = useCallback((id: string | null) => nameFor(id, registrations), [registrations]);
  const data: BracketData = useMemo(() => ({ matches, registrations, info, podium, rosterOf, nameOf }), [matches, registrations, info, podium, rosterOf, nameOf]);

  const showMembers = registrations.some((r) => (r.memberNicknames?.length ?? 0) > 0);
  // Доступна ширина (ширина обгортки) — картки розтягуються, щоб сітка вміщалась без прокрутки.
  const [avail, setAvail] = useState(0);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const read = () => {
      const cs = getComputedStyle(el);
      setAvail(Math.floor(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fullscreen, matches.length === 0]);
  const kind: LayoutKind = info.doubleElim ? 'double' : bracketNewLook ? 'mirror' : 'columns';
  const { cardW, colGap } = fitColumns(avail, columnCount(kind, matches, info.wbMax, info.lbMax), showMembers ? CARD_W.team : CARD_W.solo);
  // fontsTick — перерахунок після завантаження шрифту.
  const fitsRoster = useMemo(() => (text: string) => textWidth(text) <= cardW - ROSTER_RESERVE, [cardW, fontsTick]);
  const popoverId = useId();

  // Пошук: збіг по назві учасника/команди або по ніку в складі. Одна команда —
  // одразу її шлях; кілька — підсвітка слотів і вибір у смужці «Шлях».
  const participantIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of matches) for (const p of [m.participant1Id, m.participant2Id]) if (p) ids.add(p);
    return Array.from(ids);
  }, [matches]);
  const hits = useMemo(() => searchParticipants(query, participantIds, registrations, rosterOf), [query, participantIds, registrations, rosterOf]);
  const searchFocus = hits.length === 1 ? hits[0].id : null;
  const hoverPid = !editable ? (hover?.pid ?? null) : null;
  const focusId = hoverPid ?? pinnedId ?? searchFocus;
  const fromHover = !!hoverPid;

  const path = useMemo(() => (focusId ? teamPath(focusId, matches) : []), [focusId, matches]);
  const champPath = useMemo(() => (podium.first ? teamPath(podium.first, matches) : []), [podium.first, matches]);
  const pathEdges = useMemo(() => pathEdgeSet(path, !!focusId && focusId === podium.first), [path, focusId, podium.first]);
  const champEdges = useMemo(() => pathEdgeSet(champPath, !!podium.first), [champPath, podium.first]);
  const pathIds = useMemo(() => new Set(path.map((s) => s.m.id)), [path]);
  const dropOut = useMemo(() => new Set(path.filter((s) => s.via === 'drop' && s.fromId).map((s) => s.fromId!)), [path]);
  const dropIn = useMemo(() => new Map(path.filter((s) => s.via === 'drop' && s.fromId).map((s) => [s.m.id, s.fromId!] as const)), [path]);
  const hitSet = useMemo(() => (hits.length > 1 ? new Set(hits.map((h) => h.id)) : EMPTY_SET), [hits]);
  const matchedNick = focusId ? hits.find((h) => h.id === focusId)?.nick : undefined;

  // Закріплений / знайдений шлях (без наведення) — від нього залежить, які раунди списку розгорнуто.
  const focusKey = pinnedId ?? searchFocus;
  const pinnedPathIds = useMemo(() => (focusKey ? new Set(teamPath(focusKey, matches).map((s) => s.m.id)) : EMPTY_SET), [focusKey, matches]);

  // Знайшли / закріпили — підкручуємо до матчу, що зараз важливий для команди
  // (live або очікує), інакше до її останнього матчу.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let target: string | undefined;
    if (focusKey) {
      const steps = teamPath(focusKey, matches);
      target = (steps.find((s) => s.outcome === 'live' || s.outcome === 'wait') ?? steps[steps.length - 1])?.m.id;
    } else if (hits.length > 1) {
      target = (root.querySelector<HTMLElement>('.trn-match.trn-hit.trn-live') ?? root.querySelector<HTMLElement>('.trn-match.trn-hit'))?.dataset.matchId;
    }
    if (!target) return;
    const el = Array.from(root.querySelectorAll<HTMLElement>('[data-match-id]')).find((x) => x.dataset.matchId === target);
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    // Лише при зміні вибору/вигляду, не при кожному живому оновленні сітки.
  }, [focusKey, hits.length > 1, view, fullscreen]);

  const onHover = useCallback((pid: string | null, matchId?: string, el?: HTMLElement) => {
    if (!pid || !matchId || !el) {
      setHover(null);
      return;
    }
    const card = el.closest<HTMLElement>('.trn-match') ?? el;
    setHover({ pid, matchId, anchor: card.getBoundingClientRect() });
  }, []);
  // Підказка прив'язана до місця на екрані — при прокрутці чи зміні розміру ховаємо.
  useEffect(() => {
    if (!hover) return;
    const hide = () => setHover(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [hover]);

  const openMatch = useCallback((matchId: string, opener?: HTMLElement) => {
    if (opener) openerRef.current = opener;
    setPanelId(matchId);
    setHover(null);
  }, []);
  const closePanel = useCallback(() => {
    setPanelId(null);
    const o = openerRef.current;
    openerRef.current = null;
    if (o && document.contains(o)) o.focus({ preventScroll: true });
  }, []);
  const pinPath = useCallback((id: string) => {
    setPinnedId(id);
    setHover(null);
  }, []);
  // Пʼєдестал, блок переможця, чипи пошуку: відкрита панель закривається, фокус лишається на
  // натиснутій кнопці (вона нікуди не зникає).
  const showPath = useCallback((id: string) => {
    openerRef.current = null;
    setPanelId(null);
    pinPath(id);
  }, [pinPath]);
  // «Шлях: …» у панелі: кнопка зникає разом із панеллю — закриваємо тим самим closePanel (фокус —
  // назад на відкривач), а вже потім закріплюємо шлях (так скидається й наведення, яке дав цей фокус).
  const showPathFromPanel = useCallback((id: string) => {
    closePanel();
    pinPath(id);
  }, [closePanel, pinPath]);
  const clearPath = () => {
    setPinnedId(null);
    setQuery('');
  };

  // Esc: спершу закриває панель матчу, потім — фулскрін.
  useEffect(() => {
    if (!panelId && !fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (panelId) closePanel();
      else setFullscreen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panelId, fullscreen, closePanel]);

  const panelMatch = panelId ? info.byId.get(panelId) : undefined;

  const ctx: MatchCtx = {
    data, editable, showMembers, fitsRoster, focusId, pathIds, dropOut, dropIn,
    hit: (pid) => !!pid && hitSet.has(pid),
    selectedId: panelMatch ? panelMatch.id : null,
    hoverPid,
    hoverMatchId: hoverPid ? (hover?.matchId ?? null) : null,
    popoverId: hoverPid && !panelMatch ? popoverId : undefined,
    onOpen: editable ? undefined : openMatch,
    onHover: editable ? undefined : onHover,
  };
  // У списку картка вдвічі ширша за картку сітки — склад не скорочуємо до «+N»: увесь рядком,
  // а що не влізе — обріже трикрапкою CSS (повний склад — у підписі рядка й панелі).
  const listCtx: MatchCtx = { ...ctx, fitsRoster: FITS_ALWAYS };

  if (matches.length === 0) return <p className="hint">Сітку ще не згенеровано.</p>;

  const winners = matches.filter((m) => m.bracketSide === 'winners');
  const losers = matches.filter((m) => m.bracketSide === 'losers');
  const final = matches.filter((m) => m.bracketSide === 'final');
  const thirdPlace = matches.find((m) => m.bracketSide === 'third_place') ?? null;
  const wbLabel = (r: number) => (r === info.wbMax ? 'Фінал верхньої' : `Раунд ${r}`);
  const lbLabel = (r: number) => (r === info.lbMax ? 'Фінал нижньої' : `Раунд ${r}`);
  const singleElimLabel = (r: number) => (r === info.wbMax ? 'Фінал' : r === info.wbMax - 1 && info.wbMax > 1 ? 'Півфінал' : `Раунд ${r}`);

  const listSections: ListSection[] = info.doubleElim
    ? [
        { title: 'Верхня сітка', matches: winners, label: wbLabel },
        { title: 'Нижня сітка', matches: losers, label: lbLabel, hint: LB_HINT },
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
  const onStep = (matchId: string, el: HTMLElement) => {
    if (!editable) {
      openMatch(matchId, el);
      return;
    }
    const card = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-match-id]') ?? []).find((x) => x.dataset.matchId === matchId);
    card?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  };

  const rootCls = [
    fullscreen && 'trn-fullscreen',
    !focusId && hitSet.size > 0 && 'trn-filtering',
    focusId && 'trn-path',
    focusId && (fromHover ? 'trn-path-hover' : 'trn-path-pin'),
  ].filter(Boolean).join(' ');

  return (
    <div ref={rootRef} className={rootCls}>
      <div className="trn-toolbar">
        {fullscreen && title && <span className="trn-fullscreen-title">{title}</span>}
        <span className={'trn-search' + (focusId && !fromHover ? ' found' : '')}>
          <input
            type="search"
            value={query}
            placeholder={showMembers ? 'Знайти нік або команду' : 'Знайти учасника'}
            aria-label="Пошук у сітці: нік гравця або назва команди"
            onChange={(e) => {
              setQuery(e.target.value);
              setPinnedId(null);
            }}
          />
          {query.trim() && <span className="hint" style={{ margin: 0, whiteSpace: 'nowrap' }}>{hits.length ? (hits.length === 1 ? 'знайдено' : `команд: ${hits.length}`) : 'не знайдено'}</span>}
        </span>
        {view === 'grid' && (
          <span className="trn-legend" aria-hidden="true">
            <span><span className="sw-win" />переможець</span>
            {/* золоті лінії — шлях вибраної команди; без неї — шлях чемпіона, якщо він уже є.
                Пункт завжди займає місце (обидва підписи в одній клітинці, видно один; без чемпіона
                й фокуса — прихований), щоб від наведення тулбар не переносився і сітка не стрибала. */}
            <span className={'trn-legend-path' + (focusId || podium.first ? '' : ' is-off')}>
              <span className="sw-path" />
              <span className="trn-legend-alt">
                <span className={focusId ? undefined : 'is-hidden'}>шлях команди</span>
                <span className={focusId ? 'is-hidden' : undefined}>шлях чемпіона</span>
              </span>
            </span>
            <span><span className="sw-wait" />чекає</span>
          </span>
        )}
        <span className="trn-tools">
          {viewBtn('grid', 'Сітка')}
          {viewBtn('list', 'Список')}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFullscreen((v) => !v)}>
            {fullscreen ? '✕ Згорнути' : '⛶ На весь екран'}
          </button>
        </span>
      </div>

      <PodiumStrip data={data} title={title} focusId={focusId} onShowPath={showPath} />
      <PathBar
        data={data}
        focusId={focusId}
        nick={matchedNick}
        query={query}
        hits={hits}
        canClear={!!pinnedId || !!query.trim()}
        interactive={!editable}
        onPick={showPath}
        onClear={clearPath}
        onStep={onStep}
      />

      {view === 'list' ? (
        <BracketList sections={listSections} ctx={listCtx} openIds={pinnedPathIds} pinKey={focusKey} />
      ) : (
        <div className="bracket-scroll trn-scroll">
          <div style={fullscreen ? { width: 'max-content', margin: '0 auto' } : undefined}>
            <BracketCanvas kind={kind} ctx={ctx} cardW={cardW} colGap={colGap} pathEdges={focusId ? pathEdges : EMPTY_SET} champEdges={champEdges} onShowPath={editable ? undefined : showPath} />
          </div>
        </div>
      )}

      {panelMatch && !editable && (
        <MatchPanel
          m={panelMatch}
          data={data}
          fullscreen={fullscreen}
          onClose={closePanel}
          onShowPath={showPathFromPanel}
          onOpenMatch={(id) => openMatch(id)}
        />
      )}
      {hover && !editable && !panelMatch && <TeamPopover id={popoverId} pid={hover.pid} anchor={hover.anchor} data={data} />}
    </div>
  );
}
