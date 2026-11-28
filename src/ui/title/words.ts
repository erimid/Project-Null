/** The words of the credits and of a new career's opening. */

export const CREDITS: readonly (readonly [string, readonly string[]])[] = [
  ['The game', ['A hacker story told with a globe, a gateway and other people’s servers.', 'In the spirit of the hacker sims of the early 2000s.']],
  ['Created by', ['Erimid']],
  ['Written and built with', ['Claude, by Anthropic']],
  ['Typefaces', ['Rajdhani, by Indian Type Foundry', 'Share Tech Mono, by Carrois Apostrophe', 'Both under the SIL Open Font License']],
  ['The globe', ['Coastlines and borders drawn from Natural Earth, which is in the public domain']],
  ['Made with', ['Preact, Vite, TypeScript and Vitest']],
  ['A note', ['Every company, person, server and address here is invented. Nothing in the game touches a real machine, and it makes no requests to other sites.']],
  ['Thank you', ['For playing.']],
];

/** The invite, a line at a time. `{handle}` is the new player's. */
export const INVITE: readonly string[] = ['the backroom', 'members only. no names. no refunds.', 'invite for {handle}', 'vouched for by: wren', 'accepted'];

/** The gateway waking up: each part, then what it reports. */
export const BOOT: readonly (readonly [string, string])[] = [
  ['Power', 'steady'],
  ['Processor', 'awake'],
  ['Memory', 'clear'],
  ['Drive', 'mounted'],
  ['Modem', 'carrier found'],
  ['Route table', 'empty'],
  ['Link', 'up'],
];
