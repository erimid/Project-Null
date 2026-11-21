/**
 * The skill tree. Raising the rating earns points; points buy ranks in
 * skills; skills nudge the rules elsewhere (see `effect`). Unlearning
 * every skill gives the points back, for a price at the board.
 */
import type { SkillDef, SkillEffect } from '../content/skills';
import type { GameState } from './state';
import { findConnection, findServer, type Content } from './world';

export const findSkill = (content: Content, id: string): SkillDef | undefined => content.skills.find((skill) => skill.id === id);

/** Ranks learned in a skill. 0 = not learned. */
export const skillRank = (state: GameState, id: string): number => state.player.skills[id] ?? 0;

/**
 * How strongly the learned skills apply one effect: each skill's amount
 * per rank, times its rank, added up. 0 when nothing learned has it.
 */
export function effect(state: GameState, content: Content, kind: SkillEffect): number {
  let total = 0;
  for (const skill of content.skills) {
    if (skill.effect === kind) total += skill.amount * skillRank(state, skill.id);
  }
  return total;
}

/** Keeps the best rating up to date. Call whenever the rating may have risen. */
export function noteRating(state: GameState): void {
  state.player.bestRating = Math.max(state.player.bestRating, state.player.rating);
}

/**
 * Skill points a best rating is worth: one for every `skillPointRating`
 * of it, and past `skillPointSlowAfter` one for every
 * `skillPointSlowRating`. The upper titles are long, and earn points at
 * about the pace of the short early ones.
 */
export function pointsAt(rules: Content['rules'], rating: number): number {
  const turn = rules.skillPointSlowAfter ?? Infinity;
  const early = Math.floor(Math.min(rating, turn) / rules.skillPointRating);
  return early + Math.floor(Math.max(0, rating - turn) / (rules.skillPointSlowRating ?? rules.skillPointRating));
}

/** Points earned so far. */
export const pointsEarned = (state: GameState, content: Content): number => pointsAt(content.rules, state.player.bestRating);

/** Points tied up in learned skills. */
export function pointsSpent(state: GameState, content: Content): number {
  return content.skills.reduce((sum, skill) => sum + skill.cost * skillRank(state, skill.id), 0);
}

/** Points ready to spend. */
export const pointsFree = (state: GameState, content: Content): number =>
  Math.max(0, pointsEarned(state, content) - pointsSpent(state, content));

/** The best rating at which the next point comes. */
export function nextPointRating(state: GameState, content: Content): number {
  const have = pointsEarned(state, content);
  let rating = state.player.bestRating + 1;
  while (pointsAt(content.rules, rating) <= have) rating++;
  return rating;
}

/** How much rating lies between the last point earned and the next. */
export function pointStep(state: GameState, content: Content): number {
  const turn = content.rules.skillPointSlowAfter ?? Infinity;
  return nextPointRating(state, content) > turn ? (content.rules.skillPointSlowRating ?? content.rules.skillPointRating) : content.rules.skillPointRating;
}

/** Why the next rank of a skill can't be learned now, or null if it can. */
export function whyNotLearn(state: GameState, content: Content, id: string): string | null {
  const skill = findSkill(content, id);
  if (!skill) return 'No such skill.';
  if (skillRank(state, id) >= skill.ranks) return `You have learned all of ${skill.name}.`;
  if (skill.signature) {
    const at = content.rules.signatureRating ?? Infinity;
    if (state.player.bestRating < at) return `A signature opens at a best rating of ${at}.`;
    const held = content.skills.find((other) => other.signature && other.id !== id && skillRank(state, other.id) > 0);
    if (held) return `You already carry a signature: ${held.name}. Unlearn to pick another.`;
    return null;
  }
  if (skill.needs !== undefined && skillRank(state, skill.needs) === 0) {
    return `Learn ${findSkill(content, skill.needs)?.name ?? skill.needs} first.`;
  }
  const free = pointsFree(state, content);
  if (free < skill.cost) return `${skill.name} needs ${skill.cost} ${skill.cost === 1 ? 'point' : 'points'}; you have ${free}.`;
  return null;
}

/** Learns the next rank of a skill. Returns a reason if it can't. */
export function learnSkill(state: GameState, content: Content, id: string): string | null {
  const reason = whyNotLearn(state, content, id);
  if (reason !== null) return reason;
  state.player.skills[id] = skillRank(state, id) + 1;
  return null;
}

/** What unlearning everything costs this time. */
export const unlearnPrice = (state: GameState, content: Content): number => content.rules.unlearnPrice * (state.player.unlearns + 1);

/**
 * Forgets every skill and frees all the points, for a price paid to the
 * board the player is logged in to. Returns a reason if it can't.
 */
export function unlearnSkills(state: GameState, content: Content, connectionId: string): string | null {
  const connection = findConnection(state, connectionId);
  if (!connection || connection.user === null || findServer(content, connection.serverId)?.kind !== 'board') {
    return 'Log in to the board first.';
  }
  if (pointsSpent(state, content) === 0) return 'You have not learned anything to forget.';
  const price = unlearnPrice(state, content);
  if (state.player.balance < price) return `Unlearning costs ${price} credits.`;
  state.player.balance -= price;
  state.player.skills = {};
  state.player.unlearns++;
  return null;
}
