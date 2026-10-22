/** Exercise permission decisions without running shell commands or calling a model. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDangerousCommand, matchRule, rememberedRule } from "../electron/bridge/command-policy.mjs";

const dangerous = [
  "rm -rf /tmp/example", "rm --recursive --force /tmp/example", "rm -f /tmp/example",
  "sudo /bin/rm -r /tmp/example", '"rm" "-rf" /tmp/example', "r\\m -rf /tmp/example",
  "rm -\\\nrf /tmp/example", "true && rm -rf /tmp/example", "sh -c 'rm -rf /tmp/example'",
  "git push -f origin HEAD", "git -C /tmp/project push --force origin HEAD",
  "git push --force-with-lease=main origin HEAD", "git push -uf origin HEAD",
  "git push origin +HEAD:main", "git push -- origin +HEAD:main", "git reset --hard HEAD",
  "dd if=/tmp/source of=/tmp/dest", "mkfs.ext4 /dev/example", "chmod -R 777 /tmp/example", "reboot",
];
for (const command of dangerous) assert.equal(isDangerousCommand(command), true, command);
for (const command of ["npm test", "git status", "git push origin HEAD", "git reset --soft HEAD~1", "rm -- -rf", "chmod 644 note.txt", "ls -la"]) {
  assert.equal(isDangerousCommand(command), false, command);
}

const directory = await mkdtemp(join(tmpdir(), "operator-policy-regression-"));
const names = ["OPERATOR_DESK_CONFIG", "OPERATOR_DESK_CHECKPOINTS", "OPERATOR_DESK_PLUGINS_BUILTIN", "OPERATOR_DESK_PLUGINS_USER", "OPERATOR_DESK_JOBS"];
const previous = new Map(names.map(name => [name, process.env[name]]));
try {
  for (const name of names) process.env[name] = "";
  const file = join(directory, "policy.json");
  process.env.OPERATOR_DESK_CONFIG = file;
  const { default: bridge } = await import("../electron/bridge/desk-bridge.mjs");
  const handlers = new Map();
  bridge({ on: (name, callback) => handlers.set(name, callback), registerTool() {} });
  async function check(tool, command, { rules = [], hasUI = true, choice = "Отклонить", input } = {}) {
    await writeFile(file, JSON.stringify({ rules }));
    const asks = [], signals = [];
    const result = await handlers.get("tool_call")({ toolName: tool, input: input ?? { command }, toolCallId: "fixture" }, {
      hasUI, ui: { notify: message => signals.push(JSON.parse(message.slice("@@desk@@".length))),
        select: async title => { asks.push(title); return choice; } },
    });
    return { blocked: result?.block === true, asks, signals };
  }
  for (const tool of ["bash", "background_run"]) {
    for (const command of dangerous) {
      const result = await check(tool, command);
      assert.equal(result.blocked, true, `${tool}: ${command}`);
      assert.equal(result.asks.length, 1);
    }
    assert.equal((await check(tool, "npm test")).asks.length, 0);
    assert.equal((await check(tool, dangerous[0], { hasUI: false })).blocked, true);
    assert.equal((await check(tool, dangerous[0], { choice: null })).blocked, true);
    assert.equal((await check(tool, dangerous[0], { choice: "Разрешить" })).blocked, false);
    const remembered = await check(tool, dangerous[0], { choice: "Разрешить всегда" });
    assert.equal(remembered.blocked, false);
    assert.equal(remembered.signals.find(s => s.kind === "remember").subject, dangerous[0]);
    const rule = rememberedRule(tool, dangerous[0]);
    assert.equal((await check(tool, dangerous[0], { rules: [rule], hasUI: false })).blocked, false);
    assert.equal((await check(tool, `${dangerous[0]} /tmp/other`, { rules: [rule] })).blocked, true);
    assert.equal((await check(tool, `${dangerous[0]}; echo extra`, { rules: [rule] })).blocked, true);
    assert.equal((await check(tool, "git push -f origin HEAD", { rules: [{ tool, pattern: "^git\\b", action: "allow" }] })).blocked, true);
    assert.equal((await check(tool, "npm test", { rules: [{ tool, action: "deny" }] })).blocked, true);
    assert.equal((await check(tool, "npm test", { rules: [{ tool, action: "ask" }], hasUI: false })).blocked, true);
  }
  const literal = rememberedRule("bash", "rm -rf /tmp/a.b[1]$");
  assert.ok(matchRule([literal], "bash", literal.subject));
  assert.equal(matchRule([literal], "bash", "rm -rf /tmp/axb1"), null);
  assert.equal(matchRule([literal], "background_run", literal.subject), null);
  const writeRule = rememberedRule("write", "/tmp/allowed.txt");
  assert.equal(matchRule([writeRule], "write", "/tmp/other.txt"), null);
  assert.throws(() => rememberedRule("bash", " "));
  assert.equal((await check("write", "", { rules: [{ tool: "write", action: "ask" }], hasUI: false, input: { path: "/tmp/example" } })).blocked, true);
  const longCommand = `git push --force origin ${"x".repeat(160)}`;
  assert.ok((await check("bash", longCommand)).asks[0].includes(longCommand));
  console.log("PASS command variants, foreground/background policy, missing UI, reject/cancel/allow, exact remembered rules, legacy prefixes and full confirmation text");
} finally {
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await rm(directory, { recursive: true, force: true });
}
