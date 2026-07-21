// =========================================================
// Виділений блочок переможця турніру — спільний для головної (карта серії)
// і сторінки історії серії (карта окремого турніру).
// =========================================================

export default function ChampionBlock({ nickname, label = 'Чемпіон' }: { nickname: string; label?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        borderRadius: 'var(--radius-lg)',
        background: 'linear-gradient(135deg, var(--glow-gold-1), var(--glow-gold-2))',
        border: '1px solid var(--glow-gold-border)',
      }}
    >
      <span style={{ fontSize: 24, lineHeight: 1 }}>🏆</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--accent-3)', fontWeight: 700 }}>
          {label}
        </div>
        <div style={{ fontWeight: 700, fontSize: 15.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nickname}</div>
      </div>
    </div>
  );
}
