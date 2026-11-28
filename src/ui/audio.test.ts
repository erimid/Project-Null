import { describe, expect, it } from 'vitest';
import { SOUND_DEFAULTS, readSoundSettings } from './audio';

describe('sound settings', () => {
  it('fall back to the defaults when nothing usable was saved', () => {
    expect(readSoundSettings(null)).toEqual(SOUND_DEFAULTS);
    expect(readSoundSettings('loud')).toEqual(SOUND_DEFAULTS);
    expect(readSoundSettings({ on: true, volume: 7 })).toEqual(SOUND_DEFAULTS);
  });

  it('keep what an older version saved and fill in the levels it did not know', () => {
    expect(readSoundSettings({ on: false, volume: 0.3 })).toEqual({ ...SOUND_DEFAULTS, on: false, volume: 0.3 });
    expect(readSoundSettings({ on: true, volume: 0.3, music: false, musicVolume: 0.9 })).toEqual({
      ...SOUND_DEFAULTS,
      volume: 0.3,
      music: false,
      musicVolume: 0.9,
    });
  });

  it('read every level back, and ignore one that is out of range', () => {
    const saved = { on: true, volume: 1, music: true, musicVolume: 0, effectsVolume: 0.25, ambientVolume: 1 };
    expect(readSoundSettings(saved)).toEqual(saved);
    expect(readSoundSettings({ ...saved, effectsVolume: 3 }).effectsVolume).toBe(SOUND_DEFAULTS.effectsVolume);
  });
});
