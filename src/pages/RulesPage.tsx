import { useState } from 'react';
import PageMeta from '../app/PageMeta';
import { RULE_SECTIONS } from '../data/standardRules';

export default function RulesPage() {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copy = (idx: number, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx((v) => (v === idx ? null : v)), 1500);
  };

  return (
    <div>
      <PageMeta title="Правила — PW PvP" description="Правила турнірів PW PvP за форматом: 1х1, 2х2, 3х3/5х5/6х6/10х10." />
      <div className="section-head">
        <span className="eyebrow">PvP</span>
        <h2>Правила турнірів</h2>
        <p>Загальні правила за форматом. Конкретний турнір може уточнювати їх окремо на своїй сторінці.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {RULE_SECTIONS.map((s, i) => (
          <div key={s.title} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>{s.title}</h3>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(i, s.body)}>
                {copiedIdx === i ? 'Скопійовано!' : 'Копіювати'}
              </button>
            </div>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
