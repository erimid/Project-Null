/**
 * The parts of the sound settings that the game menu and the title
 * screen share: the effects level, and a list of every sound to press
 * and hear.
 */
import { useState } from 'preact/hooks';
import { sound, useSound } from './audio';
import { SOUND_TEST } from './sfx';
import './sounddesk.css';

function Level({ name, label, value, tip, onChange }: { name: string; label: string; value: number; tip: string; onChange: (value: number) => void }) {
  const heard = useSound();
  return (
    <label class="sounddesk__level" data-tip={tip}>
      <span class="sounddesk__name">{name}</span>
      <input
        type="range"
        min="0"
        max="100"
        aria-label={label}
        value={Math.round(value * 100)}
        disabled={!heard.on}
        onInput={(event) => onChange(Number((event.currentTarget as HTMLInputElement).value) / 100)}
      />
    </label>
  );
}

/** The two levels under the main volume that sit beside the music: effects and the background. */
export function SoundLevels() {
  const heard = useSound();
  return (
    <>
      <Level name="Effects" label="Effects volume" value={heard.effectsVolume} tip="Beeps, alarms and clicks" onChange={(effectsVolume) => sound.set({ effectsVolume })} />
      <Level
        name="Background"
        label="Background volume"
        value={heard.ambientVolume}
        tip="The room at home, and the hum of the machine you are connected to"
        onChange={(ambientVolume) => sound.set({ ambientVolume })}
      />
    </>
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
