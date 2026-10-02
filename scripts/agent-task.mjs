import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GATES } from './agent-gates.config.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const STATES = [
  'APPROVED',
  'ANALYSIS',
  'IMPLEMENTATION',
  'DETERMINISTIC_GATE',
  'LLM_QA',
  'READY_FOR_APPROVAL',
  'GATE_FAIL',
  'QA_FAIL',
  'RETRY',
  'NEEDS_DECISION',
  'HUMAN',
];
const fields = [
  'id',
  'title',
  'type',
  'mode',
  'objective',
  'constraints',
  'protectedPaths',
  'allowedPaths',
  'inputs',
  'acceptanceCriteria',
  'gates',
  'implementer',
  'reviewer',
  'retryCount',
  'maxRetries',
  'status',
  'result',
  'humanDecisionRequired',
];
export function ensure(condition, message) {
  if (!condition) throw new Error(message);
}
const string = (value) => typeof value === 'string' && value.trim().length > 0;
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const overlaps = (a, b) =>
  a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
const windowsDeviceName = (value) =>
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(value);
function relativePath(value) {
  return (
    string(value) &&
    value
      .split('/')
      .every(
        (part) =>
          /^[a-zA-Z0-9_.-]+$/.test(part) &&
          !['.', '..'].includes(part) &&
          !part.endsWith('.') &&
          !windowsDeviceName(part),
      )
  );
}
const forbidden = (value) =>
  value
    .split('/')
    .some(
      (part) =>
        /^(\.git|\.fanaticotas|backups|credentials)$/i.test(part) ||
        /^\.env(?:\.|$)/i.test(part),
    );

export function validateTask(task) {
  ensure(object(task), 'Task must be an object');
  ensure(
    Object.keys(task).length === fields.length &&
      fields.every((key) => Object.hasOwn(task, key)),
    'Missing or unknown task fields',
  );
  for (const key of ['id', 'title', 'type', 'objective'])
    ensure(string(task[key]), `Invalid ${key}`);
  ensure(
    /^[A-Z][A-Z0-9]*-\d{4}$/.test(task.id) && !windowsDeviceName(task.id),
    'Invalid task id',
  );
  ensure(['read-only', 'write'].includes(task.mode), 'Invalid mode');
  ensure(STATES.includes(task.status), 'Invalid status');
  ensure(
    task.status !== (task.mode === 'read-only' ? 'IMPLEMENTATION' : 'ANALYSIS'),
    'Status conflicts with mode',
  );
  for (const key of [
    'constraints',
    'protectedPaths',
    'allowedPaths',
    'inputs',
    'acceptanceCriteria',
    'gates',
  ]) {
    ensure(
      Array.isArray(task[key]) && task[key].every(string),
      `Invalid ${key}`,
    );
    ensure(new Set(task[key]).size === task[key].length, `Duplicate ${key}`);
    if (key !== 'allowedPaths') ensure(task[key].length > 0, `Empty ${key}`);
  }
  for (const key of ['protectedPaths', 'allowedPaths', 'inputs']) {
    ensure(task[key].every(relativePath), `Invalid relative paths in ${key}`);
  }
  for (const required of [
    '.git',
    '.fanaticotas',
    '.env',
    'backups',
    'credentials',
  ]) {
    ensure(
      task.protectedPaths.includes(required),
      `Missing protected path: ${required}`,
    );
  }
  ensure(
    task.allowedPaths.every(
      (allowed) =>
        !forbidden(allowed) &&
        !task.protectedPaths.some((protectedPath) =>
          overlaps(allowed.toLowerCase(), protectedPath.toLowerCase()),
        ),
    ),
    'Allowed/protected paths overlap',
  );
  ensure(
    task.inputs.every((input) => !forbidden(input)),
    'Forbidden input path',
  );
  ensure(
    task.mode === 'read-only'
      ? task.allowedPaths.length === 0
      : task.allowedPaths.length > 0,
    'Read-only requires no write paths; write requires explicit paths',
  );
  ensure(
    task.gates.every((id) => Object.hasOwn(GATES, id)),
    'Unknown gate ID (commands are not accepted)',
  );
  for (const key of ['implementer', 'reviewer']) {
    const agent = task[key];
    ensure(
      object(agent) &&
        Object.keys(agent).length === 3 &&
        ['adapter', 'model', 'session'].every((field) =>
          Object.hasOwn(agent, field),
        ),
      `Invalid ${key}`,
    );
    ensure(
      /^[A-Za-z][A-Za-z0-9_-]*$/.test(agent.adapter) &&
        agent.session === 'new',
      `${key} requires an adapter identifier and a new session`,
    );
    ensure(agent.model === null || string(agent.model), `Invalid ${key} model`);
  }
  ensure(
    Number.isInteger(task.maxRetries) &&
      task.maxRetries >= 0 &&
      task.maxRetries <= 2,
    'maxRetries must be 0..2',
  );
  ensure(
    Number.isInteger(task.retryCount) &&
      task.retryCount >= 0 &&
      task.retryCount <= task.maxRetries,
    'Invalid retryCount',
  );
  ensure(
    task.result === null || string(task.result),
    'result must be null or an inline report string',
  );
  ensure(
    typeof task.humanDecisionRequired === 'boolean',
    'Invalid humanDecisionRequired',
  );
  ensure(
    !['HUMAN', 'NEEDS_DECISION'].includes(task.status) ||
      task.humanDecisionRequired,
    'Human state requires humanDecisionRequired',
  );
  return task;
}

// A transport supplies data to validateTask; only this loader touches task files.
export function loadTask(filename) {
  ensure(
    typeof filename === 'string' &&
      /^\.agent-tasks\/[A-Za-z0-9][A-Za-z0-9_-]*\.json$/.test(filename) &&
      relativePath(filename),
    'Use .agent-tasks/<name>.json inside this worktree',
  );
  const directory = lstatSync(path.join(ROOT, '.agent-tasks'));
  ensure(
    directory.isDirectory() && !directory.isSymbolicLink(),
    'Task directory cannot be a link',
  );
  const target = path.join(ROOT, filename);
  const stat = lstatSync(target);
  ensure(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536,
    'Task must be a regular JSON file <=64 KiB, without links',
  );
  return validateInitialTask(JSON.parse(readFileSync(target, 'utf8')));
}

// Local JSON files are definitions, never trusted runtime-state snapshots.
export function validateInitialTask(task) {
  validateTask(task);
  ensure(
    task.status === 'APPROVED',
    'Local dispatch requires initial APPROVED status',
  );
  ensure(task.retryCount === 0, 'Local dispatch requires retryCount 0');
  ensure(task.result === null, 'Local dispatch requires result null');
  ensure(
    task.humanDecisionRequired === false,
    'Local dispatch requires humanDecisionRequired false',
  );
  return task;
}

// stdout is always JSON; human diagnostics go to stderr. Invalid input exits 2.
export function cli(url, action) {
  if (
    !process.argv[1] ||
    pathToFileURL(path.resolve(process.argv[1])).href !== url
  )
    return;
  try {
    const result = action(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.exitCode ?? 0;
  } catch (error) {
    console.error(error.message);
    console.log(
      JSON.stringify({ status: 'ERROR', exitCode: 2, error: error.message }),
    );
    process.exitCode = 2;
  }
}
cli(import.meta.url, (args) => {
  ensure(
    args.length === 1,
    'Usage: node scripts/agent-task.mjs .agent-tasks/<name>.json',
  );
  const task = loadTask(args[0]);
  console.error(`VALID ${task.id}`);
  return { status: 'VALID', taskId: task.id, exitCode: 0 };
});
