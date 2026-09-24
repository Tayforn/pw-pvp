import PageMeta from '../app/PageMeta';
import { ruleSectionsFor } from '../data/standardRules';
import { useRuleCatalog } from '../data/catalogStore';

// Секції — з дефолтів довідника рядків (0027) за трьома форматами: 1х1,
// готові команди, балансний фул-рандом — тим самим рендерером, що й попап
// «Правила…» в адмінці, тож сторінка і текст нового турніру не розходяться.
export default function RulesPage() {
  const { items } = useRuleCatalog();
  const sections = ruleSectionsFor(items);
  return (
    <div>
      <PageMeta title="Правила — PW PvP" description="Правила турнірів PW PvP за форматом: 1х1, командні турніри з готовими командами та балансний фул-рандом." />
      <div className="section-head">
        <span className="eyebrow">PvP</span>
        <h2>Правила турнірів</h2>
        <p>Стандартні правила за форматом. Точний текст кожного турніру — на його сторінці: адмін може змінити пункти для конкретного турніру.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {sections.map((s) => (
          <div key={s.title} className="card">
            <h3 style={{ margin: '0 0 10px' }}>{s.title}</h3>
            <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {s.points.map((p, pi) => (
                <li key={pi}>{p}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
