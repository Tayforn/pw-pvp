// =========================================================
// ЛЯЛЬКА — налаштування моба-суперника для перевірки урону. Порт панелі
// Opponent Хелпера у вікно: ЖС, рівень, атаки, міткість/ухилення, фіз. і
// стихійні захисти. Суперник — уподобання браузера (контекст зберігає його
// сам), у документ персонажа й у скор не йде. Числа показуються з
// розрядами, а поки поле у фокусі — як набрали.
// =========================================================

import { useState } from 'react';
import { DEFAULT_OPP, oppMagReductionPerc, oppReductionPerc } from '../../core/damage';
import type { OppMob } from '../../core/types';
import { useEditor } from '../EditorContext';
import { ModalShell } from './ModalShell';

type NumKey = Exclude<keyof OppMob, 'name'>;

const fmt = (n: number): string => n.toLocaleString('uk');

/** «23 977 103» / «1,5» → число; сміття → 0 (як у Хелпері). */
export function parseOppNum(s: string): number {
  const v = parseFloat(s.replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(v) ? v : 0;
}

function OppField({ label, value, onChange, className = '', maxLength }: { label: string; value: number; onChange(v: number): void; className?: string; maxLength?: number }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className={'doll-oppm-f ' + className}>
      <span className="doll-oppm-l">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        className="doll-oppm-in"
        maxLength={maxLength}
        value={text ?? fmt(value)}
        onFocus={() => setText(String(value))}
        onBlur={() => setText(null)}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseOppNum(e.target.value));
        }}
      />
    </label>
  );
}

const ATK: Array<[NumKey, string]> = [
  ['physAtkMin', 'Мін. фіз. атака'],
  ['physAtkMax', 'Макс. фіз. атака'],
  ['magAtkMin', 'Мін. маг. атака'],
  ['magAtkMax', 'Макс. маг. атака'],
  ['acc', 'Міткість'],
  ['eva', 'Ухилення'],
];
const DEF: Array<[NumKey, string]> = [
  ['physDef', 'Фіз. захист'],
  ['lw', 'Метал'],
  ['mo', 'Дерево'],
  ['dn', 'Вода'],
  ['vt', 'Вогонь'],
  ['sp', 'Земля'],
];

export function OpponentModal() {
  const api = useEditor();
  const opp = api.opponent;
  const set = (patch: Partial<OppMob>) => api.setOpponent({ ...api.opponent, ...patch });
  const close = () => api.closeModal();
  const lvl = api.doc.level;
  const field = ([key, label]: [NumKey, string]) => <OppField key={key} label={label} value={opp[key]} onChange={(v) => set({ [key]: v })} />;

  return (
    <ModalShell
      title="Суперник для перевірки урону"
      onClose={close}
      size="lg"
      className="doll-modal-opp"
      foot={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.setOpponent({ ...DEFAULT_OPP })}>
            Скинути до «{DEFAULT_OPP.name}»
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={close}>
            Готово
          </button>
        </>
      }
    >
      <input
        type="text"
        className="doll-oppm-name"
        value={opp.name}
        maxLength={40}
        aria-label="Назва суперника"
        onChange={(e) => set({ name: e.target.value })}
      />
      <div className="doll-oppm-top">
        <OppField label="ЖС" className="hp" value={opp.hp} onChange={(v) => set({ hp: v })} />
        <OppField label="Рівень" className="lvl" maxLength={3} value={opp.level} onChange={(v) => set({ level: v })} />
      </div>
      <div className="doll-oppm-cols">
        <div className="doll-oppm-col">
          <div className="doll-oppm-col-h">Атака</div>
          {ATK.map(field)}
        </div>
        <div className="doll-oppm-col">
          <div className="doll-oppm-col-h">Захист</div>
          {DEF.map(field)}
        </div>
      </div>
      <div className="doll-oppm-sum">
        Зрізає урон персонажа {lvl}-го рівня: фіз. −{oppReductionPerc(opp, 'phys', lvl).toFixed(1)}%, маг. (сер.) −{oppMagReductionPerc(opp, lvl).toFixed(1)}%
      </div>
      <div className="doll-bcfg-note">Суперник зберігається в цьому браузері й у скор не входить.</div>
    </ModalShell>
  );
}

export default OpponentModal;
