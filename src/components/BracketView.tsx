// =========================================================
// Рендер турнірної сітки: колонки по раундах (без SVG-конекторів —
// свідоме спрощення MVP). Той самий компонент для публічного read-only
// перегляду (TournamentPage) і адмінського редактора (AdminPage) —
// різниця лише в наявності `editable`. Для double_elim рендерить три
// секції: Верхня сітка (winners), Нижня сітка (losers), Гранд-фінал (final).
// =========================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BracketMatch, Registration } from '../data/types';

function nameFor(id: string | null, regs: Registration[]): string {
  if (!id) return '—';
  return regs.find((r) => r.id === id)?.nickname ?? '?';
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

/** Одна "сітка" (колонки по раундах) — winners АБО losers. Кожен матч
 * позиціонується абсолютно по центру між двома матчами, що в нього ведуть;
 * висота картки НЕ хардкодиться, а вимірюється з реального DOM (перша
 * картка раунду 1) — інакше при відхиленні реального контенту від
 * припущеної константи картки в різних раундах накладаються одна на одну. */
function BracketColumns({
  sideMatches,
  roundLabel,
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
            {roundLabel(r)}
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
  const isDoubleElim = losers.length > 0 || final.length > 0;

  const wbMaxRound = Math.max(...winners.map((m) => m.round));
  const wbLabel = (r: number) =>
    isDoubleElim
      ? `Верхня · Раунд ${r}`
      : r === wbMaxRound
        ? 'Фінал'
        : r === wbMaxRound - 1 && wbMaxRound > 1
          ? 'Півфінал'
          : `Раунд ${r}`;
  const lbLabel = (r: number) => `Нижня · Раунд ${r}`;

  return (
    <div
      className={fullscreen ? 'bracket-scroll' : undefined}
      style={fullscreen ? { position: 'fixed', inset: 0, zIndex: 2000, background: 'var(--bg-0)', padding: 24, overflow: 'auto' } : undefined}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFullscreen((v) => !v)}>
          {fullscreen ? '✕ Згорнути' : '⛶ На весь екран'}
        </button>
      </div>

      {isDoubleElim && <h3 style={{ margin: '0 0 8px' }}>Верхня сітка</h3>}
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
    </div>
  );
}
