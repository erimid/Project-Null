import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { WINDOW_HELP } from './help';
import { hintStore, useHints } from './hintStore';
import { useLayout } from './layout';
import { usePanes } from './panes';
import { fitOnDesk } from './fit';
import { grabOffset, snapMove, snapSize, zoneAt, zoneRect, type Area, type Rect, type Zone } from './snap';
import { snapping } from './snapStore';
import { MIN_HEIGHT, MIN_WIDTH, WINDOW_DEFS, windows, useWindows, type WindowId } from './windowStore';

interface Props {
  id: WindowId;
  /** Shown instead of the window's usual title. */
  title?: string;
  /** Small dim text next to the title. */
  note?: string;
  /** Buttons shown on the right of the title bar. */
  actions?: ComponentChildren;
  /** Section tabs, shown in a strip of their own under the title bar. */
  tabs?: ComponentChildren;
  children: ComponentChildren;
}

type Drag = { pointerId: number; dx: number; dy: number };
/**
 * A title-bar drag: also where it started, the zone being offered, and the
 * window's full size (its whole height, even where the desk cuts it short).
 */
type Move = Drag & { startX: number; startY: number; moved: boolean; zone: Zone | null; w: number; h: number };

/** How far the pointer has to travel before a press on the title bar counts as a drag. */
const DRAG_START = 4;

/** Where the other windows on the desk are, for edges to stick to. */
function otherWindows(self: HTMLElement): Rect[] {
  const area = self.parentElement;
  if (!area) return [];
  return [...area.querySelectorAll<HTMLElement>(':scope > section.window')]
    .filter((el) => el !== self && !el.hidden)
    .map((el) => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }));
}

const areaOf = (self: HTMLElement): Area | null => {
  const area = self.parentElement;
  return area ? { w: area.clientWidth, h: area.clientHeight } : null;
};

/**
 * How tall a window really is: its set height, or for one as tall as its
 * contents, the height of those contents even where the desk cuts it short.
 */
function fullHeight(self: HTMLElement, set: number | null): number {
  if (set !== null) return set;
  const body = self.querySelector<HTMLElement>(':scope > .window__body');
  return body ? self.offsetHeight - body.clientHeight + body.scrollHeight : self.offsetHeight;
}

/**
 * A floating window. Drag it by its title bar; drag its bottom-right
 * corner to resize it (double-click the corner for its usual size);
 * click anywhere on it to bring it to the front. The dash minimizes it
 * to its bottom-bar tab, × closes it.
 *
 * With snapping on, its edges stick to the desk's edges and to other
 * windows; pushing the pointer against a side of the desk fills half of
 * it, a corner a quarter, the top edge all of it. Double-clicking the
 * title bar fills the desk, or puts it back. Shift while dragging turns
 * snapping off for that drag.
 */
