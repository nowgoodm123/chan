import crypto from 'node:crypto';
import { buildSystemPrompt, runAgent } from './agent.js';
import { loadAgents, resolveAgent } from './agents.js';
import { createProvider } from './providers/index.js';
import { loadSkills } from './skills.js';
import { createTools } from './tools/index.js';

export function resolveProviderForSpec({ config, baseName, baseProvider, spec }) {
  const providerName = baseName || config.defaultProvider;
  if (!spec) return { provider: baseProvider, name: providerName, model: baseProvider?.model };
  let name = providerName;
  let model = String(spec);
  const slash = model.indexOf('/');
  if (slash > 0) {
    const prefix = model.slice(0, slash);
    if (config.providers?.[prefix]) {
      name = prefix;
      model = model.slice(slash + 1);
    }
  }
  const clone = structuredClone(config);
  if (!clone.providers?.[name]) {
    throw new Error(`unknown provider "${name}" for model override "${spec}"`);
  }
  clone.providers[name] = { ...clone.providers[name], model };
  return { provider: createProvider(clone, name), name, model };
}

function createSubagentRunner(options) {
  const { cwd, config, session, provider, providerName, approvalMode, approve, signal, mcpManager, depth } = options;
  return async function runSubagent({ agent, prompt, model } = {}) {
    if (!agent || typeof agent !== 'string') throw new Error('subagent: "agent" is required');
    if (!prompt || typeof prompt !== 'string') throw new Error('subagent: "prompt" is required');
    if (depth >= 1) throw new Error('subagent nesting limit reached');

    const agents = loadAgents({ cwd, config });
    const profile = agents.get(agent.trim());
    if (!profile) {
      const available = [...agents.values()]
        .filter((item) => item.mode === 'subagent' || item.mode === 'all')
        .map((item) => item.name);
      throw new Error(`unknown subagent "${agent}". Available: ${available.join(', ') || '(none)'}`);
    }

    const resolved = resolveProviderForSpec({
      config,
      baseName: providerName,
      baseProvider: provider,
      spec: model || profile.model,
    });

    const childSession = {
      id: `sub-${crypto.randomUUID()}`,
      title: `subagent:${profile.name}`,
      cwd,
      messages: [],
      todos: [],
      agent: profile.name,
    };

    const child = await createRuntime({
      cwd,
      config,
      session: childSession,
      provider: resolved.provider,
      providerName: resolved.name,
      approvalMode,
      approve,
      signal,
      mcpManager,
      agentName: profile.name,
      depth: depth + 1,
    });

    const messages = [{ role: 'user', content: prompt }];
    let finalText = '';
    let steps = 0;
    let toolCalls = 0;
    let error = null;
    const recentToolOutputs = [];

    for await (const event of runAgent({
      provider: resolved.provider,
      messages,
      system: child.system,
      tools: child.tools,
      maxSteps: profile.steps || config.agent.maxSteps,
      temperature: config.agent.temperature,
      signal,
      maxOutputChars: config.agent.maxOutputChars,
      session: childSession,
    })) {
      if (event.type === 'assistant') {
        finalText = event.message?.content || finalText;
      } else if (event.type === 'tool-result') {
        toolCalls += 1;
        recentToolOutputs.push(String(event.output || '').slice(0, 800));
        if (recentToolOutputs.length > 3) recentToolOutputs.shift();
      } else if (event.type === 'done') {
        steps = event.steps;
      } else if (event.type === 'error') {
        error = event.message;
      }
    }

    if (error) throw new Error(`subagent "${profile.name}" failed: ${error}`);
    const fallback = recentToolOutputs.length ? `\n\nRecent tool output:\n${recentToolOutputs.join('\n\n')}` : '';
    return `Subagent "${profile.name}" finished in ${steps} step(s) with ${toolCalls} tool call(s).\n\n${finalText || '(no text output)'}${fallback}`;
  };
}

export async function createRuntime({
  cwd,
  config,
  session,
  provider,
  providerName,
  approvalMode = 'auto',
  approve = null,
  signal = null,
  mcpManager = null,
  agentName = null,
  depth = 0,
}) {
  const skills = loadSkills({ cwd, config });
  const agents = loadAgents({ cwd, config });
  const profile = resolveAgent(agents, agentName || session?.agent || config.agent?.defaultAgent || 'build');
  const mcpTools = mcpManager ? (await mcpManager.ready()).tools() : [];
  const runSubagent =
    depth >= 1
      ? null
      : createSubagentRunner({ cwd, config, session, provider, providerName, approvalMode, approve, signal, mcpManager, depth });

  const tools = createTools({
    cwd,
    config: { ...config.agent, approval: approvalMode, permissions: config.permissions || [] },
    session,
    approve,
    signal,
    approvalMode,
    enabled: profile.tools || null,
    skills,
    runSubagent,
    extraTools: mcpTools,
  });

  const custom = [config.agent?.systemPrompt, profile.system].filter(Boolean).join('\n\n');
  const system = buildSystemPrompt({ cwd, custom, skills, agents: [...agents.values()] });

  return { tools, system, skills, agents, profile, mcpTools, runSubagent };
}
