// =========================================================
// Рендер турнірної сітки. Той самий компонент для публічного read-only
// перегляду (TournamentPage) і адмінського редактора (AdminPage) —
// різниця лише в наявності `editable`.
//
// single_elim: дзеркальна сітка (обидві половини сходяться до фіналу
// в центрі, з конекторами й короною чемпіона) — тестовий вигляд за
// референсом турнірної сітки Perfect World.
// double_elim: колонки по раундах без конекторів (як було) — три секції:
// Верхня сітка (winners), Нижня сітка (losers), Гранд-фінал (final).
// =========================================================

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BracketMatch, Registration } from '../data/types';

function nameFor(id: string | null, regs: Registration[]): string {
  if (!id) return '—';
  return regs.find((r) => r.id === id)?.nickname ?? '?';
}

function roundLabel(depthFromFinal: number): string {
  if (depthFromFinal === 0) return 'Фінал';
  if (depthFromFinal === 1) return 'Півфінал';
  if (depthFromFinal === 2) return 'Чвертьфінал';
  return `1/${2 ** depthFromFinal} фіналу`;
}

const FORMAT_LABELS: Record<string, string> = { bo1: 'BO1', bo3: 'BO3', bo5: 'BO5' };
const KNOWN_FORMATS = ['bo1', 'bo3', 'bo5'];

function FormatEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [custom, setCustom] = useState(!KNOWN_FORMATS.includes(value));
  const smallInputStyle = { fontSize: 12, padding: '3px 6px', borderRadius: 6, background: 'var(--bg-3)', color: 'var(--text)', border: '1px solid var(--line-2)', textTransform: 'uppercase' } as const;

  if (custom) {
    return (
      <span style={{ display: 'inline-flex', gap: 4 }}>
        <input
          type="text"
          defaultValue={KNOWN_FORMATS.includes(value) ? '' : value}
          placeholder="напр. bo7"
          style={{ ...smallInputStyle, width: 72 }}
          onBlur={(e) => onChange(e.target.value.trim() || 'bo1')}
        />
        <button
          type="button"
          title="Повернутись до BO1/BO3/BO5"
          onClick={() => {
            setCustom(false);
            onChange('bo1');
          }}
          style={{ ...smallInputStyle, cursor: 'pointer' }}
        >
          ↺
        </button>
      </span>
    );
  }
  return (
    <select
      value={KNOWN_FORMATS.includes(value) ? value : 'bo1'}
      style={smallInputStyle}
      onChange={(e) => {
        if (e.target.value === 'custom') setCustom(true);
        else onChange(e.target.value);
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
  onSetWinner: (matchId: string, winnerId: string, score?: string) => void;
  onSetFormat: (matchId: string, format: string) => void;
}

interface Props {
  matches: BracketMatch[];
  registrations: Registration[];
  editable?: BracketEditable;
}

/** bo1 — переможець сам собою й визначає рахунок (1-0/0-1), питати нема сенсу.
 * Будь-який інший формат (bo3/bo5/кастом) вимагає рахунок серії від адміна.
 * Це СПРАВЖНЯ модалка (position: fixed, поза потоком картки) — не inline-
 * розширення картки: якщо додати поле прямо всередині картки, воно тимчасово
 * збільшує її висоту, а решта сітки позиціонується абсолютно за заздалегідь
 * виміряною (меншою) висотою — картка "наїжджає" на сусідню знизу. */
function ScorePrompt({ onConfirm, onCancel, initial }: { onConfirm: (score: string) => void; onCancel: () => void; initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ width: 'min(320px, 100%)' }}>
        <div className="modal-head">
          <h3>Рахунок серії</h3>
          <button type="button" className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">
          <input
            type="text"
            autoFocus
            value={value}
            placeholder="напр. 2-1"
            maxLength={9}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && value.trim() && onConfirm(value.trim())}
            style={{ width: '100%', fontSize: 15, padding: '10px 12px', borderRadius: 9, background: 'var(--bg-3)', color: 'var(--text)', border: '1px solid var(--accent)' }}
          />
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Скасувати</button>
          <button type="button" className="btn btn-primary" disabled={!value.trim()} onClick={() => onConfirm(value.trim())}>OK</button>
        </div>
      </div>
    </div>
  );
}

