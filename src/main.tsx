import { render } from 'preact';

// Fonts are bundled with the game, so no request goes to a font service.
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/share-tech-mono/latin-400.css';

import './ui/desktop/theme.css';
import { App } from './ui/App';
import { comfort } from './ui/desktop/comfortStore';
import { look } from './ui/desktop/lookStore';
import { recordStore } from './ui/desktop/recordStore';
import { session } from './ui/session';
import { front } from './ui/title/front';
import { backups } from './ui/storage/backupStore';
import { install } from './ui/installStore';
import { startMusic } from './ui/music';
import { startSfx } from './ui/sfx';

// While developing, the running game can be reached from the browser's console and from browser tests. Not in the built game.
if (import.meta.env.DEV) Object.assign(window, { __session: session, __look: look, __front: front });

// The chosen colour theme goes on before anything is drawn.
look.start();
comfort.start();
// Offline play and the install offer (the worker is registered in the built game only).
install.start();

// Load the last game (if there is one) before drawing the title screen.
void session.start().then(() => {
  recordStore.start();
  void backups.check();
  startSfx();
  startMusic();
  render(<App />, document.getElementById('app')!);
});
