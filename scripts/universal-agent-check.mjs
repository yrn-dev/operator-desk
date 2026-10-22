import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSystemPrompt } from '../vendor/node_modules/pzero-operator/dist/core/system-prompt.js';
import { DefaultResourceLoader } from '../vendor/node_modules/pzero-operator/dist/core/resource-loader.js';
import { SettingsManager } from '../vendor/node_modules/pzero-operator/dist/core/settings-manager.js';
import { SessionManager } from '../vendor/node_modules/pzero-operator/dist/core/session-manager.js';
import { createAgentSession } from '../vendor/node_modules/pzero-operator/dist/core/sdk.js';
import { Type } from 'typebox';

const dir = await mkdtemp(join(tmpdir(), 'operator-universal-check-'));
const cwd = join(dir, 'project');
const agentDir = join(dir, 'agent');
const explicit = join(dir, 'desk.md');
const globalAppend = join(agentDir, 'APPEND_SYSTEM.md');
try {
  await mkdir(join(cwd, '.opr'), { recursive: true });
  await mkdir(agentDir);
  await writeFile(globalAppend, 'GLOBAL: preferred author');
  await writeFile(join(cwd, '.opr/APPEND_SYSTEM.md'), 'PROJECT: relevant conventions');
  await writeFile(explicit, 'DESKTOP: available browser');
  const loader = async (trusted, extra) => {
    const settingsManager = SettingsManager.inMemory({}, { projectTrusted: trusted });
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      appendSystemPrompt: extra });
    await resourceLoader.reload();
    return { settingsManager, resourceLoader };
  };
  const trusted = await loader(true, [explicit, globalAppend, explicit]);
  assert.deepEqual(trusted.resourceLoader.getAppendSystemPrompt(), [
    'GLOBAL: preferred author', 'PROJECT: relevant conventions', 'DESKTOP: available browser',
  ]);
  assert.deepEqual((await loader(false, [explicit])).resourceLoader.getAppendSystemPrompt(), [
    'GLOBAL: preferred author', 'DESKTOP: available browser',
  ]);
  assert.equal((await loader(true, [])).resourceLoader.getAppendSystemPrompt().length, 2);
  const full = buildSystemPrompt({ cwd, selectedTools: ['read', 'browser', 'my_plugin'], toolSnippets: { read: 'Read text' } });
  assert.match(full, /- browser:/);
  assert.match(full, /- my_plugin:/);
  assert.doesNotMatch(full, /task_plan|memory_store|test_run|CHAIN OF THOUGHT|Перед КАЖДЫМ/);
  const custom = buildSystemPrompt({ cwd, customPrompt: 'CUSTOM BASE', selectedTools: ['my_plugin'], promptGuidelines: ['Plugin requirement'] });
  assert.ok(custom.startsWith('CUSTOM BASE'));
  assert.match(custom, /- my_plugin:/);
  assert.match(custom, /Plugin requirement/);
  const none = buildSystemPrompt({ cwd, selectedTools: [] });
  assert.match(none, /Инструменты отключены/);
  assert.doesNotMatch(none, /app_control|task_plan|browser:/);
  const sessions = [];
  try {
    const create = async extra => {
      const { session } = await createAgentSession({ cwd, agentDir, ...trusted,
        sessionManager: SessionManager.inMemory(cwd), ...extra });
      sessions.push(session);
      return session;
    };
    const session = await create({ customTools: [{ name: 'fixture_plugin', label: 'Fixture',
      description: 'Plugin description without a prompt snippet.', parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: 'text', text: 'fixture' }] }) }] });
    assert.ok(session.getActiveToolNames().includes('app_control'));
    assert.match(session.systemPrompt, /fixture_plugin: Plugin description without a prompt snippet/);
    assert.match(session.systemPrompt, /GLOBAL: preferred author[\s\S]*PROJECT:[\s\S]*DESKTOP:/);
    await session.reload();
    assert.ok(session.getActiveToolNames().includes('app_control'));
    const restricted = await create({ tools: ['read'] });
    assert.deepEqual(restricted.getActiveToolNames(), ['read']);
    assert.doesNotMatch(restricted.systemPrompt, /app_control:/);
    const disabled = await create({ noTools: 'all' });
    assert.deepEqual(disabled.getActiveToolNames(), []);
    assert.match(disabled.systemPrompt, /Инструменты отключены/);
  } finally { for (const session of sessions) session.dispose(); }
  console.log('PASS prompt composition, trust, deduplication, custom/no-tools modes, plugin metadata, app_control defaults/reload and allowlist');
} finally { await rm(dir, { recursive: true, force: true }); }
