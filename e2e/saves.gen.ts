/**
 * Makes the saved games the robot playtester loads: a scripted player
 * plays a career with the real game data, and a copy of the game is
 * written to e2e/.saves/ at a few points along the way.
 *
 * Run through `npm run e2e`, which calls this first (with vitest, so the
 * data files load the same way they do in the game).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { PROFILES, playCareer, type CareerOptions } from '../src/core/career';
import { serializeGame, type Content, type GameState } from '../src/core';
import { assets, companies, contracts as allContracts, gameInfo, hardware, mail, models, people, programs, modules, rivals, servers, skills, story as fullStory, tuning, news, patrons, ladder, data, linesOf, storyOf } from '../src/content';

// The scripted player plays Acts 1 and 2 (as in the balance tests); the saves load with the full game.
const LATE = /^(act[34]|after)-/;
const act12 = linesOf(fullStory).find((line) => line.id === 'main')!.beats.filter((beat) => !/^(a3|a4|end)-/.test(beat.id));
const content: Content = {
  servers,
  startingServers: gameInfo.startingServers,
  programs,
  startingPrograms: gameInfo.startingPrograms,
  contracts: allContracts.filter((contract) => !LATE.test(contract.id)),
  mail,
  people,
  models,
  hardware,
  companies,
  skills,
  modules,
  rivals,
  story: storyOf([{ id: 'main', beats: act12 }]),
  news,
  patrons,
  ladder,
  data,
  assets,
  rules: tuning,
};

/** Which deliveries to keep a copy after, by name. */
const POINTS: Readonly<Record<string, number>> = { mid: 36, late: 70 };

it('writes the saved games for the browser tests', () => {
  const kept = new Map<string, GameState>();
  let delivered = 0;
  const last = Math.max(...Object.values(POINTS));
  const options: CareerOptions = {
    maxContracts: last,
    maxMinutes: 400,
    untilRating: gameInfo.ratings[gameInfo.ratings.length - 1]!.min,
    ratings: gameInfo.ratings,
    startDate: tuning.startDate,
    startingBalance: tuning.startingBalance,
    snapshot: (state) => {
      delivered += 1;
      for (const [name, at] of Object.entries(POINTS)) if (at === delivered) kept.set(name, structuredClone(state));
    },
  };
  playCareer(content, 7, PROFILES.typical, options);
  mkdirSync('e2e/.saves', { recursive: true });
  // A time far ahead, so the game takes this copy over anything already in its slot.
  const savedAt = '2099-01-01T00:00:00.000Z';
  for (const [name, state] of kept) writeFileSync(`e2e/.saves/${name}.json`, JSON.stringify({ slot: 1, text: serializeGame(state, savedAt) }));
  if (kept.size !== Object.keys(POINTS).length) throw new Error(`Only ${kept.size} saves made: the career ended early.`);
});
