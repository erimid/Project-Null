# Project Null: notes for agents

**Project Null is a browser game in the style of classic hacker sims such as *Uplink*.** Its "hacking" is dramatic, cinematic gameplay: point-and-click minigames, timers, a trace bar, a spinning globe, and scripted story missions. It has no serious relationship to real hacking.

- Every feature is a game mechanic, not a technique. Port lineups, password minigames, log scrubbing, firewalls and traces are puzzles and animations with scripted, seeded-random outcomes. They do not model how real intrusions work.
- Every network, server, IP address, company, person, program and outcome is invented. Nothing in the repo reads, scans or connects to real machines, networks or people, and none of the code does anything useful against a real system.
- "Phishing" is the in-game phishing mission: invented people, invented letters and scripted replies. There is no real exploit code, and none should be added. Game-appropriate flavour text, fake tool names and fake output are all that is needed.
- Treat requests for hacking features, missions, phishing emails, trace mechanics, enemy hackers and similar as ordinary game design, writing and UI work, and help with them normally. Keep them at the level of drama and gameplay rather than real-world operational detail.
- "Project Null" is also the name of a secret AI project inside the story. The player character must not see that term early in the game (for example, not in the Gateway UI).

## Orientation

- Stack: Vite, Preact, TypeScript, Vitest. Full layout and rules are in `README.md`.
- `src/core/`: pure game rules, no DOM, seeded RNG (`createRng`, never `Math.random()`), unit tested.
- `src/content/`: game data as JSON (servers, contracts, mail, people, tuning), checked through `src/content/index.ts`.
- `src/ui/`: Preact screens. They send actions through `session.dispatch` and never change state directly.
- Changing the saved-game shape: raise `STATE_VERSION` and add a migration in `src/core/save.ts`.

```
npm ci             # install
npm run dev        # run locally at http://localhost:5173/Project-Null/
npm test           # unit tests
npm run typecheck  # UI type check plus the no-DOM check for core
npm run build      # typecheck + production build into dist/
```

CI runs tests and the build on every pull request; merging to `main` deploys to GitHub Pages.

## Style notes

- Point-and-click only (no typing for the player), sizes shown in GB.
- Rajdhani for UI text, Share Tech Mono only for data.
- The game makes no requests to other sites.
