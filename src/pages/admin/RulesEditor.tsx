// =========================================================
// Адмінка (суперадмін): спільні поля редактора версії шкали.
//
// Сам редактор розпався на дві вкладки з ОДНІЄЮ чернеткою (data/rulesDraftStore):
//   • ScaleTab.tsx  — «Шкала балів»: скільки коштує гравець сам по собі;
//   • TeamTab.tsx   — «Бафи й склад»: як із гравців збирати команди
//     (бафи тімейтів, правило 4, склад, алгоритм);
//   • RulesFooter.tsx — sticky-футер «Зберегти як нову версію» на обох.
// Тут лишились лише дрібні поля, якими користуються обидві вкладки, — щоб
// вони виглядали однаково й не дублювались.
//
// Зберігання — лише як НОВА версія (balance-v1.1, v1.2, …): турніри, чиї
// команди вже сформовано, назавжди рахуються своєю версією, а нові турніри
// беруть найновішу.
// =========================================================

import type { ReactNode } from 'react';

/** Ціле число ≥ 0 у вузькому полі з підписом (підпис обрізається трьома крапками). */
export function NumInput({ label, value, onChange, width = 92 }: { label: string; value: number; onChange: (v: number) => void; width?: number }) {
  return (
    <label className="field" style={{ flex: `0 1 ${width}px` }}>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={label}>{label}</span>
      <input
        type="number"
        min={0}
        step={1}
        value={Number.isFinite(value) ? value : ''}
        style={{ padding: '8px 10px', fontSize: 14 }}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Math.max(0, Math.round(Number(e.target.value))))}
      />
    </label>
  );
}

/** Відсоток (0–100) для значення 0–1 — підпис не обрізається. */
export function PctInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="field" style={{ flex: '0 0 auto', width: 150 }}>
      <span style={{ whiteSpace: 'normal' }}>{label}</span>
      <input
        type="number"
        min={0}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        style={{ padding: '8px 10px', fontSize: 14 }}
        onChange={(e) => onChange(Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) / 100)}
      />
    </label>
  );
}

/** Ряд правила складу: поле ваги + назва + пояснення людською мовою. */
export function RuleRow({ title, value, onChange, children }: { title: string; value: number; onChange: (v: number) => void; children: ReactNode }) {
  return (
    <>
      <label className="field" style={{ width: 92 }}>
        <input
          type="number"
          min={0}
          step={5}
          value={Number.isFinite(value) ? value : ''}
          style={{ padding: '8px 10px', fontSize: 14 }}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Math.max(0, Math.round(Number(e.target.value))))}
        />
      </label>
      <div style={{ paddingTop: 4 }}>
        <b style={{ fontSize: 13.5 }}>{title}</b>
        <span className="hint" style={{ margin: '2px 0 0' }}>{children}</span>
      </div>
    </>
  );
}

/** Таблиця «ключ → бали» у вигляді ряду маленьких полів у заданому порядку. */
export function NumTable<K extends string>({ title, hint, order, labels, values, onChange }: {
  title: string; hint?: string; order: readonly K[]; labels: Record<K, string>; values: Record<K, number>; onChange: (next: Record<K, number>) => void;
}) {
  const max = Math.max(...order.map((k) => values[k]));
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <b>{title}</b>
        <span className="badge mute">max {max}</span>
      </div>
      {hint && <p className="hint" style={{ margin: '0 0 8px' }}>{hint}</p>}
      <div className="field-row" style={{ gap: 10 }}>
        {order.map((k) => (
          <NumInput key={k} label={labels[k]} value={values[k]} onChange={(v) => onChange({ ...values, [k]: v })} />
        ))}
      </div>
    </div>
  );
}

/** Заголовок картки з бейджем праворуч (max / стеля / кнопка). */
export function CardHead({ title, right }: { title: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
      <b>{title}</b>
      {right}
    </div>
  );
}
