import { useGuide } from './guide';

/**
 * Wren's line for the first job: what to press next. The button it means is lit up on the desk.
 * On the desk it sits in the top bar (`bar`), where it covers nothing. On a
 * phone, where the top bar has no room, it floats above the bottom tabs.
 */
export function GuideCard({ bar = false }: { bar?: boolean }) {
  const guide = useGuide();
  if (!guide) return null;
  return (
    <div class={`guide${bar ? ' guide--bar' : ''}`} data-step={guide.id} role="status" aria-live="polite">
      <span class="guide__who">Wren</span>
      <span class="guide__text">{guide.text}</span>
    </div>
  );
}
