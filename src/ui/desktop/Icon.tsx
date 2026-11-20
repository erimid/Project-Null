/**
 * The game's icon set: one drawn icon for every kind of program, hardware
 * slot, module, job and file, plus a few for the screens themselves.
 *
 * Every icon is line art on a 24 by 24 grid, drawn in the colour of the
 * text around it, so one set works on every panel. Screens ask for an
 * icon by what it stands for (programIcon('scan'), slotIcon('cpu')) and
 * never by its picture, so a drawing can change in one place.
 */
import type { ProgramKind } from '../../core/content';

/** The drawings: what goes inside each icon's <svg>. */
const ICONS = {
  // ---- programs, by what they do ----
  key: '<circle cx="8" cy="15.5" r="4.2"/><path d="M11 12.5l9-9M16.5 7l3 3M13.5 10l2 2"/>',
  around: '<rect x="8" y="10" width="8" height="9" rx="1.5"/><path d="M4 16V8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8M17.5 13.5L20 16l2.5-2.5"/>',
  wall: '<path d="M3 5h18v14H3zM3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M12 9.7v4.6M9 14.3V19M15 14.3V19"/>',
  eyeOff: '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/><path d="M4.5 19.5l15-15"/>',
  unlock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 7.6-1.7M12 14.5v2.5"/>',
  copy: '<rect x="8.5" y="8" width="11" height="13" rx="1.5"/><path d="M15.5 8V4.5A1.5 1.5 0 0 0 14 3H6a1.5 1.5 0 0 0-1.5 1.5V15A1.5 1.5 0 0 0 6 16.5h2.5"/>',
  fileX: '<path d="M13.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8zM13.5 3v5h5M9.5 12.5l5 5M14.5 12.5l-5 5"/>',
  linesX: '<path d="M4 6h16M4 11h9M4 16h6M14.5 14.5l5.5 5.5M20 14.5L14.5 20"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6.4-6.4"/><circle cx="12" cy="12" r="0.9" fill="currentColor"/>',
  braces:
    '<path d="M8.5 4c-2.5 0-3 1.2-3 3v2.5c0 1.5-.8 2.5-2 2.5 1.2 0 2 1 2 2.5V17c0 1.8.5 3 3 3M15.5 4c2.5 0 3 1.2 3 3v2.5c0 1.5.8 2.5 2 2.5-1.2 0-2 1-2 2.5V17c0 1.8-.5 3-3 3M13.5 8.5l-3 7"/>',
  route: '<circle cx="5" cy="18.5" r="2.3"/><circle cx="19" cy="5.5" r="2.3"/><circle cx="12.5" cy="12.5" r="1.7"/><path d="M6.9 17.1l4.2-3.5M13.8 11.3l3.7-4"/>',
  scan: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5M11 8v6M8 11h6"/>',
  noise: '<path d="M2 12h3l2-6 3 12 3-14 3 16 2-8h4"/>',

  // ---- hardware slots ----
  chip: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/><rect x="10" y="10" width="4" height="4"/><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21"/>',
  drives: '<rect x="4" y="4" width="16" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="16" height="6.5" rx="1.5"/><path d="M7.5 7.25h.01M7.5 16.75h.01M11 7.25h5.5M11 16.75h5.5"/>',
  modem: '<rect x="3.5" y="13.5" width="17" height="6.5" rx="1.5"/><path d="M7 16.75h.01M10.5 16.75h.01M16 13.5V10M13.2 7.6a4 4 0 0 1 5.6 0M10.8 5.2a7.4 7.4 0 0 1 10.4 0"/>',
  sockets: '<rect x="3" y="6.5" width="18" height="11" rx="1.5"/><path d="M6.5 10h4v4h-4zM13.5 10h4v4h-4zM8.5 14v-1.5M15.5 14v-1.5"/>',
  rack: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M5 9h14M5 15h14M8.2 6h.01M8.2 12h.01M8.2 18h.01M11.5 6h4M11.5 12h4M11.5 18h4"/>',
  beacon: '<path d="M12 13v8M8 21h8M6.5 15.5a7.8 7.8 0 0 1 0-11M17.5 4.5a7.8 7.8 0 0 1 0 11"/><circle cx="12" cy="10" r="2.6"/>',
  frost: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2L3.8 16.8M9.5 4l2.5 2.5L14.5 4M9.5 20l2.5-2.5 2.5 2.5"/>',

  // ---- modules ----
  bolt: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
  shrink: '<path d="M4 4l5.5 5.5M9.5 5v4.5H5M20 20l-5.5-5.5M14.5 19v-4.5H19M20 4l-5.5 5.5M14.5 5v4.5H19M4 20l5.5-5.5M9.5 19v-4.5H5"/>',
  mute: '<path d="M4 9.5h3l4.5-4v13l-4.5-4H4zM15.5 9.5l5 5M20.5 9.5l-5 5"/>',
  sparkle: '<path d="M10 4l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6zM18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z"/>',
  send: '<path d="M19 13v5.5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5H11M14 4h6v6M20 4l-9 9"/>',
  burst: '<path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M18.7 5.3l-2.8 2.8M8.1 15.9l-2.8 2.8"/><circle cx="12" cy="12" r="2.2"/>',
  feather: '<path d="M20 4c-7.5 0-12.5 4-12.5 10v2.5H10c6 0 10-5 10-12.5zM4 20l9-9M12.5 8v3.5H16"/>',
  bare: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="2.6 3"/><rect x="9.5" y="9.5" width="5" height="5"/>',
  weight: '<path d="M6.5 9h11L20 20.5H4zM9.5 9a2.5 2.5 0 1 1 5 0"/>',
  ghost: '<path d="M5 21V10a7 7 0 0 1 14 0v11l-2.3-2-2.4 2-2.3-2-2.3 2-2.4-2zM9.5 10.5h.01M14.5 10.5h.01"/>',
  brush: '<path d="M14.5 3l6.5 6.5-3.5 3.5L11 6.5zM11 6.5L3.5 16c2 2.6 4.6 4.2 8 4.5l6-7.5M7 14.5l3 3"/>',
  twin: '<rect x="3.5" y="3.5" width="11" height="11" rx="2"/><rect x="9.5" y="9.5" width="11" height="11" rx="2"/>',

  // ---- jobs ----
  takeDown: '<path d="M12 3v11.5M7.5 10L12 14.5 16.5 10M4 16v3.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V16"/>',
  trash: '<path d="M4 6.5h16M9.5 6.5V4h5v2.5M6.5 6.5l1 14h9l1-14M10 10.5v6M14 10.5v6"/>',
  pencil: '<path d="M4 20l1-4.5L16.5 4 20 7.5 8.5 19zM14 6.5l3.5 3.5"/>',
  book: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13.5c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5V20"/>',
  putUp: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8M4 16v3.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V16"/>',
  blame: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-4 3-6 6.5-6s6 2 6.5 6M17 5.5l4 4M21 5.5l-4 4"/>',
  steps: '<path d="M3 19.5h5v-5h5v-5h5v-5h3"/>',
  repeat: '<path d="M4 11a8 8 0 0 1 14-4.5L20 8.5M20 4v4.5h-4.5M20 13a8 8 0 0 1-14 4.5L4 15.5M4 20v-4.5h4.5"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8z"/>',

  // ---- files ----
  file: '<path d="M13.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8zM13.5 3v5h5M9 13h6M9 16.5h4"/>',
  data: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  box: '<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5zM3.5 7.5L12 12l8.5-4.5M12 12v9"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 9.5l3 2.5-3 2.5M12.5 14.5H17"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11M12 14.5V17"/>',
  wave: '<path d="M3 12h2M7 8v8M11 4.5v15M15 9v6M19 6.5v11M21.5 12h.01"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.6l2 2.5h8.4A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"/>',
  module: '<path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><circle cx="12" cy="12" r="2.8"/>',

  // ---- the screens themselves ----
  model:
    '<circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="1.9"/><circle cx="19" cy="5" r="1.9"/><circle cx="5" cy="19" r="1.9"/><circle cx="19" cy="19" r="1.9"/><path d="M6.4 6.4l3.4 3.4M17.6 6.4l-3.4 3.4M6.4 17.6l3.4-3.4M17.6 17.6l-3.4-3.4"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
  up: '<circle cx="12" cy="12" r="9"/><path d="M12 16.5v-9M8 11.5l4-4 4 4"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.3a3.6 3.6 0 1 0 0 5.4"/>',
  pin: '<path d="M12 21.5s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10.5" r="2.4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3.5 2"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3 8-7.5 9.5-4.5-1.5-7.5-5-7.5-9.5V6z"/>',
  person: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c.6-4.3 3.5-6.5 7.5-6.5s6.9 2.2 7.5 6.5"/>',
  play: '<path d="M7.5 4.5v15l12-7.5z"/>',
  tools: '<path d="M14.5 6.5a4 4 0 0 0 5 5L11 20a2.1 2.1 0 0 1-3-3zM14.5 6.5l2.7-2.7M4 4l5 5M4 8.5L8.5 4"/>',
} as const;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

