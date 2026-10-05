// @types/node у проєкті немає; тестам сканера потрібне лише читання файлів з
// диска (PNG-фікстури і спрайти іконок), тож оголошуємо рівно це.
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function existsSync(path: string): boolean;
}
