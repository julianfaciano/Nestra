import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  ROOT,
  loadTask,
  validateInitialTask,
  validateTask,
} from './agent-task.mjs';
import { dryRun, startDispatch, transition } from './agent-dispatch.mjs';
import { runGates } from './agent-gate.mjs';
import {
  ADAPTERS,
  codexAdapter,
  resolveAdapter,
} from './agent-adapters.mjs';

const example = '.agent-tasks/EXAMPLE-0000.json';
const pilot = '.agent-tasks/NES-0001.json';
const task = (changes = {}) => ({ ...loadTask(example), ...changes });
const cli = (script, ...args) =>
  spawnSync(process.execPath, [`scripts/${script}`, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  });

test('local definitions validate and the pilot remains read-only', () => {
  for (const filename of [example, pilot])
    assert.doesNotThrow(() => loadTask(filename));
  assert.equal(loadTask(pilot).mode, 'read-only');
  assert.deepEqual(loadTask(pilot).allowedPaths, []);
  assert.doesNotThrow(() => validateInitialTask(loadTask(pilot)));
});

test('dispatch rejects forged initial states and derives READY only from APPROVED', () => {
  for (const [index, status] of ['LLM_QA', 'READY_FOR_APPROVAL'].entries()) {
    const forged = task({ status });
    const filename = `.agent-tasks/forged-${process.pid}-${index}.json`;
    const target = path.join(ROOT, filename);
    writeFileSync(target, JSON.stringify(forged), { flag: 'wx' });
    try {
      assert.throws(() => loadTask(filename), /initial APPROVED status/);
    } finally {
      unlinkSync(target);
    }
    assert.throws(() => dryRun(forged), /initial APPROVED status/);
    assert.throws(() => startDispatch(forged), /initial APPROVED status/);
  }
  for (const changes of [
    { retryCount: 1 },
    { result: 'untrusted report' },
    { humanDecisionRequired: true },
  ])
    assert.throws(() => dryRun(task(changes)));

  let current = startDispatch(task());
  for (const event of ['START', 'WORKER_DONE', 'GATE_PASS', 'QA_PASS'])
    current = transition(current, event);
  assert.equal(current.status, 'READY_FOR_APPROVAL');
});

test('untrusted task commands and gate names are rejected before any process starts', () => {
  let executions = 0;
  for (const changes of [
    { command: 'git push' },
    { gates: ['node-runtime', 'git push'] },
    { gates: [{ command: 'git', args: ['merge', 'master'] }] },
    { gates: ['constructor'] },
    { gates: [] },
    { gates: ['node-runtime', 'node-runtime'] },
  ]) {
    assert.throws(() =>
      runGates(task(changes), {
        execute: () => {
          executions += 1;
        },
      }),
    );
  }
  assert.equal(executions, 0);
});

test('scope validation rejects traversal, Windows escapes and protected inputs', () => {
  for (const input of [
    '../outside',
    'C:/outside',
    '//server/share',
    'docs/../src',
    'docs\\file.json',
    'docs/file:stream',
    'docs/NUL.json',
    'docs/file.',
    '.fanaticotas/file',
    'docs/.ENV.local',
    'credentials/key',
    '.git/config',
  ]) {
    assert.throws(() => validateTask(task({ inputs: [input] })), input);
  }
  assert.throws(() => validateTask(task({ allowedPaths: ['docs'] })));
  assert.throws(() =>
    validateTask(task({ mode: 'write', allowedPaths: ['SRC'] })),
  );
  assert.throws(() =>
    validateTask(
      task({
        mode: 'write',
        allowedPaths: ['docs'],
        protectedPaths: [...task().protectedPaths, 'docs/private'],
      }),
    ),
  );
  assert.throws(() => validateTask(task({ protectedPaths: ['src'] })));
  assert.doesNotThrow(() =>
    validateTask(task({ mode: 'write', allowedPaths: ['docs/report.md'] })),
  );
});

test('loader rejects paths before reading them, and rejects malformed/oversize JSON', () => {
  for (const filename of [
    '../task.json',
    '.env',
    '.agent-tasks/../package.json',
    '.agent-tasks/.env.json',
    'C:/.agent-tasks/task.json',
    '.agent-tasks/NES-0001.json;git push',
  ]) {
    assert.throws(() => loadTask(filename), /Use .agent-tasks/);
  }
  const filename = `.agent-tasks/check-${process.pid}.json`;
  const target = path.join(ROOT, filename);
  writeFileSync(target, '{', { flag: 'wx' });
  try {
    assert.throws(() => loadTask(filename), SyntaxError);
    writeFileSync(target, ' '.repeat(65537));
    assert.throws(() => loadTask(filename), /64 KiB/);
  } finally {
    unlinkSync(target);
  }
});

