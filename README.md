# Project Null

A browser hacking game in the spirit of *Uplink*: take contracts, bounce your
connection around the globe, break in, do the job, and get out before the
trace lands. All point-and-click.

**Play the latest build:** https://erimid.github.io/Project-Null/

## How the code is organised

| Folder | What lives there |
|---|---|
| `src/core/` | The game simulation. Plain TypeScript with no browser code, driven by a seeded random number generator so the same seed always plays out the same way. Unit tested. |
| `src/content/` | Game data as JSON (servers, programs, contracts), loaded and typed through `src/content/index.ts`. |
| `src/ui/desktop/` | The desktop layout: server tabs on top, floating windows, bottom bar. A mobile layout can be added later over the same `core`. |

Rules that keep it tidy:

- `core/` never imports from `ui/` and never touches the DOM. `tsconfig.core.json` checks this.
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
```

## Deploying

Every merge to `main` runs the tests, builds the game and publishes it to
GitHub Pages (`.github/workflows/deploy.yml`). Pull requests run the tests
and the build without publishing. This needs **Settings › Pages › Source**
set to **GitHub Actions**, and `main` as the repository's default branch.
