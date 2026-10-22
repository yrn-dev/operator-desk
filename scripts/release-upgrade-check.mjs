/** Real packaged Desktop, synthetic old profile, no network/model requests. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SessionManager } from '../vendor/node_modules/pzero-operator/dist/core/session-manager.js';

const root = await mkdtemp(join(tmpdir(), 'operator-upgrade-check-'));
const home = join(root, 'home');
const agent = join(home, '.opr/agent');
const profile = join(root, 'config/operator-desk');
for (const dir of [agent, join(profile, 'bridge'), join(profile, 'plugins/custom'), join(profile, 'plugins-builtin/stale')])
  await mkdir(dir, { recursive: true });
const auth = { 'alem-ai': { type: 'api_key', key: 'synthetic-upgrade-key' } };
const settings = { defaultProvider: 'alem-ai', defaultModel: 'qwen3-8', compaction: { enabled: true }, hideThinkingBlock: true };
const plugins = { disabled: ['custom', 'legacy'], settings: { custom: { preference: 'KEEP_CUSTOM_SETTING' } } };
const policy = { computerUse: false, rules: [{ tool: 'bash', pattern: 'protected-command', action: 'deny' }] };
const sentinel = 'throw new Error("STALE_RUNTIME_MUST_NOT_LOAD");';
const originalFiles = new Map([
  [join(agent, 'auth.json'), JSON.stringify(auth)], [join(agent, 'settings.json'), JSON.stringify(settings)],
  [join(profile, 'plugins.json'), JSON.stringify(plugins)], [join(profile, 'policy.json'), JSON.stringify(policy)],
  [join(profile, 'bridge/desk-bridge.mjs'), sentinel],
  [join(profile, 'plugins/custom/plugin.json'), JSON.stringify({ id: 'custom', name: 'User plugin', version: '7.0.0', kind: 'mcp', command: 'never-execute-disabled-plugin' })],
  [join(profile, 'plugins-builtin/stale/plugin.json'), JSON.stringify({ id: 'stale', name: 'OLD BUILTIN MUST NOT LOAD' })],
]);
for (const [path, content] of originalFiles) await writeFile(path, content);
await writeFile(join(profile, 'mcp.json'), JSON.stringify({ servers: { legacy: { command: 'legacy-command', args: ['--keep'], env: { EXAMPLE: 'PRESERVED' } } } }));
const manager = SessionManager.create(home, join(agent, 'sessions/--upgrade--'));
manager.appendModelChange('alem-ai', 'qwen3-8');
manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'KEEP_OLD_CONVERSATION' }], timestamp: Date.now() - 1000 });
manager.appendMessage({ role: 'assistant', provider: 'alem-ai', model: 'qwen3-8', api: 'openai-completions',
  stopReason: 'stop', content: [{ type: 'text', text: 'OLD_ANSWER' }], timestamp: Date.now(),
  usage: { input: 20, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const sessionFile = manager.getSessionFile();
await writeFile(join(profile, 'desk-sessions.json'), JSON.stringify([sessionFile]));
originalFiles.set(sessionFile, await readFile(sessionFile, 'utf8'));
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const binary = resolve(`release/${version}/linux-unpacked/operator-desk`);
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(root, 'config'),
  OPERATOR_CODING_AGENT_DIR: agent, OPERATOR_DESK_DEBUG: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.OPERATOR_DESK_PROMPT;
const log = fs.openSync(join(root, 'desktop.log'), 'w');
const app = spawn('xvfb-run', ['-a', binary, '--ozone-platform=x11', '--remote-debugging-port=0'],
  { env, cwd: home, stdio: ['ignore', log, log], detached: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch {}
    if (app.exitCode !== null) throw new Error(`Desktop exited ${app.exitCode}; ${root}/desktop.log`);
    await delay(200);
  }
  assert.ok(port, 'Desktop debug port');
  let page;
  for (let i = 0; i < 60; i++) {
    page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p => p.type === 'page');
    if (page) break; await delay(100);
  }
  assert.ok(page);
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  const pending = new Map(); let id = 0;
  ws.onmessage = ({ data }) => { const item = JSON.parse(data); if (pending.has(item.id)) {
    const p = pending.get(item.id); pending.delete(item.id); clearTimeout(p.timer);
    item.error ? p.reject(new Error(JSON.stringify(item.error))) : p.resolve(item.result);
  } };
  const evaluate = async expression => {
    const seq = ++id;
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(seq); reject(new Error('CDP timeout')); }, 30000);
      pending.set(seq, { resolve, reject, timer });
      ws.send(JSON.stringify({ id: seq, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  for (let i = 0; i < 60; i++) { if (await evaluate('Boolean(window.operator)')) break; await delay(100); }
  assert.deepEqual(await evaluate('window.operator.getPolicy()'), policy);
  const history = await evaluate('window.operator.listSessions()');
  assert.ok(history.some(s => s.path === sessionFile && s.title === 'KEEP_OLD_CONVERSATION'));
  const listed = await evaluate('window.operator.listPlugins()');
  const custom = listed.find(p => p.id === 'custom');
  assert.equal(custom.enabled, false); assert.equal(custom.values.preference, 'KEEP_CUSTOM_SETTING');
  assert.ok(listed.some(p => p.id === 'notes' && p.origin === 'builtin'));
  assert.ok(!listed.some(p => p.id === 'stale'));
  assert.equal(listed.find(p => p.id === 'legacy').enabled, false);
  const legacy = JSON.parse(await readFile(join(profile, 'plugins/legacy/plugin.json'), 'utf8'));
  assert.deepEqual(legacy.env, { EXAMPLE: 'PRESERVED' });
  await evaluate(`window.operator.open({id:'upgrade-check',cwd:${JSON.stringify(home)},provider:'alem-ai',model:'qwen3-8'})`);
  const state = await evaluate("window.operator.send('upgrade-check','get_state')");
  assert.equal(state.model.contextWindow, 258000);
  await evaluate(`window.operator.send('upgrade-check','switch_session',{sessionPath:${JSON.stringify(sessionFile)}})`);
  const messages = await evaluate("window.operator.send('upgrade-check','get_messages')");
  assert.match(JSON.stringify(messages), /KEEP_OLD_CONVERSATION/); assert.match(JSON.stringify(messages), /OLD_ANSWER/);
  await evaluate("window.operator.close('upgrade-check')");
  for (const [file, original] of originalFiles) {
    const current = await readFile(file, 'utf8');
    if (file === sessionFile) {
      assert.ok(current.startsWith(original), 'Existing history must remain byte-for-byte intact');
      const added = current.slice(original.length).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      assert.ok(added.every(entry => entry.type === 'thinking_level_change' && entry.thinkingLevel === 'off'),
        'Only missing thinking-level metadata may be appended on restore');
    } else assert.equal(current, original, `Changed existing data: ${file}`);
  }
  // A second instance must exit, leaving the original profile owner alive.
  const second = spawn('xvfb-run', ['-a', binary, '--ozone-platform=x11'], { env, cwd: home, stdio: ['ignore', log, log], detached: true });
  try {
    const exit = await Promise.race([new Promise(resolve => second.on('exit', resolve)), delay(10000).then(() => 'timeout')]);
    assert.equal(exit, 0); assert.equal(app.exitCode, null);
  } finally { if (second.exitCode === null) process.kill(-second.pid, 'SIGTERM'); }
  const evidence = { version, preserved: ['conversation', 'auth', 'settings', 'permissions', 'custom plugins'],
    legacyMcpMigrated: true, staleSharedRuntimeIgnored: true, singleInstance: true, passed: true };
  await writeFile(join(root, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log('PASS upgrade profile, legacy MCP, stale modules and single-instance; evidence:', root);
} finally {
  ws?.close();
  if (app.exitCode === null) process.kill(-app.pid, 'SIGTERM');
  fs.closeSync(log);
}
