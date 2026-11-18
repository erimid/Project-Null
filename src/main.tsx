import { render } from 'preact';

// Fonts are bundled with the game, so no request goes to a font service.
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/share-tech-mono/latin-400.css';

import './ui/desktop/theme.css';
import { Desktop } from './ui/desktop/Desktop';

render(<Desktop />, document.getElementById('app')!);
