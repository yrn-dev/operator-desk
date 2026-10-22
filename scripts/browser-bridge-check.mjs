import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBrowserTool } from "../electron/bridge/browser.mjs";

const dir = await mkdtemp(join(tmpdir(), "operator-browser-bridge-"));
try {
  let calls = 0;
  const notify = async ({ id, input }) => {
    calls++;
    await writeFile(join(dir, `${id}.json`), JSON.stringify({ tab: "test", text: input.url ?? "local" }));
  };
  const off = createBrowserTool(() => false, notify, dir);
  assert.equal((await off.execute("off", { action: "open", url: "http://localhost" })).isError, true);
  assert.equal(calls, 0);
  const tool = createBrowserTool(() => true, notify, dir);
  const result = await tool.execute("on", { action: "open", url: "http://localhost" });
  assert.equal(result.isError, false);
  assert.equal(result.details.tab, "test");
  assert.deepEqual(await readdir(dir), []);
  const controller = new AbortController();
  controller.abort();
  assert.equal((await tool.execute("abort", { action: "tabs" }, controller.signal)).isError, true);
  assert.equal(calls, 1);
  const errorTool = createBrowserTool(() => true, async ({ id }) => {
    await writeFile(join(dir, `${id}.json`), JSON.stringify({ error: "Unknown tab" }));
  }, dir);
  assert.equal((await errorTool.execute("error", { action: "snapshot", tab: "missing" })).isError, true);
  assert.deepEqual(await readdir(dir), []);
  console.log("PASS browser bridge: disabled, result, cancellation, error and cleanup");
} finally { await rm(dir, { recursive: true, force: true }); }
