// «Шкала балів» → «Скор з ляльки»: картка рендериться з вбудованою версією і з
// еталонами; режим, еталони й приклад балів видно адміну.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { normalizeRules } from '../../../data/gearRules';

vi.mock('../../../app/useMe', () => ({ useMe: () => ({ me: null, loading: false, login: () => {}, logout: async () => {} }) }));

const { default: DollScoreCard } = await import('../DollScoreCard');
const visible = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('картка «Скор з ляльки»', () => {
  it('вбудована версія: вимкнено, еталонів нема, пропонує вхід', () => {
    const t = visible(renderToStaticMarkup(<DollScoreCard draft={normalizeRules({})} patch={() => {}} />));
    expect(t).toContain('Скор з ляльки');
    expect(t).toContain('не задано');
    expect(t).toContain('Увійти через Discord');
    expect(t).toContain('+17 до балів еталона'); // 50 × 0.7 × log2(1.4)
    expect(t).toContain('за те саме — +7');
  });

  it('еталон класу показано з атакою, живучістю й кнопкою «Прибрати»', () => {
    const draft = normalizeRules({ dollScore: { mode: 'shadow', refs: { archer: { off: 12345, def: 67890, base: 140, label: 'Тайфорн' } } } });
    const html = renderToStaticMarkup(<DollScoreCard draft={draft} patch={() => {}} />);
    const t = visible(html);
    expect(t).toContain('Тайфорн');
    expect(t).toContain('12345');
    expect(t).toContain('67890');
    expect(t).toContain('Прибрати');
    expect(html).toContain('value="140"');
    expect(html).toMatch(/<option value="shadow" selected/);
  });
});
