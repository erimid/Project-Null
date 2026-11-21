/**
 * The gateway drawn as a board: every hardware slot in its place, with
 * the part fitted there. The Hardware counter of a shop and the Gateway
 * window both show it, so the player sees their rig the same way in both.
 */
import { HARDWARE_SLOT_LABELS, findPart, type HardwareState } from '../../core';
import type { HardwareDef, HardwareSlot } from '../../core/content';
import { content } from '../session';
import { IconTile, Pips } from './Gear';
import { slotIcon } from './Icon';

/** What each slot is for, in one line. */
export const SLOT_BLURBS: Record<HardwareSlot, string> = {
  cpu: 'Runs your programs. A better one finishes them sooner and runs more at once.',
  memory: 'Holds the programs you load for a job. More memory, more tools on hand at once.',
  storage: 'Room for programs and the files you bring home.',
  modem: 'Moves files. A better one copies and deletes faster.',
  ports: 'How many servers you can be connected to at once.',
  rack: 'Hosts a model at home, so there is no rent to pay.',
  sensor: 'Reads a trace early, even without a tracker running.',
  cooling: 'Lets the processor run harder. Everything speeds up again.',
};

export const slotLabel = (slot: HardwareSlot): string => HARDWARE_SLOT_LABELS.find(([id]) => id === slot)?.[1] ?? slot;

/** One figure of a part, for a bar and a readout. */
export interface PartStat {
  readonly label: string;
  /** The number the bar is drawn from. */
  readonly value: number;
  readonly text: string;
  /** True where less is better (the room a hosted model takes). */
  readonly lowerIsBetter?: boolean;
}

const times = (value: number) => `${Number(value.toFixed(2))}×`;
const room = (gb: number) => (gb >= 1000 ? `${Number((gb / 1000).toFixed(1))} TB` : `${gb} GB`);

/** The figures that matter for a part. An empty slot gives the same figures at nothing, so bars line up. */
export function partStats(slot: HardwareSlot, part: HardwareDef | undefined): PartStat[] {
  switch (slot) {
    case 'cpu':
      return [
        { label: 'Speed', value: part?.speed ?? 0, text: part ? times(part.speed ?? 1) : 'none' },
        { label: 'Programs', value: part?.programs ?? 0, text: part ? `${part.programs} at once` : 'none' },
      ];
    case 'memory':
      return [{ label: 'Loads', value: part?.memoryGb ?? 0, text: part ? room(part.memoryGb ?? 0) : 'none' }];
    case 'storage':
      return [{ label: 'Room', value: part?.storageGb ?? 0, text: part ? room(part.storageGb ?? 0) : 'none' }];
    case 'modem':
      return [{ label: 'Files', value: part?.fileSpeed ?? 0, text: part ? times(part.fileSpeed ?? 1) : 'none' }];
    case 'ports':
      return [{ label: 'Lines', value: part?.connections ?? 0, text: part ? `${part.connections} at once` : 'none' }];
    case 'rack': {
      const model = content.models.find((item) => item.id === part?.model);
      return [
        { label: 'Model', value: part?.tier ?? 0, text: model?.name ?? 'none' },
        { label: 'Takes', value: part?.sizeGb ?? 0, text: part ? room(part.sizeGb ?? 0) : '0 GB', lowerIsBetter: true },
      ];
    }
    case 'sensor':
      return [{ label: 'Read', value: part?.warn ?? 0, text: !part ? 'none' : (part.warn ?? 0) >= 2 ? 'exact' : 'early' }];
    case 'cooling':
      return [{ label: 'Boost', value: (part?.coolSpeed ?? 1) - 1, text: part ? `+${Math.round(((part.coolSpeed ?? 1) - 1) * 100)}%` : 'none' }];
  }
}

/** A badge on a slot: something for the Hardware counter to say about it. */
export interface SlotMark {
  readonly text: string;
  readonly tone?: 'good' | 'rare' | 'dim';
}

interface Props {
  hardware: HardwareState;
  selected: HardwareSlot | null;
  onSelect: (slot: HardwareSlot) => void;
  marks?: Partial<Record<HardwareSlot, SlotMark>>;
  /** A slot that has just had a part fitted: it flashes once. */
  fresh?: HardwareSlot | null;
  /** Lays the slots out in one short row where there is the width for it (the Gateway window, which has little height to spare). */
  strip?: boolean;
}

/*
 * Where the traces run: from the processor out to each other slot, with
 * square corners like a circuit board's. The board has two layouts, so
 * there are two sheets of traces, each laid over the board's grid: five
 * slots across on a wide window (500 by 200), three on a narrow one
 * (300 by 300).
 */
const TRACES_WIDE = ['M150 60H50', 'M150 140H50', 'M150 60H250', 'M150 140H250', 'M150 96H300V50H350', 'M150 104H300V150H350', 'M150 100H450'];
const TRACES_TALL = ['M150 100H100V50H50', 'M150 110H50V150', 'M140 100V200H50V250', 'M150 100V250', 'M150 90H200V50H250', 'M150 110H200V150H250', 'M160 100V200H250V250'];

function Traces({ paths, box, layout }: { paths: readonly string[]; box: string; layout: 'wide' | 'tall' }) {
  return (
    <svg class={`board__traces board__traces--${layout}`} viewBox={box} preserveAspectRatio="none" aria-hidden="true">
      {paths.map((d) => (
        <path key={d} d={d} class="board__trace" />
      ))}
      {paths.map((d) => (
        <path key={`pulse:${d}`} d={d} class="board__pulse" />
      ))}
    </svg>
  );
}

/** The board itself: eight slots, each a button. */
export function GatewayBoard({ hardware, selected, onSelect, marks, fresh, strip }: Props) {
  return (
    <div class={`board${strip ? ' board--strip' : ''}`} role="group" aria-label="Your gateway's hardware">
      <span class="board__bus" aria-hidden="true" />
      <Traces paths={TRACES_WIDE} box="0 0 500 200" layout="wide" />
      <Traces paths={TRACES_TALL} box="0 0 300 300" layout="tall" />
      {HARDWARE_SLOT_LABELS.map(([slot, label]) => {
        const tier = hardware[slot];
        const part = findPart(content, slot, tier);
        const tiers = content.hardware.filter((item) => item.slot === slot).length;
        const mark = marks?.[slot];
        return (
          <button
            key={slot}
            type="button"
            class={`slot slot--${slot}${slot === selected ? ' is-picked' : ''}${part ? '' : ' is-empty'}${fresh === slot ? ' is-new' : ''}`}
            aria-pressed={slot === selected}
            data-sfx="pick"
            onClick={() => onSelect(slot)}
          >
            <span class="slot__label">{label}</span>
            <IconTile icon={slotIcon(slot)} size={slot === 'cpu' ? 'lg' : 'md'} tone={part ? undefined : 'empty'} />
            <span class="slot__name">{part?.name ?? 'Empty'}</span>
            <Pips on={tier} of={tiers} label={`tier ${tier} of ${tiers}`} />
            {mark && <span class={`slot__mark${mark.tone ? ` is-${mark.tone}` : ''}`}>{mark.text}</span>}
          </button>
        );
      })}
    </div>
  );
}
