/**
 * A way back from broke. A player who keeps being caught pays fines out
 * of small jobs and never climbs. When the money has run out and neither
 * it nor the rating has grown over the last few jobs, the fixer lends a
 * sum, takes a share of each payment until it is square (no interest),
 * and puts one quiet job on the board: a place that will not trace it.
 * Once at each career title.
 */
import type { GameState, Job } from './state';
import { plainJob, touchedServers } from './jobs';
import { stream } from './streams';
import { sendMail, type Content } from './world';

export interface LoanState {
  /** Credits still owed. */
  owed: number;
  /** Titles (as places in the rules' list) a loan has been given at. */
  given: number[];
  /** Balance and rating after each of the last few deliveries, oldest first. */
  marks: { balance: number; rating: number }[];
}

export const newLoan = (): LoanState => ({ owed: 0, given: [], marks: [] });

/** Deliveries looked back over. */
const MARKS = 3;
/** A quiet job stays on the board this long, and pays this many times a plain one. */
export const QUIET_HOURS = 96;
export const QUIET_PAY = 1.5;

const titleAt = (titles: readonly number[], rating: number): number => titles.reduce((best, min, index) => (rating >= min ? index : best), 0);

/** What the fixer would lend at this rating. */
export function loanAmount(content: Content, rating: number): number {
  const rules = content.rules.loan;
  return rules ? Math.round((rules.base + rules.perRating * rating) / 100) * 100 : 0;
}

/** Puts the quiet job on the board: the easiest company nobody else is working, untraced for this job. */
function postQuiet(state: GameState, content: Content): Job | undefined {
  const rng = stream(state, 'loan');
  const busy = touchedServers(state);
  const free = rng.shuffle(content.servers.filter((server) => server.generated && !busy.has(server.id)));
  const easiest = [...free].sort((a, b) => a.generated!.tier - b.generated!.tier);
  for (const server of easiest.slice(0, 8)) {
    const plain = plainJob(state, content, server, rng, ['steal', 'record']);
    if (!plain) continue;
    const job: Job = {
      ...plain.job,
      title: `Quiet work: ${plain.job.title}`,
      client: 'Wren',
      pay: Math.round((plain.job.pay * QUIET_PAY) / 50) * 50,
      expiresMs: state.clock.gameTimeMs + QUIET_HOURS * 3_600_000,
      quiet: true,
    };
    state.contracts.jobs.push(job);
    return job;
  }
  return undefined;
}

/**
 * Call after a fine has been taken. Lends once the money is gone and the
 * last few jobs have not left the player richer or better known.
 */
export function maybeLend(state: GameState, content: Content): void {
  const rules = content.rules.loan;
  const loan = state.loan;
  if (!rules || loan.owed > 0 || loan.marks.length < MARKS) return;
  const title = titleAt(rules.titles, state.player.rating);
  if (loan.given.includes(title)) return;
  const then = loan.marks[0]!;
  const { balance, rating } = state.player;
  if (balance >= rules.below || balance > then.balance || rating > then.rating) return;
  const amount = loanAmount(content, rating);
  state.player.balance += amount;
  loan.owed = amount;
  loan.given.push(title);
  const job = postQuiet(state, content);
  sendMail(state, content, 'loan', {
    amount: amount.toLocaleString('en-US'),
    share: String(Math.round(rules.repayShare * 100)),
    quiet: job ? `There is also a job on the board under my name, "${job.title}". Nobody at that place is watching this week. I made sure. Take your time over it.` : 'I have no quiet work to give you this week. Pick small jobs and use every relay you have.',
  });
}

/**
 * Call when a contract pays, after the pay is in the account. Takes the
 * fixer's share while anything is owed, and keeps the marks the next
 * offer is judged on. Returns what was taken.
 */
export function repayLoan(state: GameState, content: Content, pay: number): number {
  const loan = state.loan;
  const rules = content.rules.loan;
  let taken = 0;
  if (rules && loan.owed > 0) {
    taken = Math.min(loan.owed, state.player.balance, Math.round(pay * rules.repayShare));
    state.player.balance -= taken;
    loan.owed -= taken;
    if (loan.owed <= 0) {
      loan.owed = 0;
      sendMail(state, content, 'loanSquare');
    }
  }
  loan.marks.push({ balance: state.player.balance, rating: state.player.rating });
  if (loan.marks.length > MARKS) loan.marks.shift();
  return taken;
}

/** True while the job in hand is the fixer's quiet job and this is its server: nobody there traces it. */
export function quietTarget(state: GameState, serverId: string): boolean {
  const id = state.contracts?.activeId ?? null;
  if (id === null) return false;
  const job = state.contracts.jobs.find((item) => item.id === id);
  return job?.quiet === true && job.targetId === serverId;
}
