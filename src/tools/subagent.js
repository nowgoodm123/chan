export const subagentTool = {
  name: 'subagent',
  description:
    'Delegate an isolated task to a subagent. The subagent runs with a fresh context and its own tool permissions, then returns a final report. Use it for parallel research, focused reviews, or exploration without polluting this conversation.',
  parameters: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'Subagent name, for example "explore" or "general".' },
      prompt: { type: 'string', description: 'Complete task description for the subagent.' },
      model: {
        type: 'string',
        description: 'Optional model override, as "model" or "provider/model".',
      },
    },
    required: ['agent', 'prompt'],
  },
  async run(args, ctx) {
    if (typeof ctx.runSubagent !== 'function') {
      throw new Error('subagents are not available in this context');
    }
    return ctx.runSubagent({
      agent: args.agent,
      prompt: args.prompt,
      model: args.model || undefined,
    });
  },
};

export default subagentTool;
