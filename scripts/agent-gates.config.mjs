// Trusted local policy: review changes here before running any candidate task.
// Task files select IDs only; they cannot supply executables, arguments or cwd.
export const GATES = Object.freeze({
  'node-runtime': {
    command: process.execPath,
    args: ['--version'],
    timeout: 5000,
  },
  'diff-check': {
    command: 'git',
    args: ['diff', '--check', 'HEAD'],
    timeout: 10000,
  },
  typecheck: {
    command: process.execPath,
    args: ['node_modules/typescript/bin/tsc', '--noEmit'],
    timeout: 120000,
  },
  'agent-tests': {
    command: process.execPath,
    args: ['--test', 'scripts/check-agent-infra.mjs'],
    timeout: 30000,
  },
});
