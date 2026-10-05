// =========================================================
// ЗВІРКА — звіт: який комплект надіто, які речі в ньому не ті і чи збігаються
// числа вікна «Персонаж» з рушієм ляльки. Чистий компонент: усе приходить
// пропсами, зміни йдуть назовні (onFix, onCfg) — документ тримає сторінка.
// =========================================================

import type { ReactNode } from 'react';
import { SLOTS } from '../../core/constants';
import { iconStyle } from '../../data/assets';
import { getItem } from '../../data/catalog';
import { SLOT_CAT, type CharacterDoc, type SlotKey } from '../../model/doc';
import type { ItemLookup } from '../../model/hydrate';
import { itemDisplayName } from '../../model/tipModel';
import type { EquipScan } from '../equip';
import { buildReport, type CfgMatch, type SlotDiff, type StatRow } from '../reconcile';
import type { StatsScan } from '../stats';
import './check.css';

const SLOT_LABEL: Record<string, string> = Object.fromEntries(SLOTS.map((s) => [s.slot, s.label]));
/** Назва-заглушка невикористаної речі каталогу. */
const UNUSED_RE = /не используется|не використовується/i;
/** Скільки назв речей зі спільною іконкою показуємо, решту — числом. */
const MAX_NAMES = 2;

export interface CheckReportProps {
  doc: CharacterDoc;
  equip: EquipScan | null;
  stats: StatsScan | null;
  /** Конфігурація, вибрана гравцем; null — та, яку визначив сканер. */
  cfgId: string | null;
  onCfg(id: string | null): void;
  /** Надіти річ з інвентаря в слот конфігурації. */
  onFix(cfgId: string, slot: SlotKey, iid: string): void;
  /** Вирізки клітинок зі скріншота (data-URL) — що саме побачив сканер. */
  thumbs?: Partial<Record<SlotKey, string>>;
  lookup?: ItemLookup;
}

/** Число так, як його пише гра: атак/сек — два знаки, швидкість — один. */
function fmt(row: StatRow, v: number): string {
  if (row.key === 'aps') return v.toFixed(2);
  if (row.key === 'speed') return v.toFixed(1);
  return String(v);
}
function fmtDiff(row: StatRow): string {
  if (row.game === null) return '';
  const d = row.doll - row.game;
  const text = row.key === 'aps' ? d.toFixed(2) : row.key === 'speed' ? d.toFixed(1) : String(Math.round(d));
  return d > 0 ? '+' + text : text.replace('-', '−');
}