test('task paths and task filenames reject every reserved Windows device basename', () => {
  const names = [
    'CON',
    'PRN',
    'AUX',
    'NUL',
    ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
  ];
  for (const name of names) {
    assert.throws(() => validateTask(task({ inputs: [`docs/${name}`] })), name);
    assert.throws(() => loadTask(`.agent-tasks/${name}.json`), name);
  }
});

test('loader rejects a symlink to even an allowed local task', (context) => {
  const filename = `.agent-tasks/link-${process.pid}.json`;
  const target = path.join(ROOT, filename);
  try {
    symlinkSync(path.join(ROOT, example), target, 'file');
  } catch (error) {
    if (error.code === 'EPERM') {
      context.skip('Windows does not permit file symlink creation');
      return;
    }
    throw error;
  }
  try {
    assert.throws(() => loadTask(filename), /without links/);
  } finally {
    unlinkSync(target);
  }
});

test('schema rejects missing fields, incompatible modes, reused sessions and invalid budgets', () => {
  const incomplete = task();
  delete incomplete.objective;
  assert.throws(() => validateTask(incomplete));
  for (const changes of [
    { mode: 'execute' },
    { status: 'IMPLEMENTATION' },
    { status: 'PUBLISHED' },
    { status: 'HUMAN' },
    { retryCount: -1 },
    { retryCount: 3 },
    { retryCount: 0.5 },
    { maxRetries: 3 },
    { maxRetries: -1 },
    { humanDecisionRequired: 'false' },
    { reviewer: { adapter: 'codex', model: null, session: 'resume-worker' } },
    { implementer: { adapter: 'bad adapter', model: null, session: 'new' } },
    { result: { command: 'git push' } },
  ])
    assert.throws(() => validateTask(task(changes)));
});

test('gates and QA cannot be bypassed by invalid transitions', () => {
  let current = startDispatch(task());
  assert.throws(() => transition(current, 'QA_PASS'));
  assert.throws(() => transition(task({ status: 'LLM_QA' }), 'QA_PASS'));
  for (const event of ['START', 'WORKER_DONE'])
    current = transition(current, event);
  assert.equal(current.status, 'DETERMINISTIC_GATE');
  assert.throws(() => transition(current, 'QA_PASS'));
  const failed = transition(current, 'GATE_FAIL');
  assert.equal(failed.status, 'GATE_FAIL');
  assert.throws(() => transition(failed, 'QA_PASS'));
  assert.equal(
    transition(transition(current, 'GATE_PASS'), 'QA_PASS').status,
    'READY_FOR_APPROVAL',
  );
});

test('zero, one and two retries finish at HUMAN after the allowed failing attempts', () => {
  for (const maxRetries of [0, 1, 2]) {
    let current = startDispatch(task({ maxRetries }));
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      for (const event of [
        'START',
        'WORKER_DONE',
        'GATE_PASS',
        'QA_FAIL',
        'RETRY',
      ]) {
        current = transition(current, event);
      }
      assert.equal(current.retryCount, Math.min(attempt + 1, maxRetries));
      assert.equal(current.status, attempt < maxRetries ? 'RETRY' : 'HUMAN');
    }
    assert.equal(current.humanDecisionRequired, true);
    assert.throws(() => transition(current, 'START'));
  }
  const retried = transition(
    transition(
      transition(
        transition(startDispatch(task()), 'START'),
        'WORKER_DONE',
      ),
      'GATE_FAIL',
    ),
    'RETRY',
  );
  assert.equal(retried.result, null);
  assert.equal(transition(retried, 'START').status, 'ANALYSIS');
});

test('second retry can succeed, and human decisions interrupt any active plan', () => {
  let retry = startDispatch(task());
  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (const event of [
      'START',
      'WORKER_DONE',
      'GATE_PASS',
      'QA_FAIL',
      'RETRY',
    ])
      retry = transition(retry, event);
  }
  assert.equal(retry.status, 'RETRY');
  assert.equal(retry.retryCount, 2);
  for (const event of ['START', 'WORKER_DONE', 'GATE_PASS', 'QA_PASS'])
    retry = transition(retry, event);
  assert.equal(retry.status, 'READY_FOR_APPROVAL');
  const pending = transition(startDispatch(task()), 'NEEDS_DECISION');
  assert.throws(() => transition(pending, 'START'));
  assert.throws(() => startDispatch(task({ humanDecisionRequired: true })));
  assert.equal(
    transition(pending, 'ESCALATE').status,
    'HUMAN',
  );
});