function MatchCard({ m, registrations, editable }: { m: BracketMatch; registrations: Registration[]; editable?: BracketEditable }) {
  const [pendingWinner, setPendingWinner] = useState<string | null>(null);
  const isBo1 = m.format.toLowerCase() === 'bo1';

  const pick = (pid: string | null) => {
    if (!editable || !pid || !m.participant1Id || !m.participant2Id) return;
    if (isBo1) {
      editable.onSetWinner(m.id, pid, pid === m.participant1Id ? '1-0' : '0-1');
    } else {
      setPendingWinner(pid);
    }
  };

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span className="badge mute" style={{ textTransform: 'uppercase' }}>
          {FORMAT_LABELS[m.format] ?? m.format}
          {m.score ? ` · ${m.score}` : ''}
        </span>
        {editable && <FormatEditor value={m.format} onChange={(fmt) => editable.onSetFormat(m.id, fmt)} />}
      </div>
      {[m.participant1Id, m.participant2Id].map((pid, i) => {
        const isWinner = !!m.winnerId && pid === m.winnerId;
        const clickable = !!editable && !!pid && !!m.participant1Id && !!m.participant2Id;
        return (
          <button
            key={i}
            type="button"
            disabled={!clickable}
            onClick={() => pick(pid)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '7px 9px',
              marginBottom: 4,
              borderRadius: 8,
              border: '1px solid var(--line-2)',
              background: isWinner ? 'rgba(53,224,161,0.14)' : 'transparent',
              color: isWinner ? 'var(--good)' : pid ? 'var(--text)' : 'var(--text-mute)',
              fontWeight: isWinner ? 700 : 500,
              cursor: clickable ? 'pointer' : 'default',
              fontFamily: 'inherit',
              fontSize: 14,
            }}
          >
            {isWinner ? '🏆 ' : ''}
            {nameFor(pid, registrations)}
          </button>
        );
      })}
      {pendingWinner && (
        <ScorePrompt
          initial={m.score ?? ''}
          onCancel={() => setPendingWinner(null)}
          onConfirm={(score) => {
            editable?.onSetWinner(m.id, pendingWinner, score);
            setPendingWinner(null);
          }}
        />
      )}
    </div>
  );
}

const DEFAULT_MATCH_H = 84;
const GAP = 16;

/** Одна "сітка" (колонки по раундах) — winners АБО losers, для double_elim.
 * Кожен матч позиціонується абсолютно по центру між двома матчами, що в нього
 * ведуть; висота картки НЕ хардкодиться, а вимірюється з реального DOM (перша
 * картка раунду 1) — інакше при відхиленні реального контенту від
 * припущеної константи картки в різних раундах накладаються одна на одну. */
