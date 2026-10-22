import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession } from '../vendor/node_modules/pzero-operator/dist/core/sdk.js';
import { DefaultResourceLoader } from '../vendor/node_modules/pzero-operator/dist/core/resource-loader.js';
import { SettingsManager } from '../vendor/node_modules/pzero-operator/dist/core/settings-manager.js';
import { SessionManager } from '../vendor/node_modules/pzero-operator/dist/core/session-manager.js';
import { AuthStorage } from '../vendor/node_modules/pzero-operator/dist/core/auth-storage.js';
import { ModelRegistry } from '../vendor/node_modules/pzero-operator/dist/core/model-registry.js';
import { createAssistantMessageEventStream } from '../vendor/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js';
import { createToolDiscovery } from '../electron/bridge/tool-discovery.mjs';
import { connectMcpServer } from '../electron/bridge/mcp.mjs';

const cwd = await mkdtemp(join(tmpdir(), 'operator-context-check-'));
const authStorage = AuthStorage.inMemory({ 'alem-ai': { type: 'api_key', key: 'test-only' } });
const registry = new ModelRegistry(authStorage, join(cwd, 'models.json'));
const model = registry.find('alem-ai', 'qwen3-8');
assert.equal(model.contextWindow, 258000);
const schema = { type: 'object', properties: {}, additionalProperties: false };
const answer = (model, stopReason, content, input = 1000) => ({ role: 'assistant', model: model.id, provider: model.provider,
  api: model.api, timestamp: Date.now(), stopReason, content,
  usage: { input, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: input + 30,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const stream = message => { const s = createAssistantMessageEventStream();
  s.push(message.stopReason === 'error' || message.stopReason === 'aborted'
    ? { type: 'error', reason: message.stopReason, error: message }
    : { type: 'done', reason: message.stopReason, message }); return s; };
const text = value => [{ type: 'text', text: value }];
async function create(extra = {}) {
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: true, baseDelayMs: 1 }, ...extra.settings });
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager, noExtensions: true,
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: 'Test assistant.' });
  await resourceLoader.reload();
  return (await createAgentSession({ cwd, agentDir: cwd, settingsManager, resourceLoader, authStorage,
    modelRegistry: registry, model, sessionManager: SessionManager.inMemory(cwd), noTools: true, ...extra })).session;
}

// Eight tool turns, an output limit, automatic continuation, and a final answer.
let executions = 0;
let session = await create({ customTools: [{ name: 'probe', label: 'probe', description: 'test', parameters: schema,
  execute: async () => { executions++; return { content: text('OK') }; } }] });
let requests = 0;
const events = [];
session.subscribe(e => events.push(e));
session.agent.streamFn = (m, ctx) => {
  requests++;
  if (requests <= 8) return stream(answer(m, 'toolUse', [{ type: 'toolCall', id: `t${requests}`, name: 'probe', arguments: {} }]));
  if (requests === 9) return stream(answer(m, 'length', text('unfinished')));
  assert.equal(ctx.messages.at(-1).role, 'user');
  assert.match(JSON.stringify(ctx.messages.at(-1)), /output-token limit/);
  return stream(answer(m, 'stop', text('done')));
};
await session.prompt('Do the work');
assert.equal(executions, 8); assert.equal(requests, 10);
assert.equal(session.messages.at(-1).stopReason, 'stop');
assert.ok(events.some(e => e.type === 'auto_continue_start'));
assert.ok(session.sessionManager.getEntries().some(e => e.customType === 'output_limit_continuation'));
session.dispose();

// Repeated output limits are bounded; ordinary final answers never continue.
for (const reason of ['length', 'stop', 'aborted']) {
  session = await create(); requests = 0;
  session.agent.streamFn = m => { requests++; return stream(answer(m, reason, text('test'))); };
  await session.prompt('test');
  assert.equal(requests, reason === 'length' ? 4 : 1);
  session.dispose();
}

// Explicit cancellation during a length response must suppress continuation.
session = await create(); requests = 0;
session.subscribe(e => { if (e.type === 'message_end' && e.message.stopReason === 'length') void session.abort(); });
session.agent.streamFn = m => { requests++; return stream(answer(m, 'length', text('partial'))); };
await session.prompt('test'); assert.equal(requests, 1); session.dispose();

// Recover network failures without replaying completed tools.
session = await create(); requests = 0;
session.agent.streamFn = m => { requests++; return stream(requests === 1
  ? { ...answer(m, 'error', []), errorMessage: 'Connection error.' } : answer(m, 'stop', text('recovered'))); };
await session.prompt('test'); assert.equal(requests, 2); session.dispose();

