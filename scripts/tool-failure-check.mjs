import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentSession } from '../vendor/node_modules/pzero-operator/dist/core/agent-session.js';
import { describeScreen } from '../electron/bridge/computer.mjs';

for (const handlers of [false, true]) {
  let received;
  const fake = { agent: {}, _extensionRunner: { hasHandlers: () => handlers, emitToolResult: async e => { received = e; } } };
  AgentSession.prototype._installAgentToolHooks.call(fake);
  const payload = { toolCall: { id: 'test', name: 'computer' }, args: {}, result: { isError: true, content: [{ type: 'text', text: 'Screen unavailable' }], details: { status: 'failed' } }, isError: false };
  assert.equal((await fake.agent.afterToolCall(payload)).isError, true);
  if (handlers) assert.equal(received.isError, true);
  payload.result.isError = false;
  assert.equal((await fake.agent.afterToolCall(payload)).isError, false);
  payload.isError = true;
  assert.equal((await fake.agent.afterToolCall(payload)).isError, true);
}
const dir = await mkdtemp(join(tmpdir(), 'operator-vision-failure-'));
const previous = process.env.OPERATOR_DESK_BIN;
try {
  const fake = join(dir, 'viewer.cjs');
  process.env.OPERATOR_DESK_BIN = fake;
  await writeFile(fake, `#!/usr/bin/env node
if (!process.argv.includes('--no-skills') || !process.argv.includes('--no-context-files')) process.exit(3);
process.stdout.write('A local test page is visible.');`, { mode: 0o755 });
  assert.match(await describeScreen('fake.png', {id:'test'}), /local test page/);
  await writeFile(fake, '#!/usr/bin/env node\nrequire("node:fs").writeSync(2, "provider failed sk-private123"); process.exit(2);');
  await assert.rejects(describeScreen('fake.png', {}), e => /provider failed/.test(e.message) && !e.message.includes('sk-private123'));
  await writeFile(fake, '#!/usr/bin/env node\nsetInterval(() => {}, 1000);');
  const start = Date.now();
  await assert.rejects(describeScreen('fake.png', {}, undefined, 100), /превысил/);
  assert.ok(Date.now() - start < 3000);
  const abort = new AbortController();
  setTimeout(() => abort.abort(), 100);
  await assert.rejects(describeScreen('fake.png', {}, abort.signal), /отменён/);
  console.log('PASS error propagation with/without extensions; minimal vision context, stderr, redaction, timeout and cancellation');
} finally {
  if (previous === undefined) delete process.env.OPERATOR_DESK_BIN; else process.env.OPERATOR_DESK_BIN = previous;
  await rm(dir, { recursive: true, force: true });
}
