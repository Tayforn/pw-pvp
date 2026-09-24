// =========================================================
// Правила турніру списком пунктів — з tournaments.rules_md, розбитого по
// рядках (перший рядок без маркера = формат, далі «• пункт»). Старий вільний
// текст теж читається: кожен непорожній рядок стає пунктом. Використовується
// на сторінці турніру (картка «Правила») і на сторінці реєстрації над
// галочкою «З правилами ознайомлений(а)» — щоб обидві показували одне й те саме.
// =========================================================

import { parseRulesMd } from '../data/ruleCatalog';

export default function RulesList({ rulesMd, compact = false }: { rulesMd: string | null | undefined; compact?: boolean }) {
  const { title, points } = parseRulesMd(rulesMd);
  if (points.length === 0 && !title) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 6 : 8 }}>
      {title && <b style={{ fontSize: compact ? 13.5 : 14.5 }}>{title}</b>}
      {points.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: compact ? 4 : 6, fontSize: compact ? 13.5 : undefined }}>
          {points.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      )}
    </div>
  );
}
