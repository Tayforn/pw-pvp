// =========================================================
// pw-pvp: балансний фул-рандом — зв'язок чистого алгоритму (balance.ts)
// із Supabase: підготовка гравців із заявок, запис сформованих команд
// (RPC apply_balanced_teams), заміни (RPC substitute_team_member).
// =========================================================

import { supabase } from '../app/supabaseClient';
import type { BalanceStats, Registration, Tournament } from './types';
import { isBalancedRandom } from './types';
import { currentRulesVersion, computeGearScore, rulesFor, tierFor } from './gearRules';
import { evaluateTeams, type BalancePlayer, type FormTeamsResult } from './balance';

/** Версія правил, якою рахується цей турнір: зафіксована при формуванні,
 * до формування — поточна. */
export function rulesVersionFor(t: Pick<Tournament, 'balanceRulesVersion'>): string {
  return t.balanceRulesVersion ?? currentRulesVersion();
}

/** Підтверджені гравці з анкетою → вхід алгоритму (score за версією правил турніру). */
export function playersForBalance(t: Tournament, regs: Registration[]): BalancePlayer[] {
  const version = rulesVersionFor(t);
  return regs
    .filter((r) => r.kind === 'player' && r.status === 'confirmed' && r.gear)
    .map((r) => ({ id: r.id, nickname: r.nickname, cls: r.gear!.charClass, score: computeGearScore(r.gear!, version), createdAt: r.createdAt }));
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
  const ev = evaluateTeams(draft.teams.map((x) => x.members), rules);
  return {
    ...draft.result.snapshot,
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
 * Вибулий отримує status='rejected' (в UI — «вибув»). */
export async function substituteTeamMember(teamId: string, outId: string, inId: string | null, reason: 'no_show' | 'disqualified' | 'other' = 'no_show'): Promise<void> {
  const { error } = await supabase.rpc('substitute_team_member', {
    p_team_id: teamId,
    p_out_id: outId,
    p_in_id: inId,
    p_reason: reason,
  });
  if (error) throw error;
}
