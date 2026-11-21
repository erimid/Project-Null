/**
 * The guided first job on screen: which button to light up, and what Wren
 * says. The steps come from core/guide.ts; this only hides them when hints
 * are off or the tour is running.
 */
import { guideStep, type GuideId, type GuideStep } from '../../core';
import { useWorld } from '../hooks';
import { content } from '../session';
import { useHints } from './hintStore';

/** The step to show now, or null. */
export function useGuide(): GuideStep | null {
  const hints = useHints();
  const step = useWorld((game) => guideStep(game, content));
  return hints.on && hints.step === null ? step : null;
}

/** ' is-guided' when `guide` is on one of these steps (and, if given, about this server), for adding to a class list. */
export function lit(guide: GuideStep | null, ids: GuideId | readonly GuideId[], serverId?: string): string {
  if (!guide) return '';
  const matches = typeof ids === 'string' ? guide.id === ids : ids.includes(guide.id);
  return matches && (serverId === undefined || guide.serverId === serverId) ? ' is-guided' : '';
}
