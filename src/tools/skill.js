import { findSkill } from '../skills.js';

export function createSkillTool(skills) {
  const ids = (skills || []).map((skill) => skill.id);
  return {
    name: 'skill',
    description:
      'Load the full instructions of an available skill. Always load a skill before following its workflow. Available ids: ' +
      (ids.length ? ids.join(', ') : '(none configured)'),
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill id, for example "git-release".' },
      },
      required: ['id'],
    },
    async run(args) {
      const skill = findSkill(skills, args.id);
      if (!skill) {
        throw new Error(`unknown skill "${args.id}". Available skills: ${ids.join(', ') || '(none)'}`);
      }
      const parts = [`# Skill: ${skill.name}`, '', skill.body || '(no instructions)'];
      parts.push('', `Base directory: ${skill.dir}`);
      if (skill.files.length) {
        parts.push('Supporting files (paths relative to the base directory):');
        for (const file of skill.files) parts.push(`- ${file}`);
      } else {
        parts.push('Supporting files: none');
      }
      return parts.join('\n');
    },
  };
}

export default createSkillTool;
