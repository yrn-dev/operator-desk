/** Real Qwen, real installed tool metadata, synthetic tools only; no account actions. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession } from '../vendor/node_modules/pzero-operator/dist/core/sdk.js';
import { DefaultResourceLoader } from '../vendor/node_modules/pzero-operator/dist/core/resource-loader.js';
import { SettingsManager } from '../vendor/node_modules/pzero-operator/dist/core/settings-manager.js';
import { SessionManager } from '../vendor/node_modules/pzero-operator/dist/core/session-manager.js';
import { AuthStorage } from '../vendor/node_modules/pzero-operator/dist/core/auth-storage.js';
import { ModelRegistry } from '../vendor/node_modules/pzero-operator/dist/core/model-registry.js';
import { createToolDiscovery } from '../electron/bridge/tool-discovery.mjs';
import { listPlugins } from '../electron/bridge/plugins.mjs';
const root = await mkdtemp(join(tmpdir(), 'operator-context-live-'));
const config = join(homedir(), '.config/operator-desk');
const { disabled = [] } = JSON.parse(await readFile(join(config, 'plugins.json'), 'utf8'));
const installed = new Set(listPlugins({ builtinDir: join(config, 'plugins-builtin'), userDir: join(config, 'plugins') })
  .filter(p => !disabled.includes(p.id)).map(p => p.id));
const catalogs = [];
for (const file of await readdir(join(config, 'plugins-data/tools'))) {
  const name = file.replace(/\.json$/, '');
  if (!installed.has(name)) continue;
  catalogs.push([name, JSON.parse(await readFile(join(config, 'plugins-data/tools', file), 'utf8')).tools]);
}
let steps = 0; let discoveryCalls = 0;
const token = n => `fixture-token-${n * 173 + 29}`;
const fixture = { name: 'fixture__next', label: 'Fixture', description: 'Synthetic sequential test: pass the token from the previous result. No external effects.',
  parameters: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'], additionalProperties: false },
  async execute(_id, args) { assert.equal(args.token, token(steps)); steps++;
    console.log(`fixture step ${steps}/8`);
    return { content: [{ type: 'text', text: steps === 8 ? 'DONE: CHAIN_OK. No further tool calls.' : `Step ${steps}/8 done. Next token: ${token(steps)}` }] }; } };
const factory = operator => {
  const discovery = createToolDiscovery(operator);
  for (const [name, raw] of catalogs) {
    const definitions = raw.map(t => ({ name: `${name}__${t.name}`.replace(/[^a-zA-Z0-9_]/g, '_'),
      label: t.name, description: t.description ?? t.name, parameters: t.inputSchema,
      execute: async () => { throw new Error('External actions disabled in this synthetic evaluation'); } }));
    for (const tool of definitions) operator.registerTool(tool);
    if (JSON.stringify(raw).length > 24000) discovery.register(name, definitions);
  }
  operator.registerTool(fixture); discovery.register('fixture', [fixture]);
  let catalog;
  operator.on('input', () => { catalog = discovery.beforePrompt(); });
  operator.on('before_agent_start', event => ({ systemPrompt: event.systemPrompt + '\nDeferred plugin tools: call tool_search to load.\n' + catalog }));
  operator.on('tool_call', event => {
    if (event.toolName === 'tool_search') { discoveryCalls++; return; }
    if (event.toolName !== fixture.name) return { block: true, reason: 'Only synthetic fixture tools are authorized in this test.' };
  });
};
const authStorage = AuthStorage.create(join(homedir(), '.opr/agent/auth.json'));
const modelRegistry = ModelRegistry.create(authStorage, join(homedir(), '.opr/agent/models.json'));
const model = modelRegistry.find('alem-ai', 'qwen3-8');
const settingsManager = SettingsManager.inMemory({ retry: { enabled: true, maxRetries: 1 } });
const resourceLoader = new DefaultResourceLoader({ cwd: homedir(), agentDir: join(homedir(), '.opr/agent'), settingsManager,
  noExtensions: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  extensionFactories: [factory], appendSystemPrompt: [join(process.cwd(), 'electron/bridge/desk-prompt.md')] });
await resourceLoader.reload();
const { session } = await createAgentSession({ cwd: root, settingsManager, resourceLoader, authStorage, modelRegistry, model,
  sessionManager: SessionManager.inMemory(root) });
await session.bindExtensions({ onError: e => { throw new Error(e.error); } });
const usage = [];
session.subscribe(e => { if (e.type === 'message_end' && e.message.role === 'assistant') {
  usage.push({ stopReason: e.message.stopReason, input: e.message.usage?.input, output: e.message.usage?.output });
  console.log('Qwen response', JSON.stringify(usage.at(-1)));
} });
const timer = setTimeout(() => session.abort(), 180000);
try {
  await session.prompt(`This is a synthetic tool-loop check. Load the exact tool fixture__next using tool_search (limit 1). Then call fixture__next eight times sequentially. First token: ${token(0)}. Each next token must come from the preceding result. Do not use other tools. After step 8 answer CHAIN_OK. Do not stop between steps.`);
  assert.equal(steps, 8); assert.ok(discoveryCalls >= 1); assert.equal(session.messages.at(-1).stopReason, 'stop');
  assert.match(JSON.stringify(session.messages.at(-1).content), /CHAIN_OK/);
  assert.ok(usage[0].input < 50000, 'New-session context should be well below the old 134k baseline');
  const evidence = { model: model.id, contextWindow: model.contextWindow, steps, discoveryCalls, usage };
  await writeFile(join(root, 'results.json'), JSON.stringify(evidence, null, 2));
  console.log('PASS live Qwen discovery and 8 sequential tool calls. Evidence:', join(root, 'results.json'));
} finally { clearTimeout(timer); session.dispose(); }
