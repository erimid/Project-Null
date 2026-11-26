# Project NULL

A browser hacking game in the spirit of *Uplink*: take contracts, bounce your
connection around the globe, break in, do the job, and get out before the
trace lands. All point-and-click.

**Play the latest build:** https://erimid.github.io/Project-Null/

## How the code is organised

| Folder | What lives there |
|---|---|
| `src/core/` | The game simulation. Plain TypeScript with no browser code, driven by a seeded random number generator so the same seed always plays out the same way. Unit tested. |
| `src/content/` | Game data as JSON, loaded and checked through `src/content/index.ts`. One file per server in `servers/`. `schema.ts` describes every field. |
| `src/ui/` | Glue between the simulation and the browser: `session.ts` runs the game loop and saving, `hooks.ts` lets screens read game values, `storage/` keeps saves in the browser. |
| `src/ui/title/` | The front door: the title screen over the turning globe, the new-game setup (handle, difficulty, world number), a new career's opening, and `front.ts`, which says whether the title or the desk is up. |
| `src/ui/globe/` | The wireframe globe: projection maths (tested) and the SVG drawing. |
| `src/ui/desktop/` | The desktop layout: server tabs on top (with the contract drop-down), floating windows, bottom bar. `desks.ts` holds the three ready-made desk layouts (Plan, Run, Home). A mobile layout can be added later over the same `core`. |

Rules that keep it tidy:

- `core/` never imports from `ui/` and never touches the DOM. `tsconfig.core.json` checks this.
- Screens never change the game state themselves. They send an action through `session.dispatch`, and the rules live in `src/core/actions.ts`.
- When the shape of the saved game changes, raise `STATE_VERSION` and add a migration in `src/core/save.ts` so old saves still load.
- `core/` never imports the data files. The UI hands them in as a `Content` object, and tests use the small made-up world in `src/core/testWorld.ts`.
- Anything random in `core/` uses `createRng` from `src/core/rng.ts`, never `Math.random()`.
- The sans font (Rajdhani) is for titles, tabs, menus and buttons. The mono font (Share Tech Mono) is only for data.
- Fonts are bundled. The game makes no requests to other sites and has no analytics.

## Commands

```
npm ci             # install
npm run dev        # run locally at http://localhost:5173/Project-Null/
npm test           # unit tests
npm run typecheck  # type checks (UI and the no-DOM check for core)
npm run build      # production build into dist/
npm run build:land # regenerate the globe's continent dots (src/content/land.json)
```

## Deploying

Every merge to `main` runs the tests, builds the game and publishes it to
GitHub Pages (`.github/workflows/deploy.yml`). Pull requests run the tests
and the build without publishing. This needs **Settings › Pages › Source**
set to **GitHub Actions**, and `main` as the repository's default branch.