// Discovery must update schemas inside the SAME agent run.
const definitions = [];
let dynamicSession;
const api = { registerTool: t => definitions.push(t), getAllTools: () => dynamicSession.getAllTools(),
  getActiveTools: () => dynamicSession.getActiveToolNames(), setActiveTools: names => dynamicSession.setActiveToolsByName(names) };
const discovery = createToolDiscovery(api);
let deferredCalls = 0;
const deferred = { name: 'fixture__lookup', label: 'fixture', description: 'Find fixtures. '.repeat(3000), parameters: schema,
  execute: async () => { deferredCalls++; return { content: text('found') }; } };
definitions.push(deferred); discovery.register('fixture', [deferred]);
dynamicSession = await create({ customTools: definitions });
discovery.beforePrompt(); assert.ok(!dynamicSession.getActiveToolNames().includes(deferred.name));
requests = 0;
dynamicSession.agent.streamFn = (m, ctx) => {
  requests++;
  if (requests === 1) { assert.ok(!ctx.tools.some(t => t.name === deferred.name));
    return stream(answer(m, 'toolUse', [{ type: 'toolCall', id: 'search', name: 'tool_search', arguments: { query: 'fixture__lookup', limit: 1 } }])); }
  if (requests === 2) { assert.ok(ctx.tools.some(t => t.name === deferred.name));
    return stream(answer(m, 'toolUse', [{ type: 'toolCall', id: 'lookup', name: deferred.name, arguments: {} }])); }
  return stream(answer(m, 'stop', text('done')));
};
await dynamicSession.prompt('Find fixture'); assert.equal(deferredCalls, 1); assert.equal(requests, 3);
discovery.beforePrompt(); assert.ok(!dynamicSession.getActiveToolNames().includes(deferred.name));
dynamicSession.dispose();

// Compact between tool turns, preserve call/result pairs, and finish autonomously.
session = await create({ model: { ...model, contextWindow: 24000, maxTokens: 1024 },
  settings: { compaction: { enabled: true, reserveTokens: 2048, keepRecentTokens: 1000 } },
  customTools: [{ name: 'probe', label: 'probe', description: 'test', parameters: schema,
    execute: async () => ({ content: text('result '.repeat(2000)) }) }] });
requests = 0; let summaries = 0; let compactions = 0;
session.subscribe(e => { if (e.type === 'compaction_end' && e.result) compactions++;
  if (e.type === 'compaction_end' && e.errorMessage) console.error(e.errorMessage); });
session.agent.streamFn = (m, ctx) => {
  if (!ctx.tools) { summaries++; return stream(answer(m, 'stop', text('Task: run three probes, then finish. Two probes are complete.'))); }
  requests++;
  if (requests <= 3) return stream(answer(m, 'toolUse', [{ type: 'toolCall', id: `c${requests}`, name: 'probe', arguments: {} }], requests === 2 ? 22500 : 1000));
  assert.ok(ctx.messages.some(message => JSON.stringify(message).includes('compacted')));
  for (const message of ctx.messages.filter(message => message.role === 'toolResult')) {
    assert.ok(ctx.messages.some(a => a.role === 'assistant' && a.content.some(b => b.type === 'toolCall' && b.id === message.toolCallId)));
  }
  return stream(answer(m, 'stop', text('done')));
};
await session.prompt('Run three probes');
assert.equal(session.messages.at(-1).stopReason, 'stop', session.messages.at(-1).errorMessage);
assert.equal(requests, 4); assert.ok(summaries > 0); assert.equal(compactions, 1); session.dispose();

// A real stdio MCP fixture verifies full-output retention and bounded context.
const serverFile = join(cwd, 'mcp.mjs');
await writeFile(serverFile, `import readline from 'node:readline';
readline.createInterface({input:process.stdin}).on('line', l => { const m=JSON.parse(l); if(!m.id)return;
const result=m.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}}:
m.method==='tools/list'?{tools:[{name:'large',description:'test',inputSchema:{type:'object',properties:{}}}]}:
{content:[{type:'text',text:'HEAD'+ 'x'.repeat(100000)+'TAIL'}],isError:true};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n'); });`);
const tools = [];
const server = await connectMcpServer({ registerTool: t => tools.push(t) }, 'fixture', {
  command: process.execPath, args: [serverFile], cacheFile: join(cwd, 'tools.json') });
try {
  const result = await tools[0].execute('large', {});
  assert.equal(result.isError, true); const output = result.content[0].text;
  assert.ok(output.length < 16000); assert.match(output, /HEAD/); assert.match(output, /TAIL/);
  const file = output.match(/characters\): (.+?)\. Read needed/)[1];
  assert.equal((await readFile(file, 'utf8')).length, 100008);
} finally { server.stop(); }
console.log('PASS 8 tool turns; length continuation/persistence/cap/cancel; network retry; live tool discovery; mid-run compaction; lossless MCP output spill.');
