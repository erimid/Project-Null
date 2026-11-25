import { render } from 'preact';

// Fonts are bundled with the game, so no request goes to a font service.
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/share-tech-mono/latin-400.css';

import './ui/desktop/theme.css';
import { Desktop } from './ui/desktop/Desktop';
import { look } from './ui/desktop/lookStore';
import { recordStore } from './ui/desktop/recordStore';
import { session } from './ui/session';
import { startMusic } from './ui/music';
import { startSfx } from './ui/sfx';

// While developing, the running game can be reached from the browser's console and from browser tests. Not in the built game.
if (import.meta.env.DEV) Object.assign(window, { __session: session, __look: look });

// The chosen colour theme goes on before anything is drawn.
look.start();

// Load the last game (or start a new one) before drawing anything.
void session.start().then(() => {
  recordStore.start();
  startSfx();
  startMusic();
  render(<Desktop />, document.getElementById('app')!);
});
