// =========================================================
// Бейдж рангу (S/A/B/C/D) з попапом «картка персонажа»: нік, клас, ранг і
// анкета спорядження рядками; в адмінці — ще скор зі складовими, Ело, ПА/ПЗ
// і корекція. Публічно передається лише те, що й так видно на сторінці
// турніру (анкета) + ранг; числа скору — тільки адміну (рішення §5.18).
//
// Відкривається з наведення (закривається, коли курсор пішов) і з кліку
// (закріплюється — закривається Esc, кліком поза або повторним кліком).
// Рендериться порталом у body: усередині модалок/кнопок position:fixed
// інакше ріжеться overflow-ом.
// =========================================================

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { PlayerGear, Tier } from '../data/types';
import {
  ARMOR_REFINE_LABELS, ARMOR_SET_LABELS, BUILD_LABELS, CHAR_LEVEL_LABELS, CLASS_LABELS, GEMS_LABELS, GENIE_LABELS, SPECIAL_SET_LABELS, SPECIAL_SET_ORDER,
  TRACT_LABELS, WEAPON_GRADE_LABELS, WEAPON_REFINE_LABELS, ringsLabel, rulesFor, shgVoznesLabel,
} from '../data/gearRules';

export interface PlayerCardInfo {
  nickname: string;
  gear: PlayerGear;
  tier: Tier;
  /** Склад каменів з ляльки (заявка персонажем) — показується замість рядка таблиці. */
  gemsMix?: string;
  /** Абілка основної зброї з ляльки (назва). */
  weaponAbility?: string;
  /** Адмінська частина — публічно не передається. */
  admin?: {
    score: number;
    gearScore: number;
    adjust: number;
    rating: number;
    adjustNote: string | null;
    elo?: { rating: number; games: number; wins: number };
    attackLevel: number | null;
    defenseLevel: number | null;
    /** версія шкали — для діапазону рангу */
    version: string;
    /** скор зі знімка жеребки відрізняється від живого — показуємо обидва */
    liveScore?: number;
  };
}

