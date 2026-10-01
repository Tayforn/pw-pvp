// =========================================================
// Смужки над сіткою:
//  · PodiumStrip — «Підсумок турніру»: 1–3 місця з медалями й повними
//    складами, «зіграно X з Y», копіювання підсумку; клік по місцю — шлях.
//  · PathBar — «Шлях»: етапи команди (пошук / наведення / закріплення)
//    пігулками «В1.2 ✓ 2:0 → В2.1 ✕ 1:2 ↓ Н2.1 …» і підсумок («Чемпіон»,
//    «вибув у Н3.1»); кілька збігів пошуку — вибір команди; інакше — підказка.
//    Один рядок: висота не змінюється від наведення, тож сітка під курсором
//    не «стрибає». Прокручуються лише пігулки етапів (чипи збігів) — мітка,
//    назва команди, підсумок і «✕ Скинути» видно завжди.
// =========================================================

import { useState, type MouseEvent } from 'react';
import { matchRef, stepScore, teamPath, teamStanding, type BracketData, type PathStep, type SearchHit } from './model';
import { stepMark, stepText } from './TeamPopover';

const PLACES = [
  { key: 'first' as const, n: 1, medal: '🥇' },
  { key: 'second' as const, n: 2, medal: '🥈' },
  { key: 'third' as const, n: 3, medal: '🥉' },
];

export function PodiumStrip({ data, title, focusId, onShowPath }: { data: BracketData; title?: string; focusId: string | null; onShowPath: (id: string) => void }) {
  const [copied, setCopied] = useState(false);
  const played = data.matches.filter((m) => m.winnerId).length;
  const places = PLACES.map((p) => ({ ...p, id: data.podium[p.key] })).filter((p): p is typeof p & { id: string } => !!p.id);
  if (places.length === 0) return null;

  const copy = () => {
    const lines = places.map((p) => {
      const roster = data.rosterOf(p.id).map((r) => r.nickname);
      return `${p.medal} ${data.nameOf(p.id)}${roster.length ? ` — ${roster.join(', ')}` : ''}`;
    });
    const text = [title ? `${title} — підсумок` : 'Підсумок турніру', ...lines].join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => { /* без доступу до буфера — нічого */ });
  };

  return (
    <section className="trn-podium" aria-label="Підсумок турніру">
      <div className="trn-podium-head">
        <span className="trn-podium-title">Підсумок турніру</span>
        <span className="hint" style={{ margin: 0 }}>зіграно {played} з {data.matches.length}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>{copied ? 'Скопійовано!' : 'Скопіювати підсумок'}</button>
      </div>
      <div className="trn-podium-grid">
        {places.map((p) => {
          const roster = data.rosterOf(p.id).map((r) => r.nickname);
          const name = data.nameOf(p.id);
          return (
            <button
              key={p.key}
              type="button"
              className={`trn-podium-cell p${p.n}` + (focusId === p.id ? ' on' : '')}
              onClick={() => onShowPath(p.id)}
              aria-label={`${p.n} місце: ${name}${roster.length ? ` (${roster.join(', ')})` : ''}. Показати шлях у сітці`}
              title="Показати шлях у сітці"
            >
              <span className={`trn-medal m${p.n}`} aria-hidden="true">{p.n}</span>
              <span className="trn-podium-text">
                <span className="trn-podium-name">{name}</span>
                {roster.length > 0 && <span className="trn-podium-roster">{roster.join(', ')}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

interface PathBarProps {
  data: BracketData;
  focusId: string | null;
  /** нік зі складу, за яким знайшли команду */
  nick?: string;
  query: string;
  hits: SearchHit[];
  /** чи можна скинути (шлях закріплено або є пошук) */
  canClear: boolean;
  /** публічна сітка — показувати підказку про наведення */
  interactive: boolean;
  onPick: (id: string) => void;
  onClear: () => void;
  onStep: (matchId: string, el: HTMLElement) => void;
}

export function PathBar({ data, focusId, nick, query, hits, canClear, interactive, onPick, onClear, onStep }: PathBarProps) {
  const de = data.info.doubleElim;
  const clear = canClear && (
    <button type="button" className="btn btn-ghost btn-sm trn-pathbar-clear" onClick={onClear} title="Скинути пошук і закріплений шлях">✕ Скинути</button>
  );

  if (focusId) {
    const steps = teamPath(focusId, data.matches);
    const standing = teamStanding(focusId, steps, data.podium, de);
    const stepLabel = (s: PathStep) => [matchRef(s.m, de), stepMark(s), stepScore(s)].filter(Boolean).join(' ');
    return (
      <div className="trn-pathbar" role="region" aria-label={`Шлях: ${data.nameOf(focusId)}`}>
        <span className="trn-pathbar-label">Шлях</span>
        <span className="trn-pathbar-team">{data.nameOf(focusId)}</span>
        {nick && <span className="trn-pathbar-nick">· {nick}</span>}
        <span className="trn-pathbar-gap" />
        <span className="trn-pathbar-steps">
          {steps.map((s, i) => (
            <span key={s.m.id} style={{ display: 'contents' }}>
              {i > 0 && (
                <span className={'trn-step-arrow' + (s.via === 'drop' ? ' drop' : '')} aria-hidden="true" title={s.via === 'drop' ? 'поразка — у нижню сітку' : undefined}>
                  {s.via === 'drop' ? '↓' : '→'}
                </span>
              )}
              <button
                type="button"
                className={'trn-step ' + s.outcome}
                onClick={(e: MouseEvent<HTMLButtonElement>) => onStep(s.m.id, e.currentTarget)}
                aria-label={`${matchRef(s.m, de)}: ${stepText(s, data)}${stepScore(s) ? `, ${stepScore(s)}` : ''}. Відкрити матч`}
              >
                {stepLabel(s)}
              </button>
            </span>
          ))}
        </span>
        {standing.label && <span className={'trn-standing ' + standing.tone}>{standing.label}</span>}
        {clear}
      </div>
    );
  }

  if (hits.length > 1) {
    return (
      <div className="trn-pathbar" role="region" aria-label="Знайдені команди">
        <span className="trn-pathbar-label">Знайдено {hits.length}</span>
        <span className="trn-pathbar-hint">обери, чий шлях показати:</span>
        <span className="trn-pathbar-steps">
          {hits.map((h) => (
            <button key={h.id} type="button" className="trn-chip" onClick={() => onPick(h.id)}>
              {data.nameOf(h.id)}{h.nick && <span className="nick"> · {h.nick}</span>}
            </button>
          ))}
        </span>
        {clear}
      </div>
    );
  }

  if (query.trim()) {
    return (
      <div className="trn-pathbar" role="status">
        <span className="trn-pathbar-label">Шлях</span>
        <span className="trn-pathbar-hint">За запитом «{query.trim()}» у сітці нікого немає.</span>
        {clear}
      </div>
    );
  }

  if (!interactive) return null;
  return (
    <div className="trn-pathbar">
      <span className="trn-pathbar-label">Шлях</span>
      <span className="trn-pathbar-hint when-hover">Наведи на команду — її шлях і склад. Клік по матчу — подробиці.</span>
      <span className="trn-pathbar-hint when-touch">Торкнись матчу — подробиці й шлях команди. Пошук — шлях гравця.</span>
      {clear}
    </div>
  );
}
