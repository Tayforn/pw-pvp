// «Учасники»: дія в рядку — компактна «✎ Змінити» в один рядок (довга
// «✎ Перейменувати / об'єднати» переносилась на два); повна назва дії — у
// підказці й aria-label. Колонка дії — auto, кнопка праворуч. Сам менеджер
// вантажить дані в ефектах, тож рендеримо чистий рядок; Supabase — заглушка.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../app/supabaseClient', () => ({ supabase: {} }));

const { default: ParticipantsManager, PARTICIPANT_COLS, ParticipantRow, RENAME_TITLE } = await import('../ParticipantsManager');

const stat = { nickname: 'XenuS', registrations: 7, wins: 2, second: 1, third: 0 };

describe('рядок учасника', () => {
  it('кнопка «✎ Змінити»: btn-sm, без переносу, праворуч; повна назва дії — у title і aria-label з ніком', () => {
    const html = renderToStaticMarkup(<ParticipantRow s={stat} rating={{ nickname: 'XenuS', rating: 1032.4, games: 3, wins: 2 }} onRename={() => {}} />);
    expect(RENAME_TITLE).toBe("Перейменувати або об'єднати з іншим учасником");
    const btn = /<button[^>]*>([^<]*)<\/button>/.exec(html);
    expect(btn).not.toBeNull();
    expect(btn![1]).toBe('✎ Змінити');
    expect(btn![0]).toContain('class="btn btn-ghost btn-sm"');
    expect(btn![0]).toMatch(/style="[^"]*white-space:nowrap[^"]*justify-self:end/);
    expect(btn![0]).toContain('title="Перейменувати або об&#x27;єднати з іншим учасником"');
    expect(btn![0]).toContain('aria-label="Перейменувати або об&#x27;єднати з іншим учасником: XenuS"');
    expect(html).not.toContain('Перейменувати / об');
    // решта рядка — як була: нік, заявки, Ело, призові
    expect(html).toContain('>XenuS</span>');
    expect(html).toContain('1032 · 3 гри');
    expect(html).toContain('🥇 2');
    expect(html).toContain('🥈 1');
  });

  it('рядок — subgrid спільної сітки; колонка дії — auto', () => {
    const html = renderToStaticMarkup(<ParticipantRow s={{ ...stat, wins: 0, second: 0 }} rating={undefined} onRename={() => {}} />);
    expect(html).toMatch(/^<div style="display:grid;grid-column:1 \/ -1;grid-template-columns:subgrid/);
    expect(PARTICIPANT_COLS.split(' ').pop()).toBe('auto');
    expect(html).toContain('>—</span>'); // без Ело й без місць
  });

  it('менеджер до завантаження — «Завантаження…» без винятків', () => {
    const html = renderToStaticMarkup(<ParticipantsManager />);
    expect(html).toContain('Завантаження…');
  });
});