/** Анкета рядками «поле → значення» (та сама інформація, що в gearSummary, але читабельно). */
export function gearRows(g: PlayerGear, gemsMix?: string): { label: string; value: string }[] {
  const sets = SPECIAL_SET_ORDER.filter((s) => g.specialSets.includes(s));
  return [
    { label: 'Рівень', value: g.charLevel ? CHAR_LEVEL_LABELS[g.charLevel] : '—' },
    { label: 'Збірка', value: g.build ? BUILD_LABELS[g.build] : '—' },
    { label: 'Зброя', value: `${WEAPON_GRADE_LABELS[g.weaponGrade]} ${WEAPON_REFINE_LABELS[g.weaponRefine]}${g.weaponPz ? ' · є ПЗ-зброя' : ''}` },
    { label: 'Броня', value: `${ARMOR_SET_LABELS[g.armorSet]} · круг точки ${ARMOR_REFINE_LABELS[g.armorRefine]}` },
    { label: 'Камені', value: gemsMix ? `${gemsMix} → бали як «${GEMS_LABELS[g.gems]}»` : GEMS_LABELS[g.gems] },
    { label: 'Сети', value: sets.length ? sets.map((s) => `${SPECIAL_SET_LABELS[s]} (${GEMS_LABELS[g.specialSetGems[s] ?? 'g0_9']})`).join(', ') : '—' },
    { label: 'Трактат', value: TRACT_LABELS[g.tract] },
    { label: 'Джин', value: GENIE_LABELS[g.genie] },
    { label: 'ШГ / Вознєс', value: shgVoznesLabel(g) || '—' },
    { label: 'Кільця', value: ringsLabel(g) || '—' },
  ];
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** «від 130» / «130–174» — межі рангу за порогами версії. */
function tierRange(tier: Tier, version: string): string {
  const tiers = rulesFor(version).tiers;
  const i = tiers.findIndex((t) => t.tier === tier);
  if (i < 0) return '';
  const min = tiers[i].min;
  const upper = i > 0 ? tiers[i - 1].min - 1 : null;
  if (!Number.isFinite(min)) return upper === null ? '' : `до ${upper}`;
  return upper === null ? `від ${min}` : `${min}–${upper}`;
}

const POP_W = 380;
const GAP = 6;

function Popover({ info, anchor, pinned, onEnter, onLeave }: { info: PlayerCardInfo; anchor: DOMRect; pinned: boolean; onEnter: () => void; onLeave: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Під бейджем, вирівняно по його лівому краю; не вміщається знизу — над ним;
  // не вміщається праворуч — притискаємо до правого краю вікна.
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    const w = Math.min(POP_W, window.innerWidth - 16);
    let top = anchor.bottom + GAP;
    if (top + h > window.innerHeight - 8) top = Math.max(8, anchor.top - GAP - h);
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8));
    setPos({ top, left });
  }, [anchor]);

  const a = info.admin;
  const rows = gearRows(info.gear, info.gemsMix);
  if (info.weaponAbility) rows.splice(3, 0, { label: 'Абілка', value: info.weaponAbility });
  const style: CSSProperties = { top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: Math.min(POP_W, window.innerWidth - 16) };

  return createPortal(
    <div ref={ref} className={'player-pop' + (pinned ? ' pinned' : '')} style={style} role="dialog" onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={(e) => e.stopPropagation()}>
      <div className="player-pop-head">
        <b title={info.nickname}>{info.nickname}</b>
        <span className="badge mute">{CLASS_LABELS[info.gear.charClass]}</span>
        <span className={'badge tier tier-' + info.tier} style={{ cursor: 'default' }}>{info.tier}</span>
      </div>
      {a && (
        <div className="player-pop-score">
          <span>Скор <b>{a.score}</b>{a.liveScore !== undefined && a.liveScore !== a.score ? <span className="hint" style={{ margin: 0 }}> (на момент жеребки; зараз {a.liveScore})</span> : null}</span>
          <span className="hint" style={{ margin: 0 }}>гір {a.gearScore} · корекція {signed(a.adjust)} · рейтинг {signed(a.rating)} · ранг {info.tier}: {tierRange(info.tier, a.version)}</span>
          {a.elo && a.elo.games > 0 && <span className="hint" style={{ margin: 0 }}>Ело {Math.round(a.elo.rating)} · {a.elo.games} ігор · {a.elo.wins} перемог</span>}
        </div>
      )}
      <div className="player-pop-rows">
        {rows.map((r) => (
          <div key={r.label} className="player-pop-row">
            <span className="player-pop-label">{r.label}</span>
            <span>{r.value}</span>
          </div>
        ))}
        {a && (a.attackLevel !== null || a.defenseLevel !== null) && (
          <div className="player-pop-row">
            <span className="player-pop-label">ПА / ПЗ</span>
            <span>{a.attackLevel ?? '—'} / {a.defenseLevel ?? '—'}</span>
          </div>
        )}
        {a && a.adjust !== 0 && (
          <div className="player-pop-row">
            <span className="player-pop-label">Корекція</span>
            <span><b>{signed(a.adjust)}</b>{a.adjustNote ? ` — ${a.adjustNote}` : ''}</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Бейдж рангу з попапом. width — ширина колонки в рядку гравця (щоб вирівнювалось). */
export default function TierBadge({ info, width = 28, style }: { info: PlayerCardInfo; width?: number; style?: CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const show = () => {
    cancelClose();
    if (ref.current) setAnchor(ref.current.getBoundingClientRect());
    setOpen(true);
  };
  const hide = () => { cancelClose(); setOpen(false); setPinned(false); };
  // Закриття з наведення — із затримкою, щоб курсор встиг перейти на сам попап.
  const scheduleHide = () => { if (pinned) return; cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 160); };

  const toggle = (e: MouseEvent | KeyboardEvent) => {
    // Бейдж живе всередині клікабельних рядків (свопи в модалці) — не пускаємо клік далі.
    e.stopPropagation();
    e.preventDefault();
    if (pinned) { hide(); return; }
    setPinned(true);
    show();
  };

  // Закріплений попап закривається Esc, кліком поза ним, скролом/ресайзом (позиція застаріває).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    // Клік поза бейджем і поза самим попапом (він у порталі, тому не нащадок ref).
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (ref.current && !ref.current.contains(t) && !t?.closest?.('.player-pop')) hide();
    };
    const onMove = () => hide();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => cancelClose, []);

  return (
    <>
      <span
        ref={ref}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={'badge tier tier-' + info.tier}
        title={info.nickname}
        style={{ width, boxSizing: 'border-box', justifyContent: 'center', padding: '3px 0', flexShrink: 0, ...style }}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(e); }}
      >
        {info.tier}
      </span>
      {open && anchor && <Popover info={info} anchor={anchor} pinned={pinned} onEnter={cancelClose} onLeave={scheduleHide} />}
    </>
  );
}
