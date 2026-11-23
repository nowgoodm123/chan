const STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);

function render(todos) {
  if (!todos.length) return 'Todo list is empty.';
  const marks = { pending: '[ ]', in_progress: '[~]', completed: '[x]', cancelled: '[-]' };
  const lines = todos.map((todo, index) => `${index + 1}. ${marks[todo.status] || '[ ]'} ${todo.content}`);
  const remaining = todos.filter((t) => t.status === 'pending' || t.status === 'in_progress').length;
  return `Todo list (${remaining} remaining / ${todos.length} total):\n${lines.join('\n')}`;
}

function normalize(input) {
  if (!Array.isArray(input)) throw new Error('todos must be an array');
  return input.map((item, index) => {
    const content = typeof item === 'string' ? item : item?.content;
    if (!content || typeof content !== 'string') throw new Error(`todo #${index + 1} is missing content`);
    const status = typeof item === 'object' && item.status ? String(item.status) : 'pending';
    if (!STATUSES.has(status)) throw new Error(`todo #${index + 1} has invalid status "${status}"`);
    return { content: content.trim(), status };
  });
}

export const todoWriteTool = {
  name: 'todo_write',
  description:
    'Create or replace the session todo list. Use it to plan multi-step work and keep progress visible. Send the full list every time; statuses: pending, in_progress, completed, cancelled.',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The complete todo list.',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            status: { type: 'string', enum: [...STATUSES] },
          },
          required: ['content'],
        },
      },
    },
    required: ['todos'],
  },
  async run(args, ctx) {
    const todos = normalize(args.todos);
    if (ctx.session) {
      ctx.session.todos = todos;
      ctx.session.updatedAt = new Date().toISOString();
    }
    return render(todos);
  },
};

export const todoReadTool = {
  name: 'todo_read',
  description: 'Show the current session todo list.',
  parameters: { type: 'object', properties: {} },
  async run(_args, ctx) {
    return render(ctx.session?.todos || []);
  },
};

export default todoWriteTool;
export const name = todoWriteTool.name;
export const description = todoWriteTool.description;
export const parameters = todoWriteTool.parameters;
export const run = todoWriteTool.run;
