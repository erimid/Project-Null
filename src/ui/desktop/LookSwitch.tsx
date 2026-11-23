import { useEffect, useRef, useState } from 'preact/hooks';
import { useLayout } from './layout';
import { DESIGNS, look, useLook } from './lookStore';
import { THEMES, themeById } from './themes';

/**
 * The test bar: a thin strip across the top of the screen for trying the
 * desk designs and colour themes against each other. One press swaps the
 * design; the arrows step through the themes, and the theme's name opens
 * all twenty. The game menu (Look) hides the bar and brings it back.
 */
export function LookSwitch() {
  const now = useLook();
  const desk = useLayout() === 'desk';
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.shiftKey) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!now.bar) return null;
  const theme = themeById(now.theme);
  const design = DESIGNS.find((candidate) => candidate.id === now.design) ?? DESIGNS[0]!;

  return (
    <div class="lookbar" ref={root} role="region" aria-label="Design and theme test bar">
      <span class="lookbar__tag">Test</span>
      {desk && (
        <div class="lookbar__group" role="group" aria-label="Desk design">
          <span class="lookbar__label">Design</span>
          {DESIGNS.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              class={`lookbar__btn${candidate.id === now.design ? ' is-on' : ''}`}
              aria-pressed={candidate.id === now.design}
              title={`${candidate.name}: ${candidate.note}`}
              onClick={() => look.setDesign(candidate.id)}
            >
              {candidate.id === 'classic' ? 'Classic' : candidate.key}
            </button>
          ))}
          <span class="lookbar__name">{design.id === 'classic' ? design.note : `${design.name}: ${design.note}`}</span>
        </div>
      )}
      <span class="lookbar__gap" />
      <div class="lookbar__group" role="group" aria-label="Colour theme">
        <span class="lookbar__label">Theme</span>
        <button type="button" class="lookbar__btn" aria-label="Previous theme" onClick={() => look.nextTheme(-1)}>
          ‹
        </button>
        <button type="button" class={`lookbar__btn lookbar__theme${open ? ' is-on' : ''}`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
          <Swatches id={theme.id} />
          {theme.name}
          <span class="lookbar__count data">
            {THEMES.indexOf(theme) + 1}/{THEMES.length}
          </span>
        </button>
        <button type="button" class="lookbar__btn" aria-label="Next theme" onClick={() => look.nextTheme(1)}>
          ›
        </button>
      </div>
      <button type="button" class="lookbar__btn lookbar__hide" title="Hide this bar. The game menu (Look) brings it back." onClick={() => look.setBar(false)}>
        Hide
      </button>
      {open && (
        <div class="lookpanel" role="group" aria-label="All colour themes">
          {THEMES.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              class={`lookpanel__theme${candidate.id === now.theme ? ' is-on' : ''}`}
              aria-pressed={candidate.id === now.theme}
              style={{ background: candidate.panel, color: candidate.text, borderColor: candidate.id === now.theme ? candidate.accent : 'transparent' }}
              onClick={() => look.setTheme(candidate.id)}
            >
              <Swatches id={candidate.id} />
              <span class="lookpanel__name" style={{ color: candidate.accent }}>
                {candidate.name}
              </span>
              <span class="lookpanel__note">{candidate.note}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A theme at a glance: its desk, accent, good, warning and alarm colours. */
function Swatches({ id }: { id: string }) {
  const theme = themeById(id);
  return (
    <span class="swatches" aria-hidden="true">
      {[theme.bg, theme.accent, theme.good, theme.warn, theme.alarm].map((colour, index) => (
        <i key={index} style={{ background: colour }} />
      ))}
    </span>
  );
}
