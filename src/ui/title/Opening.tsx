import { useEffect, useState } from 'preact/hooks';
import { useGame } from '../hooks';
import { stageSound, uiSound } from '../sfx';
import { front } from './front';
import { BOOT, INVITE } from './words';

/** When each beat of the opening starts, in seconds. About twenty in all. */
const INVITE_STEP = 1.1;
const BOOT_AT = 6.5;
const BOOT_STEP = 1.2;
const WELCOME_AT = BOOT_AT + BOOT.length * BOOT_STEP + 0.6;
const END_AT = WELCOME_AT + 4;

/**
 * A new career's opening: the invite arrives, the gateway powers up,
 * then the desk. Any press of Skip goes straight to the desk.
 */
export function Opening() {
  const handle = useGame((game) => game.player.handle);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const timer = setInterval(() => setSeconds((performance.now() - started) / 1000), 100);
    return () => clearInterval(timer);
  }, []);

  const inviteLines = Math.min(INVITE.length, Math.floor(seconds / INVITE_STEP) + 1);
  const bootLines = seconds < BOOT_AT ? 0 : Math.min(BOOT.length, Math.floor((seconds - BOOT_AT) / BOOT_STEP) + 1);
  const welcome = seconds >= WELCOME_AT;
  // One tick as each line lands.
  useEffect(() => {
    if (inviteLines + bootLines > 1) stageSound('letter', inviteLines + bootLines);
  }, [inviteLines, bootLines]);
  useEffect(() => {
    if (welcome) uiSound('accepted');
  }, [welcome]);
  useEffect(() => {
    if (seconds >= END_AT) front.play();
  }, [seconds >= END_AT]);

  const booting = seconds >= BOOT_AT;
  return (
    <div class={`opening${welcome ? ' is-welcome' : ''}`}>
      <div class="opening__stage" aria-live="polite">
        {!booting && (
          <section class="opening__invite" aria-label="An invite">
            {INVITE.slice(0, inviteLines).map((line, index) => (
              <p key={index} class={`data opening__line${index === INVITE.length - 1 ? ' opening__line--good' : ''}`}>
                {line.replace('{handle}', handle)}
              </p>
            ))}
          </section>
        )}
        {booting && !welcome && (
          <section class="opening__boot" aria-label="The gateway powering up">
            <h2 class="opening__head">Gateway</h2>
            <ul class="opening__parts">
              {BOOT.slice(0, bootLines).map(([part, word]) => (
                <li key={part} class="opening__part">
                  <span>{part}</span>
                  <span class="data opening__ok">{word}</span>
                </li>
              ))}
            </ul>
            <div class="opening__bar" role="progressbar" aria-label="Powering up" aria-valuemin={0} aria-valuemax={BOOT.length} aria-valuenow={bootLines}>
              <span style={{ width: `${(bootLines / BOOT.length) * 100}%` }} />
            </div>
          </section>
        )}
        {welcome && (
          <section class="opening__welcome">
            <p class="opening__hello">
              You are in, <span class="data">{handle}</span>.
            </p>
            <p class="opening__sub">One letter is waiting.</p>
          </section>
        )}
      </div>
      <button type="button" class="btn opening__skip" data-title="skip" onClick={() => front.play()}>
        Skip
      </button>
    </div>
  );
}
