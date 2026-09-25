// =========================================================
// pw-pvp: балансний фул-рандом — зв'язок чистого алгоритму (balance.ts)
// із Supabase: підготовка гравців із заявок, запис сформованих команд
// (RPC apply_balanced_teams), заміни (RPC substitute_team_member).
// =========================================================

import { supabase } from '../app/supabaseClient';
import type { BalanceStats, Registration, Tier, Tournament } from './types';
import { isBalancedRandom } from './types';
import { currentRulesVersion, computeGearScore, dollGearScoreWith, playerProfile, ratingBonus, rulesFor, tierFor } from './gearRules';
import { evaluateTeams, teamStrengthFromSnapshot, type BalancePlayer, type FormTeamsResult } from './balance';
import { resolveBuffOptions, type BuffOptions } from './ruleFlags';
import { ratingOf, type PlayerRating } from './ratings';

/** Версія правил, якою рахується цей турнір: зафіксована при формуванні,
 * до формування — поточна. */
export function rulesVersionFor(t: Pick<Tournament, 'balanceRulesVersion'>): string {
  return t.balanceRulesVersion ?? currentRulesVersion();
}

/** Бафи для жеребки цього турніру: правила турніру (рядки «бафи від пачки»,
 * «КХ») поверх КХ за замовчуванням із його версії шкали. */
export function buffOptionsFor(t: Pick<Tournament, 'balanceRulesVersion' | 'ruleFlags'>): BuffOptions {
  return resolveBuffOptions(rulesFor(rulesVersionFor(t)).balance, t.ruleFlags);
}

/** Сила команди зі знімка турніру (гір · бафи · сила) — одна функція для
 * публічної сторінки, бейджа модалки, звіту балансу й підбору заміни; без
 * знімка (команди ще не сформовані) — сила = гір. */
export function teamStrengthFor(
  t: Pick<Tournament, 'balanceRulesVersion' | 'balanceStats'>, members: BalanceStats['teams'][number]['members'],
): { total: number; buff: number; strength: number } {
  const rules = rulesFor(rulesVersionFor(t)).balance;
  const stats = t.balanceStats;
  if (!stats) { const total = members.reduce((s, m) => s + m.score, 0); return { total, buff: 0, strength: total }; }
  return teamStrengthFromSnapshot(members, stats, rules);
}

/** Складові скору гравця: гір (анкета) + ручна корекція адміна + бонус за Ело. */
export interface ScoreBreakdown {
  gear: number;
  adjust: number;
  rating: number;
  total: number;
}

/** teamSize — розмір команди турніру (від нього залежать бали за клас). */
export function scoreBreakdown(r: Registration, version: string, ratings: Map<string, PlayerRating> | undefined, teamSize: number | null | undefined): ScoreBreakdown | null {
  if (!r.gear) return null;
  // Режим «увімкнено»: заявка персонажем рахується з ляльки (якщо для класу є еталон).
  const rules = rulesFor(version);
  const fromDoll = rules.dollScore.mode === 'on' ? dollScoreOf(r, version, teamSize) : null;
  const gear = fromDoll ?? computeGearScore(r.gear, version, teamSize);
  const adjust = r.scoreAdjust ?? 0;
  const rating = ratings ? ratingBonus(ratingOf(ratings, r.nickname)?.rating, rulesFor(version)) : 0;
  return { gear, adjust, rating, total: gear + adjust + rating };
}

/** Скор спорядження з ляльки (атака й живучість відносно еталона класу) —
 * для заявок персонажем; null — немає сили в заявці або еталона для класу. */
export function dollScoreOf(r: Registration, version: string, teamSize: number | null | undefined): number | null {
  if (!r.gear || !r.dollPower) return null;
  return dollGearScoreWith(r.gear, r.dollPower, rulesFor(version), teamSize);
}

/** Скор гравця для жеребки/відображення в адмінці (з корекцією і рейтингом). */
export function playerScore(r: Registration, version: string, ratings: Map<string, PlayerRating> | undefined, teamSize: number | null | undefined): number | null {
  return scoreBreakdown(r, version, ratings, teamSize)?.total ?? null;
}

/** Підтверджені гравці з анкетою → вхід алгоритму (score за версією правил турніру,
 * з ручною корекцією і бонусом за рейтинг, якщо рейтинги передано). */
export function playersForBalance(t: Tournament, regs: Registration[], ratings?: Map<string, PlayerRating>): BalancePlayer[] {
  const version = rulesVersionFor(t);
  const comp = rulesFor(version).balance.composition;
  return regs
    .filter((r) => r.kind === 'player' && r.status === 'confirmed' && r.gear)
    .map((r) => ({
      id: r.id, nickname: r.nickname, cls: r.gear!.charClass, score: playerScore(r, version, ratings, t.teamSize)!, createdAt: r.createdAt,
      ...playerProfile(r.gear!.charClass, r.gear!.build, comp),
    }));
}