interface Props {
  name: IconName;
  /** Width and height in pixels. */
  size?: number;
  class?: string;
}

/** One icon, in the colour of the text around it. Decoration only: the words beside it carry the meaning. */
export function Icon({ name, size = 20, class: extra }: Props) {
  return (
    <svg
      class={`icon${extra ? ` ${extra}` : ''}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

const PROGRAM_ICONS: Record<ProgramKind, IconName> = {
  breakPassword: 'key',
  bypassProxy: 'around',
  bypassFirewall: 'wall',
  bypassMonitor: 'eyeOff',
  decrypt: 'unlock',
  copyFile: 'copy',
  deleteFile: 'fileX',
  deleteLog: 'linesX',
  traceTracker: 'radar',
  decompile: 'braces',
  planRoute: 'route',
  scan: 'scan',
  jamTrace: 'noise',
};

const SLOT_ICONS: Record<string, IconName> = {
  cpu: 'chip',
  storage: 'drives',
  modem: 'modem',
  ports: 'sockets',
  rack: 'rack',
  sensor: 'beacon',
  cooling: 'frost',
};

const MODULE_ICONS: Record<string, IconName> = {
  swift: 'bolt',
  compact: 'shrink',
  quiet: 'mute',
  tidy: 'sparkle',
  offload: 'send',
  burst: 'burst',
  lean: 'feather',
  bare: 'bare',
  heavy: 'weight',
  ghost: 'ghost',
  scrubber: 'brush',
  twin: 'twin',
};

const OBJECTIVE_ICONS: Record<string, IconName> = {
  steal: 'takeDown',
  destroy: 'trash',
  record: 'pencil',
  read: 'book',
  plant: 'putUp',
  frame: 'blame',
};

const FILE_ICONS: Record<string, IconName> = {
  txt: 'file',
  log: 'file',
  dat: 'data',
  arc: 'box',
  bin: 'terminal',
  mod: 'module',
  wav: 'wave',
  mp4: 'film',
};

export const programIcon = (kind: ProgramKind): IconName => PROGRAM_ICONS[kind];
export const slotIcon = (slot: string): IconName => SLOT_ICONS[slot] ?? 'chip';
/** A module's own icon; a module nobody has drawn yet gets the plain module shape. */
export const moduleIcon = (id: string): IconName => MODULE_ICONS[id] ?? 'module';
export const objectiveIcon = (kind: string): IconName => OBJECTIVE_ICONS[kind] ?? 'file';
/** A file's icon, by its ending. Encrypted files show a lock whatever they are. */
export const fileIcon = (name: string, encrypted = false): IconName =>
  encrypted ? 'lock' : (FILE_ICONS[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'file');

/** Where each kind of program sits on a shelf: the groups shops and the Programs window sort by. */
export const PROGRAM_GROUPS = [
  { id: 'entry', label: 'Break in', icon: 'key', kinds: ['breakPassword', 'bypassProxy', 'bypassFirewall', 'bypassMonitor'] },
  { id: 'files', label: 'Files', icon: 'copy', kinds: ['copyFile', 'deleteFile', 'decrypt', 'decompile'] },
  { id: 'cover', label: 'Cover', icon: 'radar', kinds: ['deleteLog', 'traceTracker', 'jamTrace', 'planRoute', 'scan'] },
] as const satisfies readonly { id: string; label: string; icon: IconName; kinds: readonly ProgramKind[] }[];

export type ProgramGroupId = (typeof PROGRAM_GROUPS)[number]['id'];
export const groupOf = (kind: ProgramKind): ProgramGroupId =>
  PROGRAM_GROUPS.find((group) => (group.kinds as readonly ProgramKind[]).includes(kind))?.id ?? 'cover';

/** What each kind of program does, in two or three words. */
const KIND_LABELS: Record<ProgramKind, string> = {
  breakPassword: 'Breaks passwords',
  bypassProxy: 'Gets past proxies',
  bypassFirewall: 'Opens firewalls',
  bypassMonitor: 'Blinds monitors',
  decrypt: 'Decrypts files',
  copyFile: 'Copies files',
  deleteFile: 'Deletes files',
  deleteLog: 'Scrubs logs',
  traceTracker: 'Shows traces',
  decompile: 'Takes programs apart',
  planRoute: 'Plans routes',
  scan: 'Scans servers',
  jamTrace: 'Jams traces',
};
export const kindLabel = (kind: ProgramKind): string => KIND_LABELS[kind];
