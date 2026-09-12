// =========================================================
// pw-pvp: сітка турніру (bracket_matches) — генерація одинарної й
// подвійної елімінації, прогрес переможців (і програних — у double_elim)
// по раундах.
//
// Подвійна елімінація підтримується лише для кількості підтверджених
// учасників = степінь двійки (4, 8, 16, 32…) — без байів. Це прибирає
// всю комбінаторну складність байів у нижній сітці (де вони особливо
// заплутані), а для стандартних турнірів із заздалегідь відомою кількістю
// місць (напр. рівно 8 чи 16 команд) це і є типовий сценарій. Бракет-резет
// у гранд-фіналі (друга гра, якщо нижня сітка перемагає) НЕ реалізовано —
// гранд-фінал єдиний, переможець вирішується одразу.
// =========================================================

import { supabase } from '../app/supabaseClient';
import type { BracketMatch, BracketSide } from './types';
import { setTournamentStatus } from './tournaments';
import { createRng } from './balance';

interface BracketRow {
  id: string;
  tournament_id: string;
  bracket_side: BracketSide;
  round: number;
  slot: number;
  format: string;
  participant1_id: string | null;
  participant2_id: string | null;
  winner_id: string | null;
  score: string | null;
  next_match_id: string | null;
  next_match_slot: 1 | 2 | null;
  loser_next_match_id: string | null;
  loser_next_match_slot: 1 | 2 | null;
}

const fromRow = (r: BracketRow): BracketMatch => ({
  id: r.id,
  tournamentId: r.tournament_id,
  bracketSide: r.bracket_side,
  round: r.round,
  slot: r.slot,
  format: r.format,
  participant1Id: r.participant1_id,
  participant2Id: r.participant2_id,
  winnerId: r.winner_id,
  score: r.score,
  nextMatchId: r.next_match_id,
  nextMatchSlot: r.next_match_slot,
  loserNextMatchId: r.loser_next_match_id,
  loserNextMatchSlot: r.loser_next_match_slot,
});

