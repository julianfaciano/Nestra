import { execFileSync } from 'node:child_process';
import { resolveAdapter } from './agent-adapters.mjs';
import {
  ROOT,
  cli,
  ensure,
  loadTask,
  validateInitialTask,
} from './agent-task.mjs';

// Runtime state is an opaque, in-memory value; task JSON cannot forge a stage.
const runtimeStates = new WeakMap();

function makeRuntimeState(task) {
  const state = Object.freeze({
    status: task.status,
    retryCount: task.retryCount,
    result: task.result,
    humanDecisionRequired: task.humanDecisionRequired,
  });
  runtimeStates.set(state, task);
  return state;
}

export function startDispatch(task) {
  validateInitialTask(task);
  return makeRuntimeState(structuredClone(task));
}

// Pure state transitions: no transport, subprocesses, persistence or approvals.
export function transition(task, event) {
  const runtimeTask = runtimeStates.get(task);
  ensure(runtimeTask, 'Transition requires an internal dispatch state');
  const worker =
    runtimeTask.mode === 'read-only' ? 'ANALYSIS' : 'IMPLEMENTATION';
  const table = {
    APPROVED: { START: worker },
    ANALYSIS: { WORKER_DONE: 'DETERMINISTIC_GATE' },
    IMPLEMENTATION: { WORKER_DONE: 'DETERMINISTIC_GATE' },
    DETERMINISTIC_GATE: { GATE_PASS: 'LLM_QA', GATE_FAIL: 'GATE_FAIL' },
    LLM_QA: { QA_PASS: 'READY_FOR_APPROVAL', QA_FAIL: 'QA_FAIL' },
    RETRY: { START: worker },
    NEEDS_DECISION: { ESCALATE: 'HUMAN' },
  };
  let status,
    retryCount = runtimeTask.retryCount;
  if (event === 'NEEDS_DECISION' && runtimeTask.status !== 'HUMAN')
    status = 'NEEDS_DECISION';
  else if (
    ['QA_FAIL', 'GATE_FAIL'].includes(runtimeTask.status) &&
    event === 'RETRY'
  ) {
    status = retryCount >= runtimeTask.maxRetries ? 'HUMAN' : 'RETRY';
    if (status === 'RETRY') retryCount += 1;
  } else status = table[runtimeTask.status]?.[event];
  ensure(status, `Invalid transition: ${runtimeTask.status} -> ${event}`);
  ensure(
    !runtimeTask.humanDecisionRequired ||
      ['NEEDS_DECISION', 'HUMAN'].includes(status),
    'Human decision pending',
  );
  return makeRuntimeState({
    ...runtimeTask,
    status,
    retryCount,
    result: status === 'RETRY' ? null : runtimeTask.result,
    humanDecisionRequired: ['NEEDS_DECISION', 'HUMAN'].includes(status),
  });
}

export function dryRun(task) {
  let current = startDispatch(task);
  const implementerAdapter = resolveAdapter(task.implementer.adapter);
  const reviewerAdapter = resolveAdapter(task.reviewer.adapter);
  const successEvent = {
    APPROVED: 'START',
    ANALYSIS: 'WORKER_DONE',
    IMPLEMENTATION: 'WORKER_DONE',
    DETERMINISTIC_GATE: 'GATE_PASS',
    LLM_QA: 'QA_PASS',
    RETRY: 'START',
    QA_FAIL: 'RETRY',
    GATE_FAIL: 'RETRY',
    NEEDS_DECISION: 'ESCALATE',
  };
  const trace = [{ status: current.status, retryCount: current.retryCount }];
  while (successEvent[current.status]) {
    current = transition(current, successEvent[current.status]);
    trace.push({ status: current.status, retryCount: current.retryCount });
  }
  return {
    taskId: task.id,
    dryRun: true,
    executed: false,
    exitCode: 0,
    assumption:
      'Predicted path only; worker completion, gate PASS and QA PASS are not evidence.',
    worktree:
      task.mode === 'write'
        ? 'Planning only; write execution is disabled until worktree and scope controls exist'
        : 'Current worktree, no file writes',
    agents: [
      implementerAdapter.plan(task, 'Engineer/Analyst'),
      reviewerAdapter.plan(task, 'QA'),
    ],
    gates: task.gates,
    trace,
    branches: [
      'GATE_FAIL / QA_FAIL -> RETRY -> worker -> gates -> fresh QA',
      'On failure, retryCount >= maxRetries -> HUMAN',
      'NEEDS_DECISION -> HUMAN',
    ],
    predictedStatus: current.status,
    humanApprovalBefore: ['push', 'merge', 'main/master', 'production'],
  };
}

cli(import.meta.url, (args) => {
  ensure(
    args.length === 2 && args[1] === '--dry-run',
    'Only supported mode: node scripts/agent-dispatch.mjs <task> --dry-run',
  );
  const task = loadTask(args[0]);
  const branch = execFileSync('git', ['branch', '--show-current'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
  }).trim();
  ensure(
    branch && !['master', 'main'].includes(branch),
    'Use a task branch, never main/master or detached HEAD',
  );
  const plan = dryRun(task);
  console.error(
    `DRY-RUN ${task.id}: ${plan.trace.map((step) => step.status).join(' -> ')} (no execution)`,
  );
  return { ...plan, branch };
});
