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

/** Переможець турніру — для double_elim це гранд-фінал (bracket_side='final'),
 * для single_elim — найвищий round у winners-сітці. Для головної/серій. */
export async function fetchChampion(tournamentId: string): Promise<string | null> {
  const matches = await fetchBracket(tournamentId);
  const grandFinal = matches.find((m) => m.bracketSide === 'final');
  const decisive = grandFinal ?? (() => {
    const winners = matches.filter((m) => m.bracketSide === 'winners');
    if (!winners.length) return undefined;
    const maxRound = Math.max(...winners.map((m) => m.round));
    return winners.find((m) => m.round === maxRound);
  })();
  if (!decisive?.winnerId) return null;
  const { data } = await supabase.from('registrations').select('nickname').eq('id', decisive.winnerId).single();
  return (data as { nickname: string } | null)?.nickname ?? null;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
export async function generateSingleEliminationBracket(tournamentId: string, confirmedRegistrationIds: string[], thirdPlaceMatch = false): Promise<void> {
  if (confirmedRegistrationIds.length < 2) throw new Error('Потрібно щонайменше 2 підтверджені учасники.');

  await supabase.from('bracket_matches').delete().eq('tournament_id', tournamentId);

  const bracketSize = nextPow2(confirmedRegistrationIds.length);
  const rounds = Math.log2(bracketSize);
  const shuffled = shuffle(confirmedRegistrationIds);
  const byes = bracketSize - shuffled.length;

  await supabase.from('tournaments').update({ bracket_size: bracketSize }).eq('id', tournamentId);

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
        format: 'bo1',
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
      format: 'bo1',
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
export async function generateDoubleEliminationBracket(tournamentId: string, confirmedRegistrationIds: string[]): Promise<void> {
  const n = confirmedRegistrationIds.length;
  if (!isPowerOfTwo(n)) {
    throw new Error(`Подвійна елімінація підтримує лише кількість учасників = степінь двійки (4, 8, 16, 32…), без байів. Зараз підтверджено: ${n}.`);
  }

  await supabase.from('bracket_matches').delete().eq('tournament_id', tournamentId);

  const k = Math.log2(n);
  const shuffled = shuffle(confirmedRegistrationIds);

  await supabase.from('tournaments').update({ bracket_size: n }).eq('id', tournamentId);

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
        format: 'bo1',
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
        format: 'bo1',
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
    format: 'bo3',
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
}
