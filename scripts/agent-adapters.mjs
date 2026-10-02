// Planning interface only. A future executor must provide OS isolation and
// persist distinct worker/QA session IDs; never resume the implementer's session.
export const codexAdapter = {
  plan(task, role) {
    const agent = role === 'QA' ? task.reviewer : task.implementer;
    return {
      adapter: agent.adapter,
      model: agent.model,
      role,
      session: 'new',
      mode: role === 'QA' ? 'read-only' : task.mode,
      execution: 'disabled',
    };
  },
  execute() {
    throw new Error('Agent execution is disabled in this pilot');
  },
};

// Only trusted local adapters are registered here; tasks select IDs, not code.
export const ADAPTERS = Object.freeze({ codex: codexAdapter });

export function resolveAdapter(adapterId) {
  if (!Object.hasOwn(ADAPTERS, adapterId))
    throw new Error(`Unknown adapter: ${adapterId}`);
  return ADAPTERS[adapterId];
}
