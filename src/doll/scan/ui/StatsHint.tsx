// =========================================================
// ЛЯЛЬКА ЗІ СКРІНШОТІВ — підказка «гра / лялька»: числа вікна «Персонаж» зі
// скріншота проти того, що рахує лялька в активному комплекті. Оновлюється з
// кожною правкою ляльки, тож видно, як заточки, камені й роли наближають її
// до гри. Згори — лише розбіжності (компактною сіткою, щоб не відсувати ляльку
// вниз), повна таблиця — під «Усі числа».
// =========================================================

import { useCatalog } from '../../data/catalog';
import { useRefData } from '../../data/refLoader';
import type { CharacterDoc } from '../../model/doc';
import { docCats, type ItemLookup } from '../../model/hydrate';
import { compareStats, type StatRow } from '../compare';
import type { StatsScan } from '../stats';
import './shots.css';

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

function Table({ rows }: { rows: StatRow[] }) {
  return (
    <table className="shot-table">
      <thead>
        <tr>
          <th>Показник</th>
          <th>У грі</th>
          <th>У ляльці</th>
          <th>Різниця</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={r.ok === false ? 'is-bad' : r.ok === null ? 'is-mute' : ''}>
            <td>{r.label}</td>
            <td>{r.game === null ? 'не прочитано' : fmt(r, r.game)}</td>
            <td>{fmt(r, r.doll)}</td>
            <td>{r.ok === false ? fmtDiff(r) : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface StatsHintProps {
  doc: CharacterDoc;
  /** Активний комплект редактора ('main' або id сету). */
  cfgId: string;
  stats: StatsScan;
  onClose(): void;
  /** Лише для тестів: каталог з диска замість завантаженого застосунком. */
  lookup?: ItemLookup;
}

export default function StatsHint({ doc, cfgId, stats, onClose, lookup }: StatsHintProps) {
  // Числа мають сенс лише з повним каталогом і довідниками — їх і так вантажить редактор.
  const ref = useRefData();
  const cat = useCatalog(docCats(doc));
  if (!lookup && (!ref.ready || !cat.ready)) return null;
  const known = cfgId === 'main' || doc.sets.some((s) => s.id === cfgId);
  const rows = compareStats(doc, known ? cfgId : 'main', stats, lookup);
  const bad = rows.filter((r) => r.ok === false);
  const unread = rows.filter((r) => r.ok === null).length;
  return (
    <section className="card shot-hint" aria-label="Числа з гри">
      <div className="shot-head">
        <h3>Числа з гри</h3>
        <span className={'badge ' + (bad.length ? 'warn' : 'good')}>
          збігається {rows.length - bad.length - unread} з {rows.length - unread}
        </span>
        {unread > 0 && <span className="badge mute">не прочитано {unread}</span>}
        <button type="button" className="shot-x" aria-label="Прибрати підказку з числами" onClick={onClose}>
          ✕
        </button>
      </div>
      {bad.length === 0 ? (
        <p>Лялька в цьому комплекті дає ті самі числа, що й вікно «Персонаж» на скріншоті.</p>
      ) : (
        <>
          <p>
            Гра → лялька. Різницю дають заточки, камені, роли, гравіювання, титули й атрибути — доводь їх у ляльці, числа оновлюються самі.
          </p>
          <ul className="shot-diffs">
            {bad.map((r) => (
              <li key={r.key}>
                <span>{r.label}</span>
                <b>
                  {r.game === null ? '' : fmt(r, r.game)} → {fmt(r, r.doll)}
                </b>
                <i>{fmtDiff(r)}</i>
              </li>
            ))}
          </ul>
        </>
      )}
      <details>
        <summary>Усі числа ({rows.length})</summary>
        <Table rows={rows} />
      </details>
    </section>
  );
}
