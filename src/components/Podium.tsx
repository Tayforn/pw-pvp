// =========================================================
// П'єдестал турніру (топ-3) — для Головної. Класична схема 2–1–3:
// перше місце по центру й найвище. 2-ге/3-тє можуть бути відсутні
// (третього місця не завжди грають) — рендеримо лише наявні.
// =========================================================

import type { Podium as PodiumData } from '../data/bracket';

// Порядок у масиві = порядок на екрані (зліва направо).
const TIERS = [
  {
    key: 'second' as const,
    medal: '🥈',
    place: 2,
    height: 78,
    blockBg: 'linear-gradient(180deg, var(--rank-silver-1), var(--rank-silver-2))',
    numberColor: 'var(--rank-silver-ink)',
  },
  {
    key: 'first' as const,
    medal: '🥇',
    place: 1,
    height: 120,
    blockBg: 'linear-gradient(180deg, var(--rank-gold-1), var(--rank-gold-2))',
    numberColor: 'var(--rank-gold-ink)',
  },
  {
    key: 'third' as const,
    medal: '🥉',
    place: 3,
    height: 56,
    blockBg: 'linear-gradient(180deg, var(--rank-bronze-1), var(--rank-bronze-2))',
    numberColor: 'var(--rank-bronze-ink)',
  },
];

export default function Podium({ podium, caption }: { podium: PodiumData; caption?: string }) {
  const tiers = TIERS.filter((t) => podium[t.key]);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, maxWidth: 560, marginInline: 'auto' }}>
        {tiers.map((t) => (
          <div key={t.key} style={{ flex: t.place === 1 ? '1.2 1 0' : '1 1 0', minWidth: 0, textAlign: 'center' }}>
            <div style={{ fontSize: t.place === 1 ? 44 : 32, lineHeight: 1, marginBottom: 8 }}>{t.medal}</div>
            <div
              title={podium[t.key] ?? undefined}
              style={{
                fontWeight: 700,
                fontSize: t.place === 1 ? 17 : 14,
                color: t.place === 1 ? 'var(--accent-3)' : 'var(--text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginBottom: 10,
                padding: '0 4px',
              }}
            >
              {podium[t.key]}
            </div>
            <div
              style={{
                height: t.height,
                borderRadius: '8px 8px 0 0',
                background: t.blockBg,
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800,
                fontSize: t.place === 1 ? 34 : 24,
                color: t.numberColor,
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.25)',
              }}
            >
              {t.place}
            </div>
          </div>
        ))}
      </div>
      {caption && (
        <p className="hint" style={{ textAlign: 'center', marginTop: 10, marginBottom: 0 }}>{caption}</p>
      )}
    </div>
  );
}
