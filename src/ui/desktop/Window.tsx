import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { useLayout } from './layout';
import { KEEP_VISIBLE, MIN_HEIGHT, MIN_WIDTH, WINDOW_DEFS, windows, useWindows, type WindowId } from './windowStore';

const TITLE_HEIGHT = 40;

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
 * A floating window. Drag it by its title bar; drag its bottom-right
 * corner to resize it (double-click the corner for its usual size);
 * click anywhere on it to bring it to the front. The dash minimizes it
 * to its bottom-bar tab, × closes it.
 */
export function Window({ id, title, note, actions, tabs, children }: Props) {
  const layout = useWindows()[id];
  const def = WINDOW_DEFS[id];
  const frame = useRef<HTMLElement>(null);
  const drag = useRef<Drag | null>(null);
  const sizing = useRef<Drag | null>(null);
  const phone = useLayout() === 'phone';

  if (!layout.open || layout.minimized) return null;
  const name = title ?? def.title;

  // A phone shows only the front window, full screen. The others stay
  // mounted underneath (hidden), so whatever was going on in them is kept.
  if (phone) {
    const front = windows.isOnTop(id);
    return (
      <section class={`window window--phone${front ? ' window--front' : ''}`} hidden={!front} aria-label={name}>
        <div class="window__title">
          <span class="window__title-text">{name}</span>
          {note && <span class="window__title-note">{note}</span>}
          <span class="window__title-gap" />
          {actions}
          <button class="window__close" type="button" aria-label={`Close ${name}`} onClick={() => windows.close(id)}>
            ×
          </button>
        </div>
        {tabs && (
          <nav class="window__tabs" aria-label={`${name} sections`}>
            {tabs}
          </nav>
        )}
        <div class="window__body">{children}</div>
      </section>
    );
  }

  const width = layout.w ?? def.width;
  const clamp = (x: number, y: number): [number, number] => {
    const area = frame.current?.parentElement;
    if (!area) return [x, y];
    return [
      Math.min(Math.max(x, KEEP_VISIBLE - width), area.clientWidth - KEEP_VISIBLE),
      Math.min(Math.max(y, 0), area.clientHeight - TITLE_HEIGHT),
    ];
  };
  // Also applied when drawing, so a window saved on a bigger screen can't be lost off the edge.
  const [x, y] = clamp(layout.x, layout.y);

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    drag.current = { pointerId: event.pointerId, dx: event.clientX - x, dy: event.clientY - y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    windows.move(id, ...clamp(event.clientX - active.dx, event.clientY - active.dy));
  };
  const endDrag = (event: PointerEvent) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    windows.settle();
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
    windows.resize(id, Math.round(w), Math.round(h));
  };
  const endGrip = (event: PointerEvent) => {
    if (sizing.current?.pointerId !== event.pointerId) return;
    sizing.current = null;
    windows.settle();
  };

  return (
    <section
      ref={frame}
      class={`window${windows.isOnTop(id) ? ' window--front' : ''}`}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: layout.h === null ? undefined : `${layout.h}px`,
        // Never taller than the room below its top edge; the contents scroll instead.
        maxHeight: `calc(100% - ${y}px)`,
        zIndex: layout.z,
      }}
      aria-label={name}
      onPointerDownCapture={() => windows.focus(id)}
    >
      <div
        class="window__title"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span class="window__title-text">{name}</span>
        {note && <span class="window__title-note">{note}</span>}
        <span class="window__title-gap" />
        {actions}
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