export function Window({ id, title, note, actions, tabs, children }: Props) {
  const layout = useWindows()[id];
  const def = WINDOW_DEFS[id];
  const frame = useRef<HTMLElement>(null);
  const drag = useRef<Move | null>(null);
  const sizing = useRef<Drag | null>(null);
  const layoutKind = useLayout();
  const panes = usePanes();
  const hints = useHints();

  const tablet = layoutKind === 'tablet';
  const half = panes.indexOf(id);
  const shown = layout.open && !layout.minimized && (layoutKind === 'desk' || (tablet ? half >= 0 : windows.isOnTop(id)));
  useEffect(() => {
    if (shown) hintStore.firstShow(id);
  }, [shown]);

  if (!layout.open || layout.minimized) return null;
  const name = title ?? def.title;
  const helpOpen = hints.open === id;
  const helpButton = (
    <button
      class={`window__close window__help-btn${helpOpen ? ' is-open' : ''}`}
      type="button"
      aria-label={`What is ${name} for?`}
      aria-expanded={helpOpen}
      data-tip="What is this window for?"
      onClick={() => hintStore.toggleHelp(id)}
    >
      ?
    </button>
  );
  const help = helpOpen && <HelpCard id={id} name={def.title} hintsOn={hints.on} />;

  // A phone shows only the front window, full screen. The others stay
  // mounted underneath (hidden), so whatever was going on in them is kept.
  // A tablet shows two, side by side, each about as wide as a phone.
  if (layoutKind !== 'desk') {
    const front = tablet ? half >= 0 : windows.isOnTop(id);
    const pane = tablet && half >= 0 ? ` window--pane window--pane-${panes[1 - half] === null ? 'solo' : half === 0 ? 'left' : 'right'}` : '';
    return (
      <section
        class={`window window--phone${pane}${windows.isOnTop(id) ? ' window--front' : ''}`}
        hidden={!front}
        aria-label={name}
        data-tour={id}
        onPointerDownCapture={tablet ? () => windows.focus(id) : undefined}
      >
        <div class="window__title">
          <span class="window__title-text">{name}</span>
          {note && <span class="window__title-note">{note}</span>}
          <span class="window__title-gap" />
          {actions}
          {helpButton}
          <button class="window__close" type="button" aria-label={`Close ${name}`} onClick={() => windows.close(id)}>
            ×
          </button>
        </div>
        {tabs && (
          <nav class="window__tabs" aria-label={`${name} sections`}>
            {tabs}
          </nav>
        )}
        {help}
        <div class="window__body">{children}</div>
      </section>
    );
  }

  // Never past an edge of the desk: narrower or shorter if need be. Also
  // applied when drawing, so a window saved on a bigger screen still fits.
  const desk = windows.area();
  const { x, y, w: width, h: height } = fitOnDesk(
    { x: layout.x, y: layout.y, w: layout.w ?? def.width, h: layout.h },
    desk,
    MIN_HEIGHT,
  );
  /** Where a window of the given size can go, wholly on the desk. */
  const clamp = (x: number, y: number, w: number, h: number): [number, number] => {
    const self = frame.current;
    const area = (self && areaOf(self)) ?? desk;
    const fitted = fitOnDesk({ x, y, w, h }, area);
    return [fitted.x, fitted.y];
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    drag.current = {
      pointerId: event.pointerId,
      dx: event.clientX - x,
      dy: event.clientY - y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      zone: null,
      w: width,
      h: frame.current ? fullHeight(frame.current, height) : (height ?? MIN_HEIGHT),
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    const active = drag.current;
    const self = frame.current;
    if (!active || active.pointerId !== event.pointerId || !self) return;
    if (!active.moved) {
      if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < DRAG_START) return;
      active.moved = true;
      // A window filling a zone goes back to its own size as soon as it is pulled away.
      if (layout.restore) {
        const area = areaOf(self);
        const w = Math.min(layout.restore.w ?? def.width, area?.w ?? Infinity);
        active.dx = grabOffset(active.dx, width, w);
        active.w = w;
        active.h = layout.restore.h ?? fullHeight(self, null);
        windows.unplace(id, true);
      }
    }
    const rawX = event.clientX - active.dx;
    const rawY = event.clientY - active.dy;
    const area = areaOf(self);
    const box = self.parentElement?.getBoundingClientRect();
    if (!snapping.isOn() || event.shiftKey || !area || !box) {
      active.zone = null;
      snapping.setPreview(null);
      windows.move(id, ...clamp(rawX, rawY, active.w, active.h));
      return;
    }
    active.zone = zoneAt(event.clientX - box.left, event.clientY - box.top, area);
    snapping.setPreview(active.zone ? zoneRect(active.zone, area) : null);
    if (active.zone) {
      windows.move(id, ...clamp(rawX, rawY, active.w, active.h));
      return;
    }
    // Snap with its full size: the drawn height shrinks near the bottom of the desk, and its bottom edge would stick wherever it was.
    const h = Math.min(active.h, area.h);
    const snapped = snapMove({ x: rawX, y: rawY, w: active.w, h }, area, otherWindows(self));
    windows.move(id, ...clamp(snapped.x, snapped.y, active.w, h));
  };
  const endDrag = (event: PointerEvent) => {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    drag.current = null;
    snapping.setPreview(null);
    if (active.zone && event.type === 'pointerup') windows.place(id, active.zone);
    else windows.settle();
  };
  // Double-click the title bar: fill the desk, or go back to how it was.
  const onTitleDblClick = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest('button')) return;
    if (layout.restore) windows.unplace(id);
    else windows.place(id, 'full');
  };

  // The corner grip: dx and dy are how far the pointer is from the window's bottom-right corner.
  const onGripDown = (event: PointerEvent) => {
    const box = frame.current?.getBoundingClientRect();
    if (event.button !== 0 || !box) return;
    sizing.current = { pointerId: event.pointerId, dx: box.right - event.clientX, dy: box.bottom - event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onGripMove = (event: PointerEvent) => {
    const active = sizing.current;
    const box = frame.current?.getBoundingClientRect();
    const area = frame.current?.parentElement?.getBoundingClientRect();
    if (!active || active.pointerId !== event.pointerId || !box || !area) return;
    const w = Math.min(Math.max(event.clientX + active.dx - box.left, def.minWidth ?? MIN_WIDTH), area.right - box.left);
    const h = Math.min(Math.max(event.clientY + active.dy - box.top, MIN_HEIGHT), area.bottom - box.top);
    const self = frame.current!;
    const desk = areaOf(self);
    const fit =
      snapping.isOn() && !event.shiftKey && desk
        ? snapSize({ x: self.offsetLeft, y: self.offsetTop, w, h }, desk, otherWindows(self))
        : { w, h };
    windows.resize(
      id,
      Math.round(Math.max(fit.w, def.minWidth ?? MIN_WIDTH)),
      Math.round(Math.max(fit.h, MIN_HEIGHT)),
    );
  };
  const endGrip = (event: PointerEvent) => {
    if (sizing.current?.pointerId !== event.pointerId) return;
    sizing.current = null;
    windows.settle();
  };

  return (
    <section
      ref={frame}
      class={`window${windows.isOnTop(id) ? ' window--front' : ''}${layout.restore ? ' window--placed' : ''}`}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: height === null ? undefined : `${height}px`,
        // Never taller than the room below its top edge; the contents scroll instead.
        maxHeight: `calc(100% - ${y}px)`,
        zIndex: layout.z,
      }}
      aria-label={name}
      data-tour={id}
      data-desk={layout.desk ?? undefined}
      onPointerDownCapture={() => windows.focus(id)}
    >
      <div
        class="window__title"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDblClick={onTitleDblClick}
      >
        <span class="window__title-text">{name}</span>
        {note && <span class="window__title-note">{note}</span>}
        <span class="window__title-gap" />
        {actions}
        {helpButton}
        <button class="window__close" type="button" aria-label={`Minimize ${name}`} onClick={() => windows.minimize(id)}>
          –
        </button>
        <button class="window__close" type="button" aria-label={`Close ${name}`} onClick={() => windows.close(id)}>
          ×
        </button>
      </div>
      {tabs && (
        <nav class="window__tabs" aria-label={`${name} sections`}>
          {tabs}
        </nav>
      )}
      {help}
      <div class="window__body">{children}</div>
      <div
        class="window__grip"
        title="Drag to resize. Double-click for the usual size."
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={endGrip}
        onPointerCancel={endGrip}
        onDblClick={() => windows.resetSize(id)}
      />
    </section>
  );
}

/** What a window is for: opened by the ? in its title bar, and once by itself the first time the window shows. */
function HelpCard({ id, name, hintsOn }: { id: WindowId; name: string; hintsOn: boolean }) {
  const help = WINDOW_HELP[id];
  return (
    <aside class="window__help" aria-label={`About ${name}`}>
      <p class="window__help-summary">{help.summary}</p>
      <ul class="window__help-points">
        {help.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <div class="window__help-actions">
        {hintsOn && (
          <button type="button" class="window__help-off" onClick={() => {
            hintStore.setOn(false);
            hintStore.closeHelp();
          }}>
            Stop showing these by themselves
          </button>
        )}
        <span class="window__title-gap" />
        <button type="button" class="btn btn--go" onClick={() => hintStore.closeHelp()}>
          Got it
        </button>
      </div>
    </aside>
  );
}
