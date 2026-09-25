// =========================================================
// ЛЯЛЬКА — дельти сету від Головного: ті самі «похідні числа» ядра
// (derivedNumbers) на ЗАПОВНЕНІЙ конфігурації сету (порожні слоти — з
// Головного). Бафи не входять — порівнюється лише спорядження.
// =========================================================

import { deriveIb } from '../core/buffs';
import { derivedNumbers, type DerivedNumbers } from '../core/derived';
import { CFG_MAIN, toDollState, type CharacterModel } from './hydrate';

export interface SetDelta {
  main: DerivedNumbers;
  set: DerivedNumbers;
  delta: DerivedNumbers; // set − main по кожному полю
}

export function setDelta(model: CharacterModel, setId: string): SetDelta {
  const mb = toDollState(model, CFG_MAIN);
  const sb = toDollState(model, setId, { fillFromMain: true });
  const main = derivedNumbers(mb, deriveIb(mb)); // у стані лише пасивки класу
  const set = derivedNumbers(sb, deriveIb(sb));
  const delta = {} as DerivedNumbers;
  for (const k of Object.keys(main) as Array<keyof DerivedNumbers>) delta[k] = set[k] - main[k];
  return { main, set, delta };
}