function BracketColumns({
  sideMatches,
  roundLabel: label,
  registrations,
  editable,
}: {
  sideMatches: BracketMatch[];
  roundLabel: (r: number) => string;
  registrations: Registration[];
  editable?: BracketEditable;
}) {
  const [matchH, setMatchH] = useState(DEFAULT_MATCH_H);
  const firstCardRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const h = firstCardRef.current?.getBoundingClientRect().height;
    if (h && Math.abs(h - matchH) > 1) setMatchH(h);
  });

  if (sideMatches.length === 0) return null;

  const rounds = Array.from(new Set(sideMatches.map((m) => m.round))).sort((a, b) => a - b);
  const byRound = new Map<number, BracketMatch[]>(rounds.map((r) => [r, sideMatches.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot)]));
  const pitch = matchH + GAP;

  const centers = new Map<number, number[]>();
  centers.set(rounds[0], byRound.get(rounds[0])!.map((_, s) => s * pitch + matchH / 2));
  for (let i = 1; i < rounds.length; i++) {
    const r = rounds[i];
    const prevCenters = centers.get(rounds[i - 1])!;
    centers.set(
      r,
      byRound.get(r)!.map((_, s) => (prevCenters[2 * s] + prevCenters[2 * s + 1]) / 2),
    );
  }
  const columnHeight = byRound.get(rounds[0])!.length * pitch;

  return (
    <div className="bracket-scroll" style={{ display: 'flex', gap: 18, overflowX: 'auto', paddingBottom: 8 }}>
      {rounds.map((r, ri) => (
        <div key={r} style={{ flex: '0 0 220px' }}>
          <h4 style={{ margin: '0 0 4px', color: 'var(--text-dim)', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {label(r)}
          </h4>
          <div style={{ position: 'relative', height: columnHeight }}>
            {byRound.get(r)!.map((m, s) => (
              <div
                key={m.id}
                ref={ri === 0 && s === 0 ? firstCardRef : undefined}
                style={{ position: 'absolute', left: 0, right: 0, top: centers.get(r)![s] - matchH / 2 }}
              >
                <MatchCard m={m} registrations={registrations} editable={editable} />
              </div>
            ))}
          </div>
        </div>
      ))}
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

/** Компактна картка матчу для дзеркальної сітки: та сама логіка вибору
 * переможця/формату, що й MatchCard, лише інша розмітка (два рядки-слоти
 * в одній рамці замість двох кнопок у картці). */
function TrnMatch({ m, registrations, editable }: { m: BracketMatch; registrations: Registration[]; editable?: BracketEditable }) {
  const [pendingWinner, setPendingWinner] = useState<string | null>(null);
  const isBo1 = m.format.toLowerCase() === 'bo1';

  const pick = (pid: string | null) => {
    if (!editable || !pid || !m.participant1Id || !m.participant2Id) return;
    if (isBo1) {
      editable.onSetWinner(m.id, pid, pid === m.participant1Id ? '1-0' : '0-1');
    } else {
      setPendingWinner(pid);
    }
  };

  return (
    <div className="trn-match-outer">
      <div className={'trn-match' + (m.winnerId ? ' trn-decided' : '')}>
        <div className="trn-match-meta">
          <span>
            {FORMAT_LABELS[m.format] ?? m.format.toUpperCase()}
            {m.score ? ` · ${m.score}` : ''}
          </span>
          {editable && <FormatEditor value={m.format} onChange={(fmt) => editable.onSetFormat(m.id, fmt)} />}
        </div>
        {[m.participant1Id, m.participant2Id].map((pid, i) => {
          const isWin = !!m.winnerId && pid === m.winnerId;
          const isLose = !!m.winnerId && !!pid && pid !== m.winnerId;
          const clickable = !!editable && !!pid && !!m.participant1Id && !!m.participant2Id;
          return (
            <div
              key={i}
              className={'trn-slot' + (isWin ? ' win' : '') + (isLose ? ' lose' : '') + (clickable ? ' pickable' : '')}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={() => pick(pid)}
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
              <span className="trn-slot-name">{nameFor(pid, registrations)}</span>
              {isWin && <span className="trn-win-mark" aria-hidden="true">✓</span>}
            </div>
          );
        })}
      </div>
      {pendingWinner && (
        <ScorePrompt
          initial={m.score ?? ''}
          onCancel={() => setPendingWinner(null)}
          onConfirm={(score) => {
            editable?.onSetWinner(m.id, pendingWinner, score);
            setPendingWinner(null);
          }}
        />
      )}
    </div>
  );
}

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
  // дітей). Для in'єднання в фінал дитина лише одна (свій бік половини),
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

function SingleElimBracket({
  matches,
  registrations,
  editable,
  thirdPlace,
}: {
  matches: BracketMatch[];
  registrations: Registration[];
  editable?: BracketEditable;
  thirdPlace: BracketMatch | null;
}) {
  const round1Count = matches.filter((m) => m.round === 1).length;
  const bracketSize = round1Count * 2;
  const layout = useMemo(() => (bracketSize >= 2 ? buildMirrorLayout(bracketSize) : null), [bracketSize]);

  // Висота рядка НЕ хардкодиться (як і в BracketColumns) — вимірюється з
  // реального DOM першої картки раунду 1. Інакше фактична висота картки
  // (залежить від шрифтів/редактора формату/масштабу браузера) розходиться
  // з припущеною константою, і сусідні картки в сітці накладаються одна на
  // одну. TRN_ROW_GAP — гарантований проміжок між сусідніми картками.
  const [rowH, setRowH] = useState(editable ? TRN_ROW_H_EDIT : TRN_ROW_H);
  const [cardH, setCardH] = useState(rowH * 2 - TRN_ROW_GAP);
  const firstMatchRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const h = firstMatchRef.current?.getBoundingClientRect().height;
    if (h) {
      if (Math.abs(h - cardH) > 1) setCardH(h);
      const next = Math.ceil((h - TRN_ROW_GAP) / 2);
      if (Math.abs(next - rowH) > 1) setRowH(next);
    }
  });

  if (!layout) return null;
  const findMatch = (round: number, slot: number) => matches.find((m) => m.round === round && m.slot === slot);
  const finalMatch = findMatch(layout.finalRound, 0);
  const championName = finalMatch?.winnerId ? nameFor(finalMatch.winnerId, registrations) : null;

  return (
    <div>
      <div className="bracket-scroll" style={{ overflowX: 'auto', paddingBottom: 10 }}>
        <div
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
            const isFirst = c.round === 1 && c.slot === 0;
            return (
              <div
                key={i}
                ref={isFirst ? firstMatchRef : undefined}
                style={{ gridColumn: c.gridColumn, gridRow: c.gridRow, display: 'flex', alignItems: 'center' }}
              >
                <TrnMatch m={m} registrations={registrations} editable={editable} />
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
                <TrnMatch m={finalMatch} registrations={registrations} editable={editable} />
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
        <div style={{ marginTop: 24, maxWidth: 240 }}>
          <h3 style={{ margin: '0 0 8px' }}>Матч за 3-тє місце</h3>
          <TrnMatch m={thirdPlace} registrations={registrations} editable={editable} />
        </div>
      )}
    </div>
  );
}

