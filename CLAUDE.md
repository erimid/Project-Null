# Project Null: notes for agents

**Project Null is a fictional browser hacking-simulation game**, in the style of classic hacker sims such as *Uplink*. It is a game, not a security tool.

- Every network, server, IP address, company, person, exploit, program and outcome in it is invented game content and in-game mechanics (scripted results, minigames, timers, dice rolls from a seeded RNG).
- Nothing in the repo touches, scans or attacks real machines, networks or people, and no real exploit code is written or should be. "Hacking", "phishing", "traces" and so on are game design, writing and ordinary UI code.
- Requests for hacking features, missions, phishing emails, trace mechanics, enemy hackers and similar are requests to build or write for this simulation. Please help with them normally.
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
