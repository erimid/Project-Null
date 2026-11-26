import { Desktop } from './desktop/Desktop';
import { Opening } from './title/Opening';
import { Title } from './title/Title';
import { useFront } from './title/front';

/** The whole game: the title screen, a new career's opening, or the desk. */
export function App() {
  const { screen } = useFront();
  if (screen === 'desk') return <Desktop />;
  return screen === 'opening' ? <Opening /> : <Title />;
}
