// «Бафи й склад»: числові поля — сіткою AdmFields (як у «Шкалі балів»): підписи
// переносяться повністю (без трикрапки), поля одного ряду в однакових клітинках,
// притиснуті донизу. Раніше «Топовий ДД — ві…», «Кандидатів (t…», «Вага ро…»
// обрізались, а «Дозволена підтримка…» переносилась і зсувала своє поле нижче.
// Стор чернетки — справжній (rulesDraftStore), версії з БД — заглушка.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_RULES_VERSION } from '../../../data/gearRules';
import { _resetRulesDraftForTests } from '../../../data/rulesDraftStore';

vi.mock('../../../app/supabaseClient', () => ({ supabase: {} }));
vi.mock('../../../data/rulesStore', () => ({
  useRules: () => ({ loaded: true, current: BUILTIN_RULES_VERSION }),
  saveRulesVersion: async () => BUILTIN_RULES_VERSION,
}));

const { default: TeamTab } = await import('../TeamTab');
const { AdmFields, NumInput, PctInput } = await import('../RulesEditor');

afterEach(() => _resetRulesDraftForTests());

/** Сітка AdmFields, у якій стоїть поле з цим підписом: її клас і підписи всіх її полів. */
function gridOf(html: string, label: string): { cls: string; labels: string[] } {
  const at = html.indexOf('<span>' + label + '</span>');
  expect(at, label).toBeGreaterThan(0);
  const start = html.lastIndexOf('<div class="adm-fields', at);
  const cls = /^<div class="([^"]+)"/.exec(html.slice(start))![1];
  // сітка закінчується там, де після останнього поля закривається її div
  const body = html.slice(start, html.indexOf('</label></div>', at) + '</label></div>'.length);
  const labels = [...body.matchAll(/<label class="field adm-f"><span>([^<]*)<\/span>/g)].map((m) => m[1]);
  return { cls, labels };
}

describe('поля адмінки (AdmFields)', () => {
  it('NumInput і PctInput — клітинка «field adm-f»: підпис повністю, без власної ширини й трикрапки', () => {
    const html = renderToStaticMarkup(
      <AdmFields wide>
        <NumInput label="Топовий ДД — від скору" value={250} onChange={() => {}} />
        <PctInput label="Дозволена підтримка топового ДД, % (команди 3+)" value={0.5} onChange={() => {}} />
      </AdmFields>,
    );
    expect(html).toBe(
      '<div class="adm-fields wide">' +
        '<label class="field adm-f"><span>Топовий ДД — від скору</span><input type="number" min="0" step="1" value="250"/></label>' +
        '<label class="field adm-f"><span>Дозволена підтримка топового ДД, % (команди 3+)</span><input type="number" min="0" max="100" step="5" value="50"/></label>' +
        '</div>',
    );
  });

  it('вкладка: жодного field-row з числовими полями, жодної трикрапки; ряди зі скрінів — в одній сітці', () => {
    const html = renderToStaticMarkup(<TeamTab />);
    expect(html).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(html).not.toMatch(/class="field adm-f" style=/);
    // лишився один field-row — селект положення для пар (одне широке поле без підпису)
    expect((html.match(/class="field-row"/g) || []).length).toBe(1);
    expect(gridOf(html, 'Топовий ДД — від скору')).toEqual({
      cls: 'adm-fields wide',
      labels: ['Топовий ДД — від скору', 'Дозволена підтримка топового ДД, % (команди 3+)'],
    });
    expect(gridOf(html, 'ε-коридор')).toEqual({ cls: 'adm-fields', labels: ['ε-коридор', 'Кандидатів (top-N)', 'Вага ролей', 'Профіль сили, %'] });
    expect(gridOf(html, 'КХ-бафи за замовчуванням')).toEqual({ cls: 'adm-fields wide', labels: ['КХ-бафи за замовчуванням', 'Стеля бафів одному гравцю, %'] });
    expect(gridOf(html, 'Команди по 2').labels).toEqual(['Команди по 2', 'Команди по 3', 'Команди по 4', 'Команди по 5+']);
    expect(gridOf(html, 'Отримувач').labels.slice(0, 3)).toEqual(['Отримувач', 'Його гір', 'Команди по']);
    for (const bad of ['NaN', 'undefined', 'Infinity', '[object']) expect(html).not.toContain(bad);
  });
});
