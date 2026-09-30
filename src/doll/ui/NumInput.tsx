// =========================================================
// ЛЯЛЬКА — числове поле з чернеткою вводу (рівень, атрибути, титули). Поле
// КЕРОВАНЕ: значення завжди з документа, а те, що набирають, живе лише поки
// поле у фокусі — щоб можна було стерти число й набрати нове, не отримавши
// «5» посередині. Кожне валідне натискання одразу комітиться (onCommit).
// =========================================================

import { useEffect, useRef, useState } from 'react';

export function NumInput({
  id, value, min, max, disabled, onCommit, label, className,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit(n: number): void;
  label?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  return (
    <input
      id={id}
      className={className}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      value={draft}
      disabled={disabled}
      aria-label={label}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const n = Number(raw);
        if (raw.trim() !== '' && Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => {
        focused.current = false;
        setDraft(String(value));
      }}
    />
  );
}

export default NumInput;
