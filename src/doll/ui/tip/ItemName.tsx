// =========================================================
// ЛЯЛЬКА — назва речі кольором грейду (клас gx-N за полем tv, зірки перед
// назвою, «+N» заточки золотим). Заміна itemNameHtml Хелпера: той самий текст,
// але React-вузлом — назва з каталогу (а колись і з бази) ніколи не стає HTML.
// =========================================================

import type { Item } from '../../core/types';
import { itemDisplayName, itemGrade } from '../../model/tipModel';

/** Готова назва (зірки вже в тексті) + грейд + заточка — спільне для ItemName і ItemTip. */
export function GradeName({ name, grade, refine = 0, className }: { name: string; grade: number; refine?: number; className?: string }) {
  return (
    <span className={'doll-iname gx-' + (Number.isFinite(grade) ? grade : 0) + (className ? ' ' + className : '')}>
      {name}
      {refine > 0 && <span className="doll-tip-refn">{' +' + refine}</span>}
    </span>
  );
}

export function ItemName({ item, grade, cat = '', refine, className }: { item: Item; grade?: number; cat?: string; refine?: number; className?: string }) {
  const tier = grade ?? itemGrade(item, cat).tier;
  return <GradeName name={itemDisplayName(item, cat)} grade={tier} refine={refine} className={className} />;
}
