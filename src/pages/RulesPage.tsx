import { useState } from 'react';
import PageMeta from '../app/PageMeta';
import { RULE_SECTIONS } from '../data/standardRules';

export default function RulesPage() {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copy = (idx: number, points: string[]) => {
    navigator.clipboard?.writeText(points.map((p) => `• ${p}`).join('\n'));
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx((v) => (v === idx ? null : v)), 1500);
  };

  return (
    <div>
      <PageMeta title="Правила — PW PvP" description="Правила турнірів PW PvP за форматом: 1х1, 2х2, 3х3/5х5/6х6/10х10." />
      <div className="section-head">
        <span className="eyebrow">PvP</span>
        <h2>Правила турнірів</h2>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {RULE_SECTIONS.map((s, i) => (
          <div key={s.title} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>{s.title}</h3>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(i, s.points)}>
                {copiedIdx === i ? 'Скопійовано!' : 'Копіювати'}
              </button>
            </div>
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
