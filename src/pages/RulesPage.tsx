import PageMeta from '../app/PageMeta';
import { RULE_SECTIONS } from '../data/standardRules';

export default function RulesPage() {
  return (
    <div>
      <PageMeta title="Правила — PW PvP" description="Правила турнірів PW PvP за форматом: 1х1, 2х2, 3х3/5х5/6х6/10х10." />
      <div className="section-head">
        <span className="eyebrow">PvP</span>
        <h2>Правила турнірів</h2>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {RULE_SECTIONS.map((s) => (
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
