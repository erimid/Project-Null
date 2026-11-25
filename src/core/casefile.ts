/**
 * The case file: who the player has met in the story, what each side is
 * waiting on, the choices made, and the hidden name as far as it has been
 * found. Pure reading of the game and content/casefile.json; nothing here
 * changes the game.
 */
import { linesOf } from '../content/story';
import type { CaseLine } from '../content/casefile';
import { conditionMet } from './conditions';
import { DEFAULT_CHOICE } from './patrons';
import type { GameState } from './state';
import { storyWaits } from './story';
import type { Content } from './world';

export interface CasePersonView {
  readonly id: string;
  readonly name: string;
  readonly text: string;
}

export interface CaseThreadView {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly open: boolean;
  /** A story job of this side's that is on the board or being worked on, by title. */
  readonly job?: string;
  /** What the side is waiting on the player for, when a job is held back. */
  readonly waiting: readonly { readonly note: string; readonly met: boolean }[];
}

export interface CaseChoiceView {
  readonly contractId: string;
  readonly title: string;
  readonly text: string;
}

export interface CaseNameView {
  /** The name as far as it is known, one piece per block, null for a piece not found. Whole once `full`. */
  readonly blocks: readonly (string | null)[];
  /** Letters found but not yet set in place. */
  readonly loose: readonly string[];
  readonly full: boolean;
  readonly note: string;
}

export interface CaseFileView {
  readonly people: readonly CasePersonView[];
  readonly threads: readonly CaseThreadView[];
  readonly choices: readonly CaseChoiceView[];
  /** Null until the first piece of the name is found. */
  readonly name: CaseNameView | null;
}

/** The last line that holds, or undefined if none does. */
function latest(state: GameState, lines: readonly CaseLine[]): string | undefined {
  return lines.filter((line) => conditionMet(state, line.when)).at(-1)?.text;
}

export function caseFile(state: GameState, content: Content): CaseFileView {
  const def = content.casefile;
  if (!def) return { people: [], threads: [], choices: [], name: null };

  // People: met once their first line holds.
  const people = def.people.flatMap((person): CasePersonView[] => {
    if (!conditionMet(state, person.lines[0]!.when)) return [];
    return [{ id: person.id, name: person.name, text: latest(state, person.lines) ?? person.lines[0]!.text }];
  });

  // Threads: one per story line that has sent something; open until the line is over.
  const lines = linesOf(content.story);
  const waits = storyWaits(state, content);
  const threads = def.threads.flatMap((thread): CaseThreadView[] => {
    const line = lines.find((item) => item.id === thread.line);
    const at = state.story.lines[thread.line];
    if (!line || !at || (at.beat === 0 && !at.arrived)) return [];
    const ids = new Set(line.beats.flatMap((beat) => (beat.contractId ? [beat.contractId] : [])));
    const live = [state.contracts.activeId, ...state.story.offered].find((id) => id !== null && ids.has(id));
    const job = live ? content.contracts.find((contract) => contract.id === live)?.title : undefined;
    return [
      {
        id: thread.id,
        title: thread.title,
        text: (thread.lines && latest(state, thread.lines)) ?? thread.text,
        open: at.beat < line.beats.length,
        ...(job ? { job } : {}),
        waiting: waits.find((wait) => wait.lineId === thread.line)?.needs ?? [],
      },
    ];
  });

  // Choices made at the end of jobs, in the order made.
  const choices = Object.entries(state.patrons.choices).flatMap(([contractId, choiceId]): CaseChoiceView[] => {
    const contract = content.contracts.find((item) => item.id === contractId);
    if (!contract) return [];
    const written = def.choices[contractId]?.[choiceId];
    const label = choiceId === DEFAULT_CHOICE ? 'Handed over as asked.' : (contract.choices?.find((choice) => choice.id === choiceId)?.label ?? choiceId);
    return [{ contractId, title: contract.title, text: written ?? label }];
  });

  // The name: the first block opens the section; the rest are letters found loose until the whole name is read.
  const found = def.name.blocks.map((block) => conditionMet(state, block.when));
  let name: CaseNameView | null = null;
  if (found[0]) {
    const full = conditionMet(state, def.name.full);
    name = {
      blocks: def.name.blocks.map((block, index) => (full || index === 0 ? block.text : null)),
      loose: full ? [] : def.name.blocks.slice(1).filter((_, index) => found[index + 1]).map((block) => block.text),
      full,
      note: full ? def.name.fullNote : def.name.note,
    };
  }
  return { people, threads, choices, name };
}
