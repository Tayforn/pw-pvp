// =========================================================
// П'єдестал турніру (топ-3) — для Головної. 2-ге/3-тє місце можуть бути
// відсутні (третього місця не завжди грають) — рендеримо лише наявні.
// =========================================================

import type { Podium as PodiumData } from '../data/bracket';

const TIERS = [
  { key: 'first' as const, medal: '🥇', label: '1 місце', bg: 'linear-gradient(135deg, rgba(227, 185, 94, 0.22), rgba(199, 154, 62, 0.08))', border: 'rgba(227, 185, 94, 0.45)' },
  { key: 'second' as const, medal: '🥈', label: '2 місце', bg: 'linear-gradient(135deg, rgba(205, 214, 222, 0.2), rgba(150, 160, 170, 0.07))', border: 'rgba(205, 214, 222, 0.4)' },
  { key: 'third' as const, medal: '🥉', label: '3 місце', bg: 'linear-gradient(135deg, rgba(205, 140, 90, 0.2), rgba(160, 100, 60, 0.08))', border: 'rgba(205, 140, 90, 0.4)' },
];

export default function Podium({ podium, caption }: { podium: PodiumData; caption?: string }) {
  const tiers = TIERS.filter((t) => podium[t.key]);
  return (
    <div>
      {caption && <p className="hint" style={{ marginBottom: 10 }}>{caption}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        {tiers.map((t) => (
          <div
            key={t.key}
            style={{
              flex: '1 1 160px',
              padding: '18px 16px',
              borderRadius: 14,
              background: t.bg,
              border: `1px solid ${t.border}`,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 32, lineHeight: 1, marginBottom: 8 }}>{t.medal}</div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--accent-3)', fontWeight: 700, marginBottom: 4 }}>
              {t.label}
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{podium[t.key]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
