/**
 * The words the tutorial uses: a short card for every window (shown by the
 * ? in its title bar, and once on its own the first time it opens) and the
 * steps of the tour of the desk that a new player is offered.
 *
 * Keep it in the player's world: nothing here may name the secret project.
 */
import type { WindowId } from './windowStore';

export interface WindowHelp {
  /** One line: what the window is for. Also its tab's hover label. */
  readonly summary: string;
  /** A few short how-tos. */
  readonly points: readonly string[];
}

export const WINDOW_HELP: Readonly<Record<WindowId, WindowHelp>> = {
  gateway: {
    summary: 'Your own computer: who you are, your credits, rating, storage and hardware.',
    points: [
      'Rating goes up with every job delivered. A higher rating opens better work on the Backroom board.',
      'Storage fills with programs and copied files. Free some room in Programs when it runs out.',
      'Hardware is bought from the Backroom and makes everything faster.',
    ],
  },
  map: {
    summary: 'Plan a route through relay servers and connect to your target.',
    points: [
      'Pick a server on the globe or in the address book to see what it is.',
      'Press + next to a server to add it as a relay. Each relay is one more step a trace has to follow.',
      'Where relays sit matters. A hop across a border slows a trace, and a hop to another part of the world slows it most. Hops inside one country are quick to follow.',
      'Pick your target last and press Connect. The route is drawn across the globe.',
      'While a trace closes in, pick a spare server and press Reroute to make it start that step again.',
    ],
  },
  server: {
    summary: 'The machine you are connected to: its security, and what you can do once logged in.',
    points: [
      'Security shows what stands in your way. Break the password, then log in.',
      'Bypass a proxy before changing records or logs, and a firewall before touching files.',
      'Before you leave, open Logs and scrub the lines that show you were there.',
      'Each connection gets its own tab along the top of the screen.',
    ],
  },
  programs: {
    summary: 'What your gateway is running, and what is taking up its storage.',
    points: [
      'Running programs show their progress here. How many can run at once depends on your hardware.',
      'Copied files land in storage. Open, decrypt or delete them from the Stored files list.',
      'Remove a program you no longer need to free room.',
    ],
  },
  messages: {
    summary: 'Mail from Wren and from clients. New things to learn arrive here.',
    points: [
      'Wren writes whenever something new opens up. The first message says where to start.',
      'A number on the Messages tab means mail you have not read yet.',
      'Write to someone lets you send a letter that talks a person into giving up a password. You put it together from what you have found, nothing to type.',
    ],
  },
  contract: {
    summary: 'The job you have taken: what the client wants, and whether it is done.',
    points: [
      'Take a job from Contracts on the Backroom board.',
      'The goal at the bottom ticks off once it is done. Then press Deliver to get paid.',
      'If a job goes wrong, Give up drops it. The contract also shows at the top right of the screen.',
    ],
  },
  skills: {
    summary: 'Spend skill points on lasting upgrades.',
    points: [
      'You earn a skill point as your best rating climbs. A number on the Skills tab means points to spend.',
      'Intrusion breaks in faster, Ghost keeps you hidden, Engineering builds better tools.',
      'Skills can be unlearned at the Backroom, for a price.',
    ],
  },
  workbench: {
    summary: 'Fit modules to your programs to make faster, smaller or quieter versions.',
    points: [
      'Pick a program, then a module you own. The build runs on your gateway.',
      'Your original program is kept. Scrap a build to get its modules back.',
      'Modules come from the Backroom market, from jobs, and from files on other servers.',
    ],
  },
  web: {
    summary: 'Lumen, the public web. News, company sites and the Open Relay Registry.',
    points: [
      'Follow links to move around. Back, Forward and Home are at the top.',
      'Company pages and the news are full of names, addresses and leads.',
      'The Open Relay Foundation lists servers you can use as relays.',
    ],
  },
  dark: {
    summary: 'Undertow, the hidden network. Rumours, tools and people who do not want to be found.',
    points: [
      'It works like Lumen: follow links, nothing to type.',
      'Things for sale here are not sold anywhere else.',
    ],
  },
  viewer: {
    summary: 'Reads a file from your storage.',
    points: ['Open a file from Programs to read it here.', 'Some files are sealed until you decrypt them.'],
  },
  saves: {
    summary: 'Save and load your game, or start a new one.',
    points: [
      'The game also saves itself as you play.',
      'You can download a save as a file, and bring it back on another computer.',
    ],
  },
};

/** A place on the screen the tour points at. Elements carry it as data-tour. */
export type TourTarget = WindowId | 'tabs' | 'contract' | 'trace' | 'speed' | 'menu';

export interface TourStep {
  readonly title: string;
  readonly body: string;
  /** What to point at. Left out (or not on screen), the card sits in the middle. */
  readonly target?: TourTarget;
  /** A window to bring to the front first. */
  readonly open?: WindowId;
}

export const TOUR: readonly TourStep[] = [
  {
    title: 'Welcome to your desk',
    body: 'A quick look around, about a minute. You can see it again any time from the game menu.',
  },
  {
    title: 'Windows',
    target: 'tabs',
    body: 'Every window has a tab down here. Press one to open the window, press it again to put it away. A number on a tab means something is waiting for you.',
  },
  {
    title: 'Messages',
    target: 'messages',
    open: 'messages',
    body: 'Wren, your contact, writes here whenever there is something new to learn. Read the first message: it tells you where to start.',
  },
  {
    title: 'Route map',
    target: 'map',
    open: 'map',
    body: 'Every server you know is in the address book. Add a few as relays, then connect to your target through them. More relays give you more time if you are traced, and relays spread across the world give you the most.',
  },
  {
    title: 'Gateway',
    target: 'gateway',
    open: 'gateway',
    body: 'Your own computer. Credits, rating, storage and hardware are all here.',
  },
  {
    title: 'Contract',
    target: 'contract',
    body: 'The job you are working on shows up here. Jobs are taken from the board at the Backroom, a server in your address book.',
  },
  {
    title: 'Trace',
    target: 'trace',
    body: 'Breaking in gets noticed. When a trace starts, a red timer rises here. Finish, scrub the logs and disconnect before it runs out, or you get fined.',
  },
  {
    title: 'Time',
    target: 'speed',
    body: 'Pause, or speed the clock up while you wait for something. While you are connected, time runs at normal speed.',
  },
  {
    title: 'Game menu',
    target: 'menu',
    body: 'Save, load, sound, keys, and this tour again.',
  },
  {
    title: 'Help is always close',
    body: 'Rest the pointer on a button or label for a short note on what it does. Every window has a ? in its title bar that explains it.',
  },
];

/** The last step's text on a touch screen, where nothing can be hovered. */
export const TOUCH_LAST_STEP =
  'Press and hold a button or label for a short note on what it does. Every window has a ? in its title bar that explains it.';
