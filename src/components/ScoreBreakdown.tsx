// =========================================================
// pw-pvp: «Розклад по речах» — рядки item_breakdown заявки (скор v2 «від
// речей») за конфігураціями: Головний, потім сети в порядку документа. Живе в
// головному бандлі й каталогу ляльки не знає: назву речі дає необовʼязковий
// resolver (форма заявки — з результату ляльки, адмінка — з каталогу), без
// нього рядок — слот, бали й «чому». Публічно числа скору не показуються
// (showPoints=false — лише слоти й назви). Типово згорнуто (details).
// =========================================================

import { slotLabel } from '../data/slotLabels';
import type { ItemBreakdown, ItemBreakdownRow } from '../data/types';

export interface ScoreBreakdownProps {
  breakdown: ItemBreakdown | null;
  /** Назва речі за id каталогу й слотом; null — назви не показувати. */
  resolver?: (catId: number, slot: string) => string | null;
  /** Назви сетів за індексом (cfg − 1) — зі знімка документа; без них — «Сет N». */
  setNames?: readonly string[];
  /** Розгорнути одразу. */
  open?: boolean;
  /** Бали в рядках і підсумках (адміну й самому гравцю); публічно — false. */
  showPoints?: boolean;
  title?: string;
}

/** Бали для показу: до 2 знаків, без хвостових нулів. */
export const fmtPoints = (n: number): string => String(Math.round(n * 100) / 100);

/** Назви сетів зі знімка ляльки в заявці (character_snapshot) — підписи
 * конфігурацій розкладу без перевірки документа й без чанка ляльки: лише
 * рядки name у sets (решта — порожньо → «Сет N»); без знімка — []. */
export function setNamesOf(snapshot: unknown): string[] {
  const sets = (snapshot as { sets?: unknown } | null)?.sets;
  if (!Array.isArray(sets)) return [];
  return sets.map((s) => (s && typeof s === 'object' && typeof (s as { name?: unknown }).name === 'string' ? (s as { name: string }).name : ''));
}

/** «Головний» / «Сет «Спів»» / «Сет 2». */
export function cfgLabel(cfg: number, setNames?: readonly string[]): string {
  if (cfg === 0) return 'Головний';
  const name = setNames?.[cfg - 1];
  return name ? `Сет «${name}»` : `Сет ${cfg}`;
}

/** Рядки за конфігураціями в порядку cfg (Головний перед сетами) — порядок рядків усередині зберігається. */
export function groupRows(rows: readonly ItemBreakdownRow[]): Array<{ cfg: number; rows: ItemBreakdownRow[] }> {
  const by = new Map<number, ItemBreakdownRow[]>();
  for (const r of rows) by.set(r[0], [...(by.get(r[0]) ?? []), r]);
  return [...by.keys()].sort((a, b) => a - b).map((cfg) => ({ cfg, rows: by.get(cfg)! }));
}

/** «Головний 251.85 · сети 11.83 (до стелі 31) · ШГ + Вознєс 5 · клас 8 · рівень 7 · джин 10». */
export function sumLine(sum: ItemBreakdown['sum']): string {
  const parts = [`Головний ${fmtPoints(sum.main)}`];
  parts.push(`сети ${fmtPoints(sum.sets)}${sum.setsRaw > sum.sets ? ` (до стелі ${fmtPoints(sum.setsRaw)})` : ''}`);
  if (sum.pair > 0) parts.push(`ШГ + Вознєс ${fmtPoints(sum.pair)}`);
  if (sum.cls !== undefined) parts.push(`клас ${fmtPoints(sum.cls)}`);
  if (sum.lvl !== undefined) parts.push(`рівень ${fmtPoints(sum.lvl)}`);
  if (sum.genie !== undefined) parts.push(`джин ${fmtPoints(sum.genie)}`);
  return parts.join(' · ');
}

export default function ScoreBreakdown({ breakdown, resolver, setNames, open = false, showPoints = true, title = 'Розклад по речах' }: ScoreBreakdownProps) {
  if (!breakdown) return null;
  const groups = groupRows(breakdown.rows);
  const itemPoints = breakdown.sum.main + breakdown.sum.sets + breakdown.sum.pair;
  const total = (rows: ItemBreakdownRow[]) => rows.reduce((s, r) => s + r[3], 0);
  return (
    <details className="score-bd" open={open}>
      <summary>
        {title}
        {showPoints ? <span className="score-bd-total"> · {fmtPoints(itemPoints)} б.</span> : null}
      </summary>
      <div className="score-bd-body">
        {groups.length === 0 && <span className="hint score-bd-empty">Зарахованих речей немає.</span>}
        {groups.map(({ cfg, rows }) => (
          <div key={cfg} className="score-bd-cfg">
            <div className="score-bd-cfg-name">
              {cfgLabel(cfg, setNames)}
              {showPoints ? <span className="score-bd-cfg-pts">{fmtPoints(total(rows))} б.</span> : null}
            </div>
            {rows.map((r, i) => {
              const [, slot, catId, points, why] = r;
              const name = resolver?.(catId, slot) ?? null;
              return (
                <div key={`${slot}-${catId}-${i}`} className="score-bd-row">
                  <span className="score-bd-slot">{slotLabel(slot)}</span>
                  <span className="score-bd-name">
                    {name ?? ''}
                    {why ? <span className="hint score-bd-why">{why}</span> : null}
                  </span>
                  {showPoints ? <b className="score-bd-pts">{fmtPoints(points)}</b> : null}
                </div>
              );
            })}
          </div>
        ))}
        {showPoints && <span className="hint score-bd-sum">{sumLine(breakdown.sum)}</span>}
        {breakdown.warn?.map((w, i) => (
          <span key={i} className="hint score-bd-warn">{w}</span>
        ))}
      </div>
    </details>
  );
}
