// =========================================================
// ЛЯЛЬКА — опис вміння джина React-вузлами. Тексти Хелпера були HTML; у
// pw-pvp вони вже розібрані на сегменти (scripts/genie-data.ts →
// src/doll/data/genie/genie-text.json): текст із тоном, підстановка числа за
// рівнем вміння або розрив рядка. Тут сегменти лише перетворюються на
// span/br — жодного рядка розмітки (сторож noInnerHtml.test).
//
// Тони → класи .doll-gtext-*: label — підписи («Витрати енергії»), num —
// числа, genie — рядки «вплив сили/спритності», dark — темна сторона, warn —
// обмеження. Кольори тонів — у doll-modals.css на темній «ігровій поверхні»,
// бо це дані гри, як і кольори грейдів.
// =========================================================

import type { ReactNode } from 'react';
import { genieStat, type GenieSkillText } from '../../data/genieText';

/** Опис вміння на вибраному рівні (1 — перший). Сегмент без тону — звичайний текст. */
export function GenieText({ text, level }: { text: GenieSkillText; level: number }): ReactNode {
  const nodes: ReactNode[] = [];
  text.d.forEach((seg, i) => {
    if ('br' in seg) {
      nodes.push(<br key={i} />);
      return;
    }
    const value = 't' in seg ? seg.t : genieStat(text, seg.f, level - 1);
    nodes.push(seg.c ? <span key={i} className={'doll-gtext-' + seg.c}>{value}</span> : value);
  });
  return <div className="doll-gtext">{nodes}</div>;
}

export default GenieText;
