import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { formatSkillsForPrompt, loadSkills } from '../src/skills.js';
import { createSkillTool } from '../src/tools/skill.js';
import { parseFrontmatter } from '../src/util/frontmatter.js';

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chan-skills-'));
}

test('parseFrontmatter handles scalars, booleans, arrays and body', () => {
  const parsed = parseFrontmatter('---\nname: Demo\ndescription: "A skill"\ntools: [read, grep]\nflag: true\n---\nBody line\n');
  assert.equal(parsed.data.name, 'Demo');
  assert.equal(parsed.data.description, 'A skill');
  assert.deepEqual(parsed.data.tools, ['read', 'grep']);
  assert.equal(parsed.data.flag, true);
  assert.equal(parsed.body, 'Body line\n');
  assert.deepEqual(parseFrontmatter('no frontmatter').data, {});
  const bom = parseFrontmatter('\uFEFF---\ndescription: With BOM\n---\nbody');
  assert.equal(bom.data.description, 'With BOM');
});

test('loadSkills discovers project skills and supporting files', async () => {
  const cwd = workspace();
  const skillDir = path.join(cwd, '.chan', 'skills', 'git-release');
  fs.mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '---\nname: Git Release\ndescription: Prepare a release\n---\n# Workflow\nRun the script.\n',
  );
  fs.writeFileSync(path.join(skillDir, 'scripts', 'notes.txt'), 'support');

  const skills = loadSkills({ cwd, config: {} });
  assert.equal(skills.length, 1);
  assert.equal(skills[0].id, 'git-release');
  assert.equal(skills[0].name, 'Git Release');
  assert.equal(skills[0].description, 'Prepare a release');
  assert.match(skills[0].body, /# Workflow/);
  assert.ok(skills[0].files.includes('scripts/notes.txt'));

  const prompt = formatSkillsForPrompt(skills);
  assert.match(prompt, /git-release: Prepare a release/);

  const tool = createSkillTool(skills);
  const output = await tool.run({ id: 'git-release' });
  assert.match(output, /# Skill: Git Release/);
  assert.match(output, /Base directory:/);
  await assert.rejects(tool.run({ id: 'nope' }), /unknown skill/);
});

test('hidden skills are loadable but not advertised', async () => {
  const cwd = workspace();
  const dir = path.join(cwd, '.chan', 'skills', 'secret');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\ndescription: Hidden helper\ndisable-model-invocation: true\n---\nsecret body');
  const skills = loadSkills({ cwd, config: {} });
  assert.equal(skills.length, 1);
  assert.equal(skills[0].hidden, true);
  assert.equal(formatSkillsForPrompt(skills), '');
  assert.match(await createSkillTool(skills).run({ id: 'secret' }), /secret body/);
});

test('root-level markdown skills are discovered', () => {
  const cwd = workspace();
  const dir = path.join(cwd, '.chan', 'skills');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'review.md'), '---\ndescription: Review code\n---\nBe thorough.');
  const skills = loadSkills({ cwd, config: {} });
  assert.equal(skills[0].id, 'review');
});