/** Скори на момент жеребки (зі знімка balance_stats) за id заявки. Після
 * формування показуємо саме їх: Ело дрейфує з кожним внесеним результатом,
 * а баланс робився за тодішніми числами. Гравців, яких у знімку немає
 * (заміни з резерву), рахуємо наживо. */
export function frozenScores(t: Pick<Tournament, 'balanceStats'>): Map<string, number> {
  const m = new Map<string, number>();
  for (const team of t.balanceStats?.teams ?? []) for (const p of team.members) m.set(p.registrationId, p.score);
  return m;
}

/** Заявки-гравці без анкети (старі або зламані) — до генерації не допускаються. */
export function confirmedWithoutGear(regs: Registration[]): Registration[] {
  return regs.filter((r) => r.kind === 'player' && r.status === 'confirmed' && !r.gear);
}

/** Склад команди — з player-рядків за FK, не з member_nicknames (той лише кеш для сітки). */
export function teamMembers(team: Registration, regs: Registration[]): Registration[] {
  return regs.filter((r) => r.kind === 'player' && r.teamRegistrationId === team.id);
}

export function teamRows(t: Tournament, regs: Registration[]): Registration[] {
  if (!isBalancedRandom(t)) return [];
  return regs.filter((r) => r.kind === 'team').sort((a, b) => a.nickname.localeCompare(b.nickname, 'uk', { numeric: true }));
}

/** Розклад, який адмін затверджує: команди (можливо після ручних свопів) з назвами + резерв. */
export interface TeamsDraft {
  teams: { name: string; members: BalancePlayer[] }[];
  reserve: BalancePlayer[];
  result: FormTeamsResult;
}

export function buildBalanceStats(t: Tournament, draft: TeamsDraft): BalanceStats {
  const version = rulesVersionFor(t);
  const rules = rulesFor(version).balance;
  const snap = draft.result.snapshot;
  // ті самі бафи й розмір команди, що при формуванні — інакше penalty у знімку не збігся б із чернеткою
  const ev = evaluateTeams(draft.teams.map((x) => x.members), rules, {
    buffs: snap.buffs ? { source: snap.buffs.source, kx: snap.buffs.kx } : undefined,
    teamSize: snap.teamSize,
  });
  return {
    ...snap,
    formedAt: new Date().toISOString(),
    penalty: ev.penalty,
    bestPenalty: draft.result.bestPenalty,
    candidates: draft.result.candidates,
    teams: draft.teams.map((team, i) => ({
      name: team.name,
      total: ev.stats[i].total,
      members: team.members.map((p) => ({ registrationId: p.id, nickname: p.nickname, charClass: p.cls, score: p.score, tier: tierFor(p.score, version) })),
    })),
    reserve: draft.reserve.map((p) => ({ registrationId: p.id, nickname: p.nickname })),
    substitutions: [],
  };
}

/** Атомарно записує команди (RPC). dropBracket=true — якщо сітка вже є, але без
 * результатів, RPC видалить її сам (переформування). */
export async function applyBalancedTeams(t: Tournament, draft: TeamsDraft, opts: { dropBracket: boolean }): Promise<void> {
  const stats = buildBalanceStats(t, draft);
  const { error } = await supabase.rpc('apply_balanced_teams', {
    p_tournament_id: t.id,
    p_seed: draft.result.snapshot.seed,
    p_rules_version: draft.result.snapshot.rulesVersion,
    p_stats: stats,
    p_teams: draft.teams.map((team) => ({ name: team.name, member_ids: team.members.map((p) => p.id) })),
    p_drop_bracket: opts.dropBracket,
  });
  if (error) throw error;
}

/** Розформувати команди (сітка без результатів видаляється разом). */
export async function clearBalancedTeams(tournamentId: string): Promise<void> {
  const { error } = await supabase.rpc('apply_balanced_teams', {
    p_tournament_id: tournamentId,
    p_seed: null,
    p_rules_version: null,
    p_stats: null,
    p_teams: [],
    p_drop_bracket: true,
  });
  if (error) throw error;
}

/** Заміна гравця у сформованій команді; inId = null — прибрати без заміни.
 * Вибулий отримує status='rejected' (в UI — «вибув»). Скор і tier заміни
 * (на момент заміни) йдуть у знімок balance_stats — RPC (0022) оновлює склад
 * і суму команди, щоб публічна сума не лишалась старою. */
export async function substituteTeamMember(
  teamId: string, outId: string, inId: string | null, reason: 'no_show' | 'disqualified' | 'other' = 'no_show',
  inScore: number | null = null, inTier: Tier | null = null,
): Promise<void> {
  const { error } = await supabase.rpc('substitute_team_member', {
    p_team_id: teamId,
    p_out_id: outId,
    p_in_id: inId,
    p_reason: reason,
    p_in_score: inId ? inScore : null,
    p_in_tier: inId ? inTier : null,
  });
  if (error) throw error;
}
