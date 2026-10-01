// =========================================================
// Підказка при наведенні (або фокусі з клавіатури) на команду в сітці:
// повний склад (нік, клас, ранг — що є в даних), місце / стан і всі матчі
// команди з результатом. Лише для читання (pointer-events: none) — закріпити
// шлях можна з панелі матчу (клік по картці), пошуком або з пʼєдесталу.
// Портал у body: картки лежать у прокрутці, яка обрізала б підказку.
// =========================================================

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { matchRef, soloClass, stepScore, teamPath, teamStanding, type BracketData, type PathStep } from './model';

export function stepText(step: PathStep, data: BracketData): string {
  const opp = data.nameOf(step.opponentId);
  if (step.outcome === 'win') return `перемога над ${opp}`;
  if (step.outcome === 'loss') return `поразка від ${opp}`;
  if (step.outcome === 'live') return `грає з ${opp}`;
  return 'чекає суперника';
}

export const stepMark = (step: PathStep): string => (step.outcome === 'win' ? '✓' : step.outcome === 'loss' ? '✕' : '');

export default function TeamPopover({ pid, anchor, data, id }: { pid: string; anchor: DOMRect; data: BracketData; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const path = useMemo(() => teamPath(pid, data.matches), [pid, data.matches]);
  const standing = teamStanding(pid, path, data.podium, data.info.doubleElim);
  const roster = data.rosterOf(pid);
  const solo = roster.length === 0 ? soloClass(pid, data.registrations) : undefined;

  // Праворуч від картки; не влазить — ліворуч; по вертикалі — в межах вікна.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 12;
    let left = anchor.right + gap;
    if (left + w > vw - 8) left = anchor.left - gap - w;
    if (left < 8) left = Math.max(8, Math.min(vw - w - 8, anchor.left));
    let top = anchor.top;
    if (top + h > vh - 8) top = vh - 8 - h;
    if (top < 8) top = 8;
    setPos({ left, top });
  }, [anchor, pid]);

  return createPortal(
    <div
      ref={ref}
      id={id}
      className="trn-pop"
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: 'hidden' }}
    >
      <div className="trn-pop-head">
        <b>{data.nameOf(pid)}</b>
        {standing.label && <span className={'trn-standing ' + standing.tone}>{standing.label}</span>}
      </div>
      {roster.length > 0 ? (
        <div className="trn-pop-members">
          {roster.map((m, i) => (
            <div key={i} className="trn-member">
              <span className="trn-member-nick">{m.nickname}</span>
              {m.cls && <span className="trn-cls">{m.cls}</span>}
              {m.tier && <span className={'badge trn-tier tier-' + m.tier} title="Ранг гравця на момент жеребки">{m.tier}</span>}
            </div>
          ))}
        </div>
      ) : solo ? (
        <div className="trn-pop-members">
          <div className="trn-member"><span className="trn-member-nick">Клас</span><span className="trn-cls">{solo}</span></div>
        </div>
      ) : null}
      {path.length > 0 && (
        <>
          <div className="trn-pop-sub">Матчі</div>
          <div className="trn-pop-games">
            {path.map((s) => (
              <div key={s.m.id} className="trn-game">
                <span className="trn-game-tag">{matchRef(s.m, data.info.doubleElim)}</span>
                <span className="trn-game-text">{stepText(s, data)}</span>
                <span className={'trn-game-res ' + s.outcome}>{[stepScore(s), stepMark(s)].filter(Boolean).join(' ')}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="trn-pop-foot">Клік — подробиці матчу; там же можна закріпити шлях.</div>
    </div>,
    document.body,
  );
}
