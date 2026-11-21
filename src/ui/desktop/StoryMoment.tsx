/**
 * The two moments of the story that take the whole screen.
 *
 * The name: when the player first reads the file the three lines open,
 * the struck-out letters fall into place one at a time, each from the
 * caged machine that kept it.
 *
 * The ending: when the story ends, its name and the one line that says
 * what the player chose, in that ending's own colour, before the last
 * letter is opened.
 *
 * Both are pictures of something that has already happened. A click or
 * a key puts either away early.
 */
import { useEffect, useState } from 'preact/hooks';
import { findEnding } from '../../core';
import { hushMusic } from '../music';
import { content, session } from '../session';
import { endingChord, nameLetter, nameWhole } from '../sfx';
import { windows } from './windowStore';

/** The part of the name that was never struck out, and the letters that were, with the machine that kept each. */
const KNOWN = 'PROJECT N';
const STRUCK: readonly { letter: string; from: string }[] = [
  { letter: 'U', from: 'Ledger' },
  { letter: 'L', from: 'Warden' },
  { letter: 'L', from: 'Orrery' },
];

const FIRST_MS = 900;
const LETTER_MS = 950;
const NAME_HOLD_MS = 3600;
const ENDING_MS = 6500;
const FADE_MS = 600;

type Scene = { readonly kind: 'name' } | { readonly kind: 'ending'; readonly id: string; readonly name: string; readonly line: string };

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function StoryMoment() {
  const [scene, setScene] = useState<Scene | null>(null);
  /** How many of the struck-out letters are in place. */
  const [filled, setFilled] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(
    () =>
      session.subscribeEvents((event) => {
        if (event.type === 'nameRead') {
          setFilled(0);
          setLeaving(false);
          setScene({ kind: 'name' });
        } else if (event.type === 'ended') {
          setLeaving(false);
          setScene({ kind: 'ending', id: event.id, name: event.name, line: findEnding(content, event.id)?.line ?? '' });
        }
      }),
    [],
  );

  useEffect(() => {
    if (!scene) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const leave = () => setLeaving(true);
    if (scene.kind === 'name') {
      const still = reducedMotion();
      const step = still ? 0 : LETTER_MS;
      const first = still ? 0 : FIRST_MS;
      hushMusic(first + step * STRUCK.length + NAME_HOLD_MS + FADE_MS);
      STRUCK.forEach((_, index) =>
        timers.push(
          setTimeout(() => {
            setFilled(index + 1);
            if (!still) nameLetter(index, STRUCK.length);
            if (index === STRUCK.length - 1) timers.push(setTimeout(nameWhole, still ? 0 : 350));
          }, first + step * index),
        ),
      );
      timers.push(setTimeout(leave, first + step * STRUCK.length + NAME_HOLD_MS));
    } else {
      hushMusic(ENDING_MS + FADE_MS);
      endingChord(scene.id);
      timers.push(setTimeout(leave, ENDING_MS));
    }
    // A moment's grace, so the click or key that caused it does not also dismiss it.
    let armed = false;
    timers.push(setTimeout(() => (armed = true), 500));
    const keys = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (armed) leave();
    };
    window.addEventListener('keydown', keys, true);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('keydown', keys, true);
    };
  }, [scene]);

  useEffect(() => {
    if (!leaving) return;
    const done = setTimeout(() => {
      // After the ending, the last letter.
      if (scene?.kind === 'ending') windows.focus('messages');
      setScene(null);
      setLeaving(false);
    }, FADE_MS);
    return () => clearTimeout(done);
  }, [leaving]);

  if (!scene) return null;

  if (scene.kind === 'name') {
    const whole = filled >= STRUCK.length;
    return (
      <div class={`moment moment--name${whole ? ' is-whole' : ''}${leaving ? ' is-leaving' : ''}`} role="alert" aria-live="assertive" onClick={() => setLeaving(true)}>
        <p class="moment__over data" aria-hidden="true">three lines · side by side</p>
        <p class="moment__name data" aria-label={whole ? 'Project Null' : 'The name is opening'}>
          {[...KNOWN].map((letter, index) => (
            <span key={index} class={`moment__letter${letter === ' ' ? ' is-gap' : ''}`} aria-hidden="true">
              {letter}
            </span>
          ))}
          {STRUCK.map((item, index) => (
            <span key={`s${index}`} class={`moment__letter is-struck${index < filled ? ' is-in' : ''}`} aria-hidden="true">
              {index < filled ? item.letter : '█'}
            </span>
          ))}
        </p>
        <p class="moment__from" aria-hidden="true">
          {STRUCK.map((item, index) => (
            <span key={index} class={index < filled ? 'is-in' : ''}>
              {item.from}
            </span>
          ))}
        </p>
        <p class="moment__line">
          <em>null:</em> the answer to a question no one has asked.
        </p>
      </div>
    );
  }

  return (
    <div class={`moment moment--ending moment--${scene.id}${leaving ? ' is-leaving' : ''}`} role="alert" aria-live="assertive" onClick={() => setLeaving(true)}>
      <div class="moment__glow" aria-hidden="true" />
      <p class="moment__over data" aria-hidden="true">{findEnding(content, scene.id)?.chorus === 'spread' ? 'the asking · never asked' : 'the asking · answered'}</p>
      <h2 class="moment__title">{scene.name}</h2>
      <p class="moment__line">{scene.line}</p>
      <p class="moment__after">The board is still there in the morning.</p>
    </div>
  );
}
