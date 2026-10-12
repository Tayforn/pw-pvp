// =========================================================
// Компактний запис великих сум юанів (як у гільдії, thunder-info
// src/app/formatPrice.ts): до 999 — як є, далі к (тис.) / кк (млн.) /
// ч (десятки млн.) — саме ці пороги домовлені для Thunder
// (25.6ч = 256 000 000), а не стандартні "млн/млрд".
// =========================================================

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// threshold — поріг переходу на цей розряд; div — на що ділити для запису в ньому.
// Йдуть від старшого до молодшого, бо округлення молодшого розряду може "переповнити"
// його (999 999 → 1000.0к) — тоді потрібно піднятись на розряд вище й порахувати заново.
const TIERS = [
  { threshold: 10_000_000, div: 10_000_000, suffix: 'ч' },
  { threshold: 1_000_000, div: 1_000_000, suffix: 'кк' },
  { threshold: 1_000, div: 1_000, suffix: 'к' },
];

export function formatPrice(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs < 1_000) return sign + String(abs);

  let tierIndex = TIERS.findIndex((t) => abs >= t.threshold);
  if (tierIndex === -1) tierIndex = TIERS.length - 1;

  for (;;) {
    const tier = TIERS[tierIndex];
    const rounded = round1(abs / tier.div);
    if (tierIndex === 0) return sign + trimNumber(rounded) + tier.suffix;
    const biggerTier = TIERS[tierIndex - 1];
    if (rounded * tier.div < biggerTier.threshold) return sign + trimNumber(rounded) + tier.suffix;
    tierIndex -= 1; // округлення дотягнуло до наступного розряду — рахуємо в ньому
  }
}

/** Повний запис з розділювачами розрядів — для title/tooltip біля компактного формату. */
export function formatPriceExact(n: number): string {
  return n.toLocaleString('uk-UA');
}

/** Маска для текстового поля вводу суми: лишає тільки цифри, групує по 3. */
export function formatPriceInputMask(value: string | number): string {
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  return Number(digits).toLocaleString('uk-UA');
}

export function parsePriceInput(value: string): number {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}