export default function CheckReport({ doc, equip, stats, cfgId, onCfg, onFix, thumbs = {}, lookup = getItem }: CheckReportProps) {
  if (!equip && !stats) return null;
  const report = buildReport(doc, equip, stats, cfgId, lookup);
  const { cfg } = report;

  const instName = (iid: string | null): string => {
    const inst = iid ? doc.items.find((it) => it.i === iid) : undefined;
    if (!inst) return 'порожньо';
    const item = lookup(inst.cat, inst.id);
    return (item ? itemDisplayName(item, inst.cat) : 'невідома річ #' + inst.id) + (inst.r ? ' +' + inst.r : '');
  };
  const instIcon = (iid: string | null): ReactNode => {
    const inst = iid ? doc.items.find((it) => it.i === iid) : undefined;
    const item = inst ? lookup(inst.cat, inst.id) : undefined;
    return <span className="chk-cell">{inst && item && <span className="doll-icon" style={iconStyle(item, inst.cat, doc.gender)} />}</span>;
  };
  /** Назви речей каталогу з такою іконкою, як на скріншоті. */
  const seenNames = (d: SlotDiff): string => {
    const cat = SLOT_CAT[d.slot];
    const all = [...new Set(d.seen.ids.map((id) => lookup(cat, id)).map((it) => (it ? itemDisplayName(it, cat) : '')))].filter(Boolean);
    // Заглушки каталогу («Не используется») гравцеві нічого не кажуть — ховаємо, якщо є справжні назви.
    const real = all.filter((n) => !UNUSED_RE.test(n));
    const names = real.length ? real : all;
    if (!names.length) return 'річ, якої немає в каталозі';
    const rest = names.length - MAX_NAMES;
    return names.slice(0, MAX_NAMES).join(' або ') + (rest > 0 ? ' або ще ' + rest + ' з такою іконкою' : '');
  };
  const seenIcon = (d: SlotDiff): ReactNode => {
    const src = thumbs[d.slot];
    const item = d.seen.ids.length ? lookup(SLOT_CAT[d.slot], d.seen.ids[0]) : undefined;
    return (
      <span className="chk-cell">
        {src ? <img className="chk-thumb" src={src} width={32} height={32} alt="" /> : item ? <span className="doll-icon" style={iconStyle(item, SLOT_CAT[d.slot], doc.gender)} /> : null}
      </span>
    );
  };

  const cfgButton = (c: CfgMatch): ReactNode => (
    <button
      key={c.cfgId}
      type="button"
      className={'chk-cfg' + (c.cfgId === cfg.cfgId ? ' is-on' : '')}
      aria-pressed={c.cfgId === cfg.cfgId}
      onClick={() => onCfg(c.cfgId === report.autoCfgId ? null : c.cfgId)}
    >
      <span>{c.name}</span>
      {equip && (
        <span className="chk-cfg-n">
          {c.same}/{c.slots.length}
        </span>
      )}
    </button>
  );

  const diffs = cfg.slots.filter((d) => d.status !== 'same');
  const same = cfg.slots.filter((d) => d.status === 'same');

  const action = (d: SlotDiff): ReactNode => {
    if (d.status === 'unsure') return <span className="chk-note">На скріншоті не розібрати, що в цьому слоті.</span>;
    if (d.status === 'extra') return <span className="chk-note">У грі слот порожній. Якщо так і має бути — зніми річ у ляльці.</span>;
    if (!d.fixIids.length) return <span className="chk-note">Такої речі в ляльці немає — додай її в редакторі.</span>;
    return (
      <span className="chk-fixes">
        {d.fixIids.map((iid) => (
          <button key={iid} type="button" className="btn btn-primary btn-sm" onClick={() => onFix(cfg.cfgId, d.slot, iid)}>
            Надіти: {instName(iid)}
          </button>
        ))}
      </span>
    );
  };

  const bad = report.stats ? report.stats.filter((r) => r.ok === false) : [];
  const unread = report.stats ? report.stats.filter((r) => r.ok === null) : [];

  return (
    <div className="chk-report">
      <section className="card chk-card">
        <div className="chk-head">
          <h3>Комплект</h3>
          <span className="hint">
            {equip
              ? 'Визначено за речами на скріншоті. Якщо надіто інший — вибери його.'
              : 'Скріншота спорядження немає — комплект підібрано за числами. Якщо надіто інший — вибери його.'}
          </span>
        </div>
        <div className="chk-cfgs">{report.configs.map(cfgButton)}</div>
      </section>

      {equip && (
        <section className="card chk-card">
          <div className="chk-head">
            <h3>Речі</h3>
            <span className={'badge ' + (diffs.length ? 'warn' : 'good')}>
              збіглося {same.length} з {cfg.slots.length}
            </span>
          </div>
          {diffs.length === 0 && <p className="chk-ok">Усі речі комплекту «{cfg.name}» збігаються зі скріншотом.</p>}
          {diffs.map((d) => (
            <div key={d.slot} className="chk-row" data-slot={d.slot}>
              <span className="chk-slot">{SLOT_LABEL[d.slot] ?? d.slot}</span>
              <span className="chk-side">
                {seenIcon(d)}
                <span className="chk-side-t">
                  <span className="chk-side-l">у грі</span>
                  <span>{d.seen.state === 'empty' ? 'порожньо' : d.seen.state === 'unknown' ? 'не впізнано' : seenNames(d)}</span>
                </span>
              </span>
              <span className="chk-side">
                {instIcon(d.dollIid)}
                <span className="chk-side-t">
                  <span className="chk-side-l">у ляльці</span>
                  <span>{instName(d.dollIid)}</span>
                </span>
              </span>
              <span className="chk-act">{action(d)}</span>
            </div>
          ))}
          {same.length > 0 && (
            <details className="chk-same">
              <summary>Збігаються ({same.length})</summary>
              <ul>
                {same.map((d) => (
                  <li key={d.slot}>
                    {instIcon(d.dollIid)}
                    <span>
                      <span className="chk-side-l">{SLOT_LABEL[d.slot] ?? d.slot}</span>
                      <span>{instName(d.dollIid)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="hint">Заточку, камені й роли на скріншоті не видно — їх перевіряють числа нижче. Політ не звіряється.</p>
        </section>
      )}

      {report.stats && (
        <section className="card chk-card">
          <div className="chk-head">
            <h3>Характеристики</h3>
            <span className={'badge ' + (bad.length ? 'bad' : 'good')}>
              збігається {report.stats.length - bad.length - unread.length} з {report.stats.length - unread.length}
            </span>
            {unread.length > 0 && <span className="badge mute">не прочитано {unread.length}</span>}
          </div>
          {bad.length === 0 ? (
            <p className="chk-ok">Числа ляльки в комплекті «{cfg.name}» збігаються з грою.</p>
          ) : (
            <p className="chk-warn">
              Розбіжностей: {bad.length}. Спершу виправ речі вище; якщо речі збігаються — шукай різницю в заточці, каменях, ролах, гравіюваннях,
              титулах або атрибутах. Скріншот має бути без бафів.
            </p>
          )}
          <table className="chk-table">
            <thead>
              <tr>
                <th>Показник</th>
                <th>У грі</th>
                <th>У ляльці</th>
                <th>Різниця</th>
              </tr>
            </thead>
            <tbody>
              {report.stats.map((r) => (
                <tr key={r.key} className={r.ok === false ? 'is-bad' : r.ok === null ? 'is-mute' : ''}>
                  <td>{r.label}</td>
                  <td>{r.game === null ? 'не прочитано' : fmt(r, r.game)}</td>
                  <td>{fmt(r, r.doll)}</td>
                  <td>{r.ok === false ? fmtDiff(r) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
