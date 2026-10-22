/** Real local subprocess; no model, credentials or external services. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OperatorLine, rpcResponseTimeout } from "../electron/rpc.ts";

const directory = await mkdtemp(join(tmpdir(), "operator-rpc-timeout-"));
const lines: OperatorLine[] = [];
try {
  const fixture = join(directory, "fixture.cjs");
  await writeFile(fixture, `
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', raw => {
  const command = JSON.parse(raw);
  const reply = () => process.stdout.write(JSON.stringify({ type: 'response', id: command.id,
    success: command.type !== 'fail', data: command.value, error: 'fixture rejection' }) + '\\n');
  if (command.type === 'silent') return;
  if (command.type === 'exit') return process.exit(4);
  if (command.type === 'late') return setTimeout(reply, 400);
  reply();
});
process.stdout.write(JSON.stringify({ type: 'fixture_ready' }) + '\\n');
`);
  async function open() {
    const line = new OperatorLine("fixture", { cwd: directory, bin: process.execPath, prefixArgs: [fixture], responseTimeoutMs: 200 });
    lines.push(line);
    const ready = once(line, "event");
    line.start();
    await ready;
    return line;
  }
  assert.equal(rpcResponseTimeout("get_state"), 30_000);
  assert.equal(rpcResponseTimeout("compact"), 600_000);
  assert.equal(rpcResponseTimeout("prompt"), 600_000);
  const line = await open();
  assert.equal(await line.send("echo", { value: "ready" }), "ready");
  await assert.rejects(line.send("fail"), /fixture rejection/);
  const silent = assert.rejects(line.send("silent"), /не ответил.*silent/);
  assert.equal(await line.send("echo", { value: "parallel" }), "parallel");
  await silent;
  await assert.rejects(line.send("late"), /Действие могло выполниться/);
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(await line.send("echo", { value: "after late response" }), "after late response");
  const stopped = assert.rejects(line.send("silent"), /линия закрыта/);
  line.stop();
  await stopped;
  await assert.rejects(line.send("echo"), /не подключена/);
  const exiting = await open();
  await assert.rejects(exiting.send("exit"), /линия оборвалась/);
  const missing = new OperatorLine("missing", { cwd: directory, bin: join(directory, "does-not-exist"), responseTimeoutMs: 200 });
  lines.push(missing);
  missing.start();
  await assert.rejects(missing.send("echo"), /ENOENT|не подключена/);
  console.log("PASS bounded RPC replies, long-operation budgets, parallel requests, late replies, rejection, stop, exit and spawn failure");
} finally {
  for (const line of lines) line.stop();
  await rm(directory, { recursive: true, force: true });
}
