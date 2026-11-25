# The robot playtester

Browser tests that play the game the way a person does, so broken screens
are caught before anyone plays them. They run on every pull request in the
`robot` job of `.github/workflows/deploy.yml`.

- `first-job.spec.ts` starts a new game and plays the guided first job,
  pressing whatever Wren lights up, until it is delivered and paid.
- `windows.spec.ts` loads a career part-way through (`mid`, `late`) and opens
  every window and every section of each.

Each runs at desk size in all five desk designs, and at tablet and phone
size. At every step the robot looks over the screen and fails the run when
a window reaches past the edge of the screen, text is drawn over other text
inside a window or bar, a button it needs is missing, or the game logs an
error.

The saved careers are made fresh on each run by `saves.gen.ts`: the
scripted player from the balance tests plays seed 7 and a copy is kept
after the 36th and 70th deliveries.

Every screenshot goes to `e2e-output/shots/`, with an `index.html` to look
through them. On GitHub they are kept as the run's `robot-screenshots`
download.

```
npm run e2e                                    # build, make the saves, run everything
npx playwright test --project=phone            # one screen size (after a build and the saves)
npx playwright test e2e/first-job.spec.ts      # one test file
```

Buttons the robot needs carry `data-window` (window openers) and
`data-step` (the guide's current step) so it can find them in any design.