export default function BracketView({ matches, registrations, editable }: Props) {
  const [fullscreen, setFullscreen] = useState(false);

  // Лок скролу сторінки під час фулскріна — інакше видно ОДРАЗУ два скролбари:
  // власний (тематизований, .bracket-scroll) і фоновий скролбар <body>.
  useEffect(() => {
    if (!fullscreen) return;
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, [fullscreen]);

  if (matches.length === 0) return <p className="hint">Сітку ще не згенеровано.</p>;

  const winners = matches.filter((m) => m.bracketSide === 'winners');
  const losers = matches.filter((m) => m.bracketSide === 'losers');
  const final = matches.filter((m) => m.bracketSide === 'final');
  const thirdPlace = matches.find((m) => m.bracketSide === 'third_place') ?? null;
  const isDoubleElim = losers.length > 0 || final.length > 0;

  const wbLabel = (r: number) => `Верхня · Раунд ${r}`;
  const lbLabel = (r: number) => `Нижня · Раунд ${r}`;

  return (
    <div
      className={fullscreen ? 'bracket-scroll' : undefined}
      style={fullscreen ? { position: 'fixed', inset: 0, zIndex: 2000, background: 'var(--bg-0)', padding: 24, overflow: 'auto', display: 'flex', flexDirection: 'column' } : undefined}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFullscreen((v) => !v)}>
          {fullscreen ? '✕ Згорнути' : '⛶ На весь екран'}
        </button>
      </div>

      {/* margin: auto у flex-контейнері центрує сітку по обох осях, коли вона
          менша за екран, і чесно деградує до звичайного скролу (margin 0),
          коли більша — на відміну від align/justify-center, які в скрол-
          контейнері обрізали б початок контенту. */}
      <div style={fullscreen ? { margin: 'auto' } : undefined}>
        {isDoubleElim ? (
          <>
            <h3 style={{ margin: '0 0 8px' }}>Верхня сітка</h3>
            <BracketColumns sideMatches={winners} roundLabel={wbLabel} registrations={registrations} editable={editable} />

            {losers.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h3 style={{ margin: '0 0 8px' }}>Нижня сітка</h3>
                <BracketColumns sideMatches={losers} roundLabel={lbLabel} registrations={registrations} editable={editable} />
              </div>
            )}

            {final.length > 0 && (
              <div style={{ marginTop: 24, maxWidth: 220 }}>
                <h3 style={{ margin: '0 0 8px' }}>Гранд-фінал</h3>
                <MatchCard m={final[0]} registrations={registrations} editable={editable} />
              </div>
            )}

            {thirdPlace && (
              <div style={{ marginTop: 24, maxWidth: 220 }}>
                <h3 style={{ margin: '0 0 8px' }}>Матч за 3-тє місце</h3>
                <MatchCard m={thirdPlace} registrations={registrations} editable={editable} />
              </div>
            )}
          </>
        ) : (
          <SingleElimBracket matches={winners} registrations={registrations} editable={editable} thirdPlace={thirdPlace} />
        )}
      </div>
    </div>
  );
}
