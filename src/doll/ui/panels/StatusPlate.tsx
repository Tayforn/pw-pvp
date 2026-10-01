// =========================================================
// ЛЯЛЬКА — плашка стану персонажа внизу правої колонки (розкладка B3).
// Зелена «Усе заповнено» — коли є імʼя, вільних очок 0, шлях з 89 рівня, усі
// речі вдягаються, є зброя й заповнені слоти броні Головного; інакше жовта
// «Бракує: …». Нижче — жовті нагадування «Зверни увагу», які нічого не
// блокують: джина не заповнено, лялька не розпізнала грейд речі (зараховано
// нижчий), примітки скору v2, попередження джина, старі галочки ШГ/Вознєс без
// речі. Дані — useReadiness (спільний розрахунок із карткою «Готовність до
// турніру»), model/readiness.ts.
// =========================================================

import { PATH_LEVEL } from '../../model/passives';
import type { ReadinessIssues } from '../../model/readiness';
import { useEditor } from '../EditorContext';
import { useReadiness } from './ReadinessCard';
import '../doll-panels.css';

/** Чиста частина плашки (для тестів). checked = false — перевірити не вдалося. */
export function StatusPlateView({ issues, checked, level }: { issues: ReadinessIssues; checked: boolean; level: number }) {
  const { blockers, notes } = issues;
  if (!checked) {
    return (
      <section className="doll-status warn" aria-label="Стан персонажа">
        <b className="doll-status-t">Персонажа не вдалося перевірити</b>
        <span className="doll-status-s">Лялька не змогла розібрати речі — спробуй перезавантажити сторінку.</span>
      </section>
    );
  }
  const ok = blockers.length === 0;
  return (
    <section className={'doll-status ' + (ok ? 'good' : 'warn')} aria-label="Стан персонажа">
      {ok ? (
        <>
          <b className="doll-status-t">Усе заповнено</b>
          <span className="doll-status-s">
            Очки роздано{level >= PATH_LEVEL ? ', шлях вказано' : ''}, усі речі вдягаються, зброя й броня на місці.
          </span>
        </>
      ) : (
        <>
          <b className="doll-status-t">Бракує</b>
          <ul className="doll-status-list">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </>
      )}
      {notes.length > 0 && (
        <div className="doll-status-notes">
          <b className="doll-status-t">Зверни увагу</b>
          <ul className="doll-status-list">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function StatusPlate() {
  const api = useEditor();
  const { facts, issues } = useReadiness();
  return <StatusPlateView issues={issues} checked={!!facts} level={api.doc.level} />;
}

export default StatusPlate;
