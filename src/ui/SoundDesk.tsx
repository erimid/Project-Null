/**
 * The parts of the sound settings that the game menu and the title
 * screen share: the effects level, and a list of every sound to press
 * and hear.
 */
import { useState } from 'preact/hooks';
import { sound, useSound } from './audio';
import { SOUND_TEST } from './sfx';
import './sounddesk.css';

/** The effects slider: beeps, alarms and clicks, against the music. */
export function EffectsLevel() {
  const heard = useSound();
  return (
    <label class="sounddesk__level">
      <span class="sounddesk__name">Effects</span>
      <input
        type="range"
        min="0"
        max="100"
        aria-label="Effects volume"
        value={Math.round(heard.effectsVolume * 100)}
        disabled={!heard.on}
        onInput={(event) => sound.set({ effectsVolume: Number((event.currentTarget as HTMLInputElement).value) / 100 })}
      />
    </label>
  );
}

const GROUPS = [...new Set(SOUND_TEST.map((entry) => entry.group))];

/** Every sound by name. Closed until asked for: it is a long list. */
export function SoundTest() {
  const heard = useSound();
  const [open, setOpen] = useState(false);
  return (
    <div class="sounddesk__test">
      <button type="button" class="btn" aria-expanded={open} data-sound-test onClick={() => setOpen(!open)}>
        {open ? 'Hide sound test' : 'Sound test'}
      </button>
      {open && (
        <div class="sounddesk__list">
          {!heard.on && <p class="sounddesk__note">Sound is off.</p>}
          {GROUPS.map((group) => (
            <div key={group} class="sounddesk__group" role="group" aria-label={group}>
              <h4 class="sounddesk__heading">{group}</h4>
              <div class="sounddesk__buttons">
                {SOUND_TEST.filter((entry) => entry.group === group).map((entry) => (
                  <button key={entry.label} type="button" class="sounddesk__play" disabled={!heard.on} onClick={entry.play}>
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
