import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { GATES } from './agent-gates.config.mjs';
import { ROOT, cli, ensure, loadTask, validateTask } from './agent-task.mjs';

export function runGates(
  task,
  { failFast = true, execute = execFileSync } = {},
) {
  validateTask(task); // Validate every ID before executing even the first gate.
  ensure(typeof failFast === 'boolean', 'failFast must be boolean');
  const start = performance.now();
  const results = [];
  const skipped = [];
  for (const id of task.gates) {
    if (failFast && results.some((gate) => gate.status === 'FAIL')) {
      skipped.push(id);
      continue;
    }
    const gate = GATES[id];
    const gateStart = performance.now();
    let exitCode = 0,
      stdout = '',
      stderr = '',
      error = null;
    try {
      stdout = execute(gate.command, gate.args, {
        cwd: ROOT,
        shell: false,
        windowsHide: true,
        encoding: 'utf8',
        timeout: gate.timeout,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (failure) {
      exitCode =
        Number.isInteger(failure.status) && failure.status !== 0
          ? failure.status
          : 1;
      stdout = String(failure.stdout ?? '');
      stderr = String(failure.stderr ?? '');
      error = failure.code ?? failure.message;
    }
    results.push({
      id,
      status: exitCode === 0 ? 'PASS' : 'FAIL',
      exitCode,
      durationMs: Math.round(performance.now() - gateStart),
      stdout,
      stderr,
      error,
    });
  }
  const exitCode = results.some((gate) => gate.status === 'FAIL') ? 1 : 0;
  return {
    taskId: task.id,
    status: exitCode === 0 ? 'PASS' : 'FAIL',
    exitCode,
    durationMs: Math.round(performance.now() - start),
    failFast,
    results,
    skipped,
  };
}

cli(import.meta.url, (args) => {
  ensure(
    args.length >= 1 &&
      args.length <= 2 &&
      (args.length === 1 || args[1] === '--no-fail-fast'),
    'Usage: node scripts/agent-gate.mjs <task> [--no-fail-fast]',
  );
  const summary = runGates(loadTask(args[0]), { failFast: args.length === 1 });
  for (const gate of summary.results)
    console.error(
      `${gate.status} ${gate.id} exit=${gate.exitCode} ${gate.durationMs}ms`,
    );
  for (const id of summary.skipped) console.error(`SKIP ${id}`);
  console.error(
    `${summary.status} ${summary.taskId} exit=${summary.exitCode} ${summary.durationMs}ms`,
  );
  return summary;
});
