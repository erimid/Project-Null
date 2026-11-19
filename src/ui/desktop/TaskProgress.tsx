import type { Connection, GameState, Task, TaskTarget } from '../../core';
import { useGame } from '../hooks';

/** The running program working on this target over this connection, if there is one. */
export function findTask(game: GameState, connection: Connection | null, target: TaskTarget): Task | undefined {
  const wanted = JSON.stringify(target);
  return game.tasks.find((task) => task.connectionId === (connection?.id ?? null) && JSON.stringify(task.target) === wanted);
}

/** What a running program is doing, in a few words. */
export function describeTarget(target: TaskTarget): string {
  switch (target.kind) {
    case 'password':
      return `password for ${target.user}`;
    case 'proxy':
      return 'proxy';
    case 'firewall':
      return 'firewall';
    case 'monitor':
      return 'monitor';
    case 'decrypt':
      return 'decrypting';
    case 'copyFile':
      return `copying ${target.file}`;
    case 'deleteFile':
      return `deleting ${target.file}`;
    case 'uploadFile':
      return `uploading ${target.file}`;
    case 'deleteLog':
      return target.logIds.length === 1 ? 'removing a log line' : `removing ${target.logIds.length} log lines`;
    case 'build':
      return 'building';
    case 'decompile':
      return 'decompiling';
    case 'scan':
      return 'scanning';
  }
}

/** A progress bar for one running program. Redraws as the program moves on. */
export function TaskProgress({ taskId, label }: { taskId: string; label: string }) {
  const percent = useGame((game) => {
    const task = game.tasks.find((item) => item.id === taskId);
    return task ? Math.min(100, Math.floor((100 * task.progressMs) / task.durationMs)) : 100;
  });
  return (
    <span class="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span class="progress__fill" style={{ width: `${percent}%` }} />
      <span class="progress__text">
        {label} <span class="data">{percent}%</span>
      </span>
    </span>
  );
}