test('dry-run is immutable, distinguishes analysis/write and never calls execution', () => {
  for (const changes of [
    {},
    { mode: 'write', allowedPaths: ['docs/report.md'] },
  ]) {
    const input = task(changes);
    const before = structuredClone(input);
    const plan = dryRun(input);
    assert.deepEqual(input, before);
    assert.equal(plan.executed, false);
    assert.ok(plan.agents.every((agent) => agent.execution === 'disabled'));
    assert.equal(
      plan.trace[1].status,
      input.mode === 'write' ? 'IMPLEMENTATION' : 'ANALYSIS',
    );
    assert.equal(plan.agents[1].mode, 'read-only');
    assert.ok(
      plan.agents.every(
        (agent) => agent.session === 'new' && agent.model === null,
      ),
    );
  }
  assert.throws(() => codexAdapter.execute(), /disabled/);
});

test('adapter IDs are generic in the task contract and resolve only from the local registry', () => {
  assert.deepEqual(Object.keys(ADAPTERS), ['codex']);
  assert.equal(resolveAdapter('codex'), codexAdapter);
  const unknown = task({
    implementer: { adapter: 'future_agent', model: null, session: 'new' },
  });
  assert.doesNotThrow(() => validateTask(unknown));
  assert.throws(() => dryRun(unknown), /Unknown adapter: future_agent/);
  assert.throws(() => resolveAdapter('constructor'), /Unknown adapter/);
});

test('runner preserves failure exit codes and fail-fast cannot mask skipped gates', () => {
  for (const failFast of [true, false]) {
    let calls = 0;
    const summary = runGates(task(), {
      failFast,
      execute: (_file, _args, options) => {
        assert.equal(options.shell, false);
        assert.equal(options.cwd, ROOT);
        assert.ok(options.timeout > 0);
        calls += 1;
        if (calls === 1)
          throw Object.assign(new Error('fixture failure'), {
            status: 7,
            stderr: 'diagnostic',
          });
        return 'ok';
      },
    });
    assert.equal(summary.status, 'FAIL');
    assert.equal(summary.exitCode, 1);
    assert.equal(summary.results[0].exitCode, 7);
    assert.equal(summary.results[0].stderr, 'diagnostic');
    assert.equal(calls, failFast ? 1 : 2);
    assert.deepEqual(summary.skipped, failFast ? ['diff-check'] : []);
  }
});

test('spawn failure and timeout are FAIL, with duration and diagnostics', () => {
  for (const code of ['ENOENT', 'ETIMEDOUT']) {
    const summary = runGates(task({ gates: ['node-runtime'] }), {
      execute: () => {
        throw Object.assign(new Error(code), { code });
      },
    });
    assert.equal(summary.results[0].status, 'FAIL');
    assert.equal(summary.results[0].error, code);
    assert.equal(summary.exitCode, 1);
    assert.ok(summary.durationMs >= 0 && summary.results[0].durationMs >= 0);
  }
});

test('real local gate and CLI expose parseable summaries and matching exit codes', () => {
  const result = runGates(task({ gates: ['node-runtime'] }), {
    execute: execFileSync,
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.results[0].stdout, /^v\d+/);
  const valid = cli('agent-task.mjs', pilot);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).status, 'VALID');
  for (const [script, args] of [
    ['agent-task.mjs', ['../outside.json']],
    ['agent-dispatch.mjs', [pilot, '--execute']],
    ['agent-gate.mjs', [example, '--command=git push']],
  ]) {
    const invalid = cli(script, ...args);
    assert.equal(invalid.status, 2, invalid.stderr);
    assert.equal(JSON.parse(invalid.stdout).exitCode, 2);
  }
});

test('dispatcher CLI leaves both definitions byte-identical and reports a prediction', () => {
  const before = [example, pilot].map((filename) =>
    readFileSync(path.join(ROOT, filename), 'utf8'),
  );
  const result = cli('agent-dispatch.mjs', pilot, '--dry-run');
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.executed, false);
  assert.equal(plan.predictedStatus, 'READY_FOR_APPROVAL');
  assert.match(result.stderr, /no execution/);
  assert.deepEqual(
    [example, pilot].map((filename) =>
      readFileSync(path.join(ROOT, filename), 'utf8'),
    ),
    before,
  );
});
