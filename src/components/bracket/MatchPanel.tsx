// =========================================================
// Панель матчу (клік по картці в публічній сітці): етап, формат серії,
// стан, обидві сторони з рахунком і повним складом (нік, клас, ранг), звідки
// прийшли учасники й куди підуть переможець і програвший, кнопки «Шлях: …».
// Закривається лише хрестиком або Esc (Esc ловить BracketView — там же
// фулскрін); клік по іншій картці перемикає панель на неї. Фокус — на
// хрестик при відкритті, Tab ходить по колу всередині панелі.
// Портал у body — над сіткою й над фулскріном.
// =========================================================

import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { BracketMatch } from '../../data/types';
import {
  formatLabel, isBo1, matchRef, parseScore, requiredWins, soloClass, stageName, type BracketData,
} from './model';

interface Props {
  m: BracketMatch;
  data: BracketData;
  fullscreen: boolean;
  onClose: () => void;
  onShowPath: (id: string) => void;
  onOpenMatch: (matchId: string) => void;
}

export default function MatchPanel({ m, data, fullscreen, onClose, onShowPath, onOpenMatch }: Props) {
  const { info, matches } = data;
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, [m.id]);

  // Tab по колу всередині панелі (модалка для клавіатури).
  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const de = info.doubleElim;
  const ref = (x: BracketMatch) => matchRef(x, de);
  const refBtn = (x: BracketMatch) => (
    <button type="button" className="trn-ref" onClick={() => onOpenMatch(x.id)} title={`Відкрити матч ${ref(x)}`}>{ref(x)}</button>
  );
  const score = parseScore(m.score);
  const bo1 = isBo1(m);
  const both = !!m.participant1Id && !!m.participant2Id;
  const status = m.winnerId
    ? 'зіграно'
    : both
      ? score && score[0] + score[1] > 0 ? `триває · ${score[0]}:${score[1]}` : 'можна грати'
      : 'чекає учасників';
  const series = bo1 ? formatLabel(m.format) : `${formatLabel(m.format)} · до ${requiredWins(m.format)} перемог`;
  const pids = [m.participant1Id, m.participant2Id];

  // Хто веде в кожен слот: переможець або програвший попереднього матчу.
  const feeders = pids.map((_, i) => {
    for (const f of matches) {
      if (f.nextMatchId === m.id && f.nextMatchSlot === i + 1) return { f, kind: 'переможець' };
      if (f.loserNextMatchId === m.id && f.loserNextMatchSlot === i + 1) return { f, kind: 'програвший' };
    }
    return null;
  });

  const loserId = m.winnerId ? (pids.find((p) => p && p !== m.winnerId) ?? null) : null;
  const next = m.nextMatchId ? info.byId.get(m.nextMatchId) : undefined;
  const drop = m.loserNextMatchId ? info.byId.get(m.loserNextMatchId) : undefined;
  const decisive = info.decisive?.id === m.id;
  const finalPlace = (id: string | null, win: boolean): string => {
    if (decisive) return win ? 'чемпіон турніру' : '2 місце';
    if (id && data.podium.third === id) return '3 місце';
    if (m.bracketSide === 'third_place') return win ? '3 місце' : '4 місце';
    return win ? 'далі' : 'вибуває';
  };
  const whoWin = m.winnerId ? data.nameOf(m.winnerId) : 'Переможець';
  const whoLose = loserId ? data.nameOf(loserId) : 'Програвший';

  return createPortal(
    <div
      ref={panelRef}
      className={'trn-panel' + (fullscreen ? ' in-fullscreen' : '')}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={trapTab}
    >
      <div className="trn-panel-head">
        <span id={titleId} className="trn-panel-title">Матч {ref(m)}</span>
        <button ref={closeRef} type="button" className="trn-panel-close" aria-label="Закрити" title="Закрити (Esc)" onClick={onClose}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M2 2l8 8M10 2L2 10" /></svg>
        </button>
      </div>
      <div className="trn-panel-body">
        <div className="trn-panel-sub">{stageName(m, info)} · {series} · {status}</div>

        {pids.map((pid, i) => {
          const win = !!pid && pid === m.winnerId;
          const roster = data.rosterOf(pid);
          const solo = pid && roster.length === 0 ? soloClass(pid, data.registrations) : undefined;
          const scoreText = !bo1 && score ? String(score[i]) : '';
          return (
            <div key={i} className={'trn-side' + (win ? ' win' : '')}>
              {pid ? (
                <>
                  <div className="trn-side-head">
                    <span className="trn-side-name">{data.nameOf(pid)}</span>
                    <span className="trn-side-score">{[scoreText, win ? '✓' : ''].filter(Boolean).join(' ')}</span>
                  </div>
                  {roster.map((r, j) => (
                    <div key={j} className="trn-member">
                      <span className="trn-member-nick">{r.nickname}</span>
                      {r.cls && <span className="trn-cls">{r.cls}</span>}
                      {r.tier && <span className={'badge trn-tier tier-' + r.tier} title="Ранг гравця на момент жеребки">{r.tier}</span>}
                    </div>
                  ))}
                  {solo && <div className="trn-member"><span className="trn-member-nick">Клас</span><span className="trn-cls">{solo}</span></div>}
                </>
              ) : (
                <span className="trn-side-empty">
                  {feeders[i] ? <>очікується: {feeders[i]!.kind} {refBtn(feeders[i]!.f)}</> : 'учасник ще невідомий'}
                </span>
              )}
            </div>
          );
        })}

        {pids.some(Boolean) && (
          <div className="trn-panel-sec">
            <h4>Звідки прийшли</h4>
            {pids.map((pid, i) => pid && (
              <div key={i} className="trn-panel-line">
                {data.nameOf(pid)} — {feeders[i] ? <>{feeders[i]!.kind} {refBtn(feeders[i]!.f)}</> : 'перший раунд'}
              </div>
            ))}
          </div>
        )}

        <div className="trn-panel-sec">
          <h4>Куди далі</h4>
          <div className="trn-panel-line">
            {whoWin} — {next ? <>у {refBtn(next)} · {stageName(next, info)}</> : finalPlace(m.winnerId, true)}
          </div>
          <div className="trn-panel-line">
            {whoLose} — {drop ? <>у {refBtn(drop)} · {stageName(drop, info)}</> : finalPlace(loserId, false)}
          </div>
        </div>

        {pids.some(Boolean) && (
          <div className="trn-panel-actions">
            {pids.map((pid, i) => pid && (
              <button key={i} type="button" className="btn btn-ghost btn-sm" onClick={() => onShowPath(pid)}>
                Шлях: {data.nameOf(pid)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