export async function fetchBracket(tournamentId: string): Promise<BracketMatch[]> {
  const { data, error } = await supabase
    .from('bracket_matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('round', { ascending: true })
    .order('slot', { ascending: true });
  if (error) throw error;
  return (data as BracketRow[]).map(fromRow);
}

/** Матч, що визначає чемпіона турніру — для double_elim це гранд-фінал
 * (bracket_side='final'), для single_elim — найвищий round у winners-сітці
 * (bracket_side='third_place' сюди не потрапляє, він не про 1-ше місце). */
function pickDecisiveMatch(matches: BracketMatch[]): BracketMatch | undefined {
  const grandFinal = matches.find((m) => m.bracketSide === 'final');
  if (grandFinal) return grandFinal;
  const winners = matches.filter((m) => m.bracketSide === 'winners');
  if (!winners.length) return undefined;
  const maxRound = Math.max(...winners.map((m) => m.round));
  return winners.find((m) => m.round === maxRound);
}

/** Переможець турніру — для головної/серій. */
export async function fetchChampion(tournamentId: string): Promise<string | null> {
  const matches = await fetchBracket(tournamentId);
  const decisive = pickDecisiveMatch(matches);
  if (!decisive?.winnerId) return null;
  const { data } = await supabase.from('registrations').select('nickname').eq('id', decisive.winnerId).single();
  return (data as { nickname: string } | null)?.nickname ?? null;
}

export interface Podium {
  first: string;
  second: string | null;
  third: string | null;
  /** Склади згенерованих команд балансного фул-рандому (kind='team') — ніки
   * гравців з player-рядків за team_registration_id; null для звичайних
   * заявок (соло або готова команда). Головна зараховує перемогу кожному. */
  members: { first: string[] | null; second: string[] | null; third: string[] | null };
}

/** Топ-3 турніру — для п'єдесталу на Головній. 2-ге місце — програний
 * вирішального матчу; 3-тє — переможець матчу bracket_side='third_place',
 * якщо адмін вмикав цю опцію (single_elim), інакше null. */
export async function fetchPodium(tournamentId: string): Promise<Podium | null> {
  const matches = await fetchBracket(tournamentId);
  const decisive = pickDecisiveMatch(matches);
  if (!decisive?.winnerId) return null;

  const firstId = decisive.winnerId;
  const secondId = decisive.participant1Id === firstId ? decisive.participant2Id : decisive.participant1Id;
  const thirdId = matches.find((m) => m.bracketSide === 'third_place')?.winnerId ?? null;

  const ids = [firstId, secondId, thirdId].filter((id): id is string => !!id);
  // select('*'), а не перелік колонок: до застосування міграції 0017 колонки
  // kind ще немає, а явний select з нею — це 400 і зламана головна.
  const { data, error } = await supabase.from('registrations').select('*').in('id', ids);
  if (error) throw error;
  const rows = data as { id: string; nickname: string; kind?: 'player' | 'team' | null }[];
  const nickOf = (id: string | null) => (id ? (rows.find((r) => r.id === id)?.nickname ?? null) : null);

  const first = nickOf(firstId);
  if (!first) return null;

  // Склади team-рядків — з player-рядків (member_nicknames — лише кеш, застаріває при перейменуванні).
  const teamIds = rows.filter((r) => r.kind === 'team').map((r) => r.id);
  const membersOf = new Map<string, string[]>();
  if (teamIds.length) {
    const { data: mData, error: mErr } = await supabase
      .from('registrations')
      .select('nickname, team_registration_id')
      .in('team_registration_id', teamIds)
      .order('created_at', { ascending: true });
    if (mErr) throw mErr;
    for (const m of mData as { nickname: string; team_registration_id: string }[]) {
      const list = membersOf.get(m.team_registration_id) ?? [];
      list.push(m.nickname);
      membersOf.set(m.team_registration_id, list);
    }
  }
  const membersFor = (id: string | null) => (id && membersOf.has(id) ? membersOf.get(id)! : null);

  return {
    first,
    second: nickOf(secondId),
    third: nickOf(thirdId),
    members: { first: membersFor(firstId), second: membersFor(secondId), third: membersFor(thirdId) },
  };
}

/** Тасування Фішера–Єйтса; з seed — детерміноване (той самий seed + той самий
 * відсортований список id → той самий посів), без seed — Math.random, як і було. */
function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function seededOrder(ids: string[], seed?: string): string[] {
  if (!seed) return shuffle(ids);
  return shuffle(ids.slice().sort(), createRng(seed + ':bracket'));
}

/** Видаляє сітку (усі bracket_matches турніру) і скидає bracket_size. Для
 * повторної генерації сама генерація і так видаляє стару сітку — це для
 * кнопки «Видалити сітку» в адмінці (напр. щоб переформувати команди). */
export async function deleteBracket(tournamentId: string): Promise<void> {
  const { error } = await supabase.from('bracket_matches').delete().eq('tournament_id', tournamentId);
  if (error) throw error;
  const { error: tErr } = await supabase.from('tournaments').update({ bracket_size: null }).eq('id', tournamentId);
  if (tErr) throw tErr;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** true, якщо в сітці вже є хоч один зафіксований результат СПРАВЖНЬОГО
 * (двосторонього) матчу — після цього решафл заборонений. Бай-матчі (лише
 * один учасник) отримують winner_id автоматично одразу при генерації — це
 * НЕ рахується "результатом", інакше решафл блокувався б одразу ж. */
export async function bracketHasResults(tournamentId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('bracket_matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .not('winner_id', 'is', null)
    .not('participant1_id', 'is', null)
    .not('participant2_id', 'is', null);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/** Генерує (або перегенеровує — стара сітка видаляється) одинарну елімінацію:
 * рандомний шафл підтверджених учасників, бай розподілено по перших матчах
 * раунду 1 (не скупчено в одному), бай-матчі одразу резолвляться каскадом.
 * thirdPlaceMatch=true (і рівно 2 півфіналісти-програні) додає окремий матч
 * bracket_side='third_place' — програні півфіналу потрапляють туди так само,
 * як програні прогресують у losers-сітку double_elim (через loser_next_match_id). */
/** Формати матчів за раундами (`${bracket_side}:${round}` → 'bo3'), щоб решафл
 * не скидав уже виставлені BO3/BO5 на BO1. */
export type FormatByRound = Record<string, string>;

/** Формати поточної сітки за раундами — для решафлу. Береться найпоширеніший
 * формат раунду (адмін зазвичай ставить його всім матчам раунду). */
export function formatsByRound(matches: BracketMatch[]): FormatByRound {
  const counts = new Map<string, Map<string, number>>();
  for (const m of matches) {
    const key = `${m.bracketSide}:${m.round}`;
    const c = counts.get(key) ?? new Map<string, number>();
    c.set(m.format, (c.get(m.format) ?? 0) + 1);
    counts.set(key, c);
  }
  const out: FormatByRound = {};
  for (const [key, c] of counts) out[key] = Array.from(c.entries()).sort((a, b) => b[1] - a[1])[0][0];
  return out;
}

export async function generateSingleEliminationBracket(tournamentId: string, confirmedRegistrationIds: string[], thirdPlaceMatch = false, seed?: string, formats: FormatByRound = {}): Promise<void> {
  if (confirmedRegistrationIds.length < 2) throw new Error('Потрібно щонайменше 2 підтверджені учасники.');

  await supabase.from('bracket_matches').delete().eq('tournament_id', tournamentId);

  const bracketSize = nextPow2(confirmedRegistrationIds.length);
  const rounds = Math.log2(bracketSize);
  const shuffled = seededOrder(confirmedRegistrationIds, seed);
  const byes = bracketSize - shuffled.length;

  await supabase.from('tournaments').update({ bracket_size: bracketSize, ...(seed ? { bracket_seed: seed } : {}) }).eq('id', tournamentId);

  // id для кожного матчу генеруємо заздалегідь — потрібні для взаємних next_match_id
  const idsByRound: string[][] = [];
  for (let r = 1; r <= rounds; r++) {
    const count = bracketSize / 2 ** r;
    idsByRound.push(Array.from({ length: count }, () => crypto.randomUUID()));
  }
  // Півфінальний раунд (той, що безпосередньо перед фіналом) завжди має рівно
  // 2 матчі, незалежно від розміру сітки — фінал завжди 1 матч на 2 слоти.
  const thirdPlaceId = thirdPlaceMatch && rounds >= 2 ? crypto.randomUUID() : null;

  const queue = [...shuffled];
  const rows: Record<string, unknown>[] = [];
  for (let r = 1; r <= rounds; r++) {
    const ids = idsByRound[r - 1];
    const isSemifinal = thirdPlaceId !== null && r === rounds - 1;
    for (let s = 0; s < ids.length; s++) {
      const hasNext = r < rounds;
      let p1: string | null = null;
      let p2: string | null = null;
      if (r === 1) {
        p1 = queue.shift() ?? null;
        p2 = s < byes ? null : queue.shift() ?? null;
      }
      rows.push({
        id: ids[s],
        tournament_id: tournamentId,
        bracket_side: 'winners',
        round: r,
        slot: s,
        format: formats[`winners:${r}`] ?? 'bo1',
        participant1_id: p1,
        participant2_id: p2,
        winner_id: null,
        next_match_id: hasNext ? idsByRound[r][Math.floor(s / 2)] : null,
        next_match_slot: hasNext ? (s % 2) + 1 : null,
        loser_next_match_id: isSemifinal ? thirdPlaceId : null,
        loser_next_match_slot: isSemifinal ? ((s % 2) + 1) : null,
      });
    }
  }
  if (thirdPlaceId) {
    rows.push({
      id: thirdPlaceId,
      tournament_id: tournamentId,
      bracket_side: 'third_place',
      round: rounds,
      slot: 0,
      format: formats[`third_place:${rounds}`] ?? 'bo1',
      participant1_id: null,
      participant2_id: null,
      winner_id: null,
      next_match_id: null,
      next_match_slot: null,
      loser_next_match_id: null,
      loser_next_match_slot: null,
    });
  }

  const { error } = await supabase.from('bracket_matches').insert(rows);
  if (error) throw error;

  // Резолвимо бай-матчі (рівно один учасник → одразу переможець) — ЛИШЕ
  // в раунді 1: бай виникає тільки там за побудовою. Матч раунду 2+ з
  // одним заповненим слотом — це НЕ бай, а нормальний матч, що чекає на
  // результат сусідньої гілки; його не можна каскадно "дорішувати", інакше
  // випадковий гравець з бай-ланцюжка оголошується переможцем без гри.
  const round1 = await fetchBracket(tournamentId);
  for (const m of round1.filter((x) => x.round === 1)) {
    const only = m.participant1Id && !m.participant2Id ? m.participant1Id : !m.participant1Id && m.participant2Id ? m.participant2Id : null;
    if (only) await setMatchWinner(m.id, only);
  }
}

/** Мінімальна кількість підтверджених учасників для double_elim (степінь двійки). */
export function isPowerOfTwo(n: number): boolean {
  return n >= 4 && Number.isInteger(Math.log2(n));
}

/** Подвійна елімінація: рандомний шафл, лише для n = степінь двійки (без байів).
 * Верхня сітка (winners) — як одинарна елімінація. Кожен програш у winners
 * "падає" в losers через loser_next_match_id/slot. Нижня сітка чергує раунди
 * "спарувати програних між собою" (непарний j) і "переможці losers vs нові
 * програші з winners" (парний j) — класична схема на 2k-2 раундів losers
 * (k = log2(n)). Останній раунд losers дає чемпіона нижньої сітки, який
 * зустрічається з чемпіоном winners у гранд-фіналі (без бракет-резету).
 */
export async function generateDoubleEliminationBracket(tournamentId: string, confirmedRegistrationIds: string[], seed?: string, formats: FormatByRound = {}): Promise<void> {
  const n = confirmedRegistrationIds.length;
  if (!isPowerOfTwo(n)) {
    throw new Error(`Подвійна елімінація підтримує лише кількість учасників = степінь двійки (4, 8, 16, 32…), без байів. Зараз підтверджено: ${n}.`);
  }

  await supabase.from('bracket_matches').delete().eq('tournament_id', tournamentId);

  const k = Math.log2(n);
  const shuffled = seededOrder(confirmedRegistrationIds, seed);

  await supabase.from('tournaments').update({ bracket_size: n, ...(seed ? { bracket_seed: seed } : {}) }).eq('id', tournamentId);

  const wbIds: string[][] = [];
  for (let r = 1; r <= k; r++) wbIds.push(Array.from({ length: n / 2 ** r }, () => crypto.randomUUID()));

  const lbRoundsCount = 2 * k - 2;
  const lbIds: string[][] = [];
  for (let j = 1; j <= lbRoundsCount; j++) {
    const t = Math.ceil(j / 2);
    lbIds.push(Array.from({ length: n / 2 ** (t + 1) }, () => crypto.randomUUID()));
  }
  const finalId = crypto.randomUUID();

  const rows: Record<string, unknown>[] = [];

  // Верхня сітка (winners)
  for (let r = 1; r <= k; r++) {
    const ids = wbIds[r - 1];
    for (let s = 0; s < ids.length; s++) {
      let loserNextId: string | null = null;
      let loserNextSlot: 1 | 2 | null = null;
      if (r === 1) {
        loserNextId = lbIds[0][Math.floor(s / 2)];
        loserNextSlot = ((s % 2) + 1) as 1 | 2;
      } else if (r < k) {
        loserNextId = lbIds[2 * (r - 1) - 1][s];
        loserNextSlot = 2;
      } else {
        loserNextId = lbIds[lbRoundsCount - 1][0];
        loserNextSlot = 2;
      }
      rows.push({
        id: ids[s],
        tournament_id: tournamentId,
        bracket_side: 'winners',
        round: r,
        slot: s,
        format: formats[`winners:${r}`] ?? 'bo1',
        participant1_id: r === 1 ? shuffled[2 * s] : null,
        participant2_id: r === 1 ? shuffled[2 * s + 1] : null,
        winner_id: null,
        next_match_id: r < k ? wbIds[r][Math.floor(s / 2)] : finalId,
        next_match_slot: r < k ? (s % 2) + 1 : 1,
        loser_next_match_id: loserNextId,
        loser_next_match_slot: loserNextSlot,
      });
    }
  }

  // Нижня сітка (losers)
  for (let j = 1; j <= lbRoundsCount; j++) {
    const ids = lbIds[j - 1];
    const odd = j % 2 === 1;
    for (let s = 0; s < ids.length; s++) {
      let nextId: string | null;
      let nextSlot: 1 | 2;
      if (odd) {
        nextId = lbIds[j][s]; // раунд j+1 (парний) — той самий індекс s
        nextSlot = 1;
      } else if (j === lbRoundsCount) {
        nextId = finalId;
        nextSlot = 2;
      } else {
        nextId = lbIds[j][Math.floor(s / 2)]; // раунд j+1 (непарний) — попарно
        nextSlot = ((s % 2) + 1) as 1 | 2;
      }
      rows.push({
        id: ids[s],
        tournament_id: tournamentId,
        bracket_side: 'losers',
        round: j,
        slot: s,
        format: formats[`losers:${j}`] ?? 'bo1',
        participant1_id: null,
        participant2_id: null,
        winner_id: null,
        next_match_id: nextId,
        next_match_slot: nextSlot,
        loser_next_match_id: null,
        loser_next_match_slot: null,
      });
    }
  }

  // Гранд-фінал
  rows.push({
    id: finalId,
    tournament_id: tournamentId,
    bracket_side: 'final',
    round: 1,
    slot: 0,
    format: formats['final:1'] ?? 'bo3',
    participant1_id: null,
    participant2_id: null,
    winner_id: null,
    next_match_id: null,
    next_match_slot: null,
    loser_next_match_id: null,
    loser_next_match_slot: null,
  });

  const { error } = await supabase.from('bracket_matches').insert(rows);
  if (error) throw error;
  // n — точна степінь двійки, тож жодних байів немає: усі матчі раунду 1
  // мають обох учасників і чекають на реальну гру, каскадне резолвлення
  // (як у одинарній елімінації) тут не потрібне.
}

export async function setMatchFormat(matchId: string, format: string): Promise<void> {
  const { error } = await supabase.from('bracket_matches').update({ format }).eq('id', matchId);
  if (error) throw error;
}

/** Проставляє переможця (+ рахунок серії, напр. "2-1") і просуває його у
 * next_match_id/slot (а програного — у loser_next_match_id/slot, якщо є,
 * тобто в нижню сітку double_elim). Якщо переможця міняють заднім числом,
 * а наступний матч уже теж має результат — далі по сітці нічого каскадно
 * не скидається, адміну треба поправити вручну. */
export async function setMatchWinner(matchId: string, winnerId: string | null, score?: string | null): Promise<void> {
  const { data, error } = await supabase.from('bracket_matches').select('*').eq('id', matchId).single();
  if (error) throw error;
  const m = fromRow(data as BracketRow);

  const { error: updErr } = await supabase.from('bracket_matches').update({ winner_id: winnerId, score: score ?? null }).eq('id', matchId);
  if (updErr) throw updErr;

  // Скидання/зміна переможця: прибрати старого переможця (і старого
  // програвшого) з наступних матчів — інакше там лишається учасник, якого
  // там уже не мало б бути, і по ньому можна зафіксувати результат.
  if (m.winnerId && m.winnerId !== winnerId) {
    if (m.nextMatchId && m.nextMatchSlot) {
      const field = m.nextMatchSlot === 1 ? 'participant1_id' : 'participant2_id';
      const { error: clrErr } = await supabase.from('bracket_matches').update({ [field]: null }).eq('id', m.nextMatchId);
      if (clrErr) throw clrErr;
    }
    if (m.loserNextMatchId && m.loserNextMatchSlot) {
      const field = m.loserNextMatchSlot === 1 ? 'participant1_id' : 'participant2_id';
      const { error: clrErr } = await supabase.from('bracket_matches').update({ [field]: null }).eq('id', m.loserNextMatchId);
      if (clrErr) throw clrErr;
    }
  }

  if (winnerId && m.nextMatchId && m.nextMatchSlot) {
    const field = m.nextMatchSlot === 1 ? 'participant1_id' : 'participant2_id';
    const { error: nextErr } = await supabase.from('bracket_matches').update({ [field]: winnerId }).eq('id', m.nextMatchId);
    if (nextErr) throw nextErr;
  }

  if (winnerId && m.loserNextMatchId && m.loserNextMatchSlot && m.participant1Id && m.participant2Id) {
    const loserId = m.participant1Id === winnerId ? m.participant2Id : m.participant1Id;
    const field = m.loserNextMatchSlot === 1 ? 'participant1_id' : 'participant2_id';
    const { error: loserErr } = await supabase.from('bracket_matches').update({ [field]: loserId }).eq('id', m.loserNextMatchId);
    if (loserErr) throw loserErr;
  }

  // Щойно у вирішальному матчі (гранд-фінал / фінал winners-сітки) з'явився
  // переможець — турнір сам стає "Завершено", без ручного перемикання
  // статусу адміном; скинули результат вирішального — назад у "Триває".
  const all = await fetchBracket(m.tournamentId);
  const decisive = pickDecisiveMatch(all);
  if (decisive?.id === matchId) {
    if (winnerId) await setTournamentStatus(m.tournamentId, 'completed');
    else if (m.winnerId) await setTournamentStatus(m.tournamentId, 'in_progress');
  } else if (winnerId && decisive?.winnerId) {
    await setTournamentStatus(m.tournamentId, 'completed');
  }
}
