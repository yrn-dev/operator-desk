/** Isolated local integration test; no model credentials or real browser profile. */
import { app, BrowserWindow } from "electron";
import http from "node:http";
import assert from "node:assert/strict";
import { AgentBrowser, browserURL } from "../electron/browser.ts";

// Loopback itself is a secure context even over HTTP. Use a mapped .test origin
// to reproduce ordinary HTTP, where renderer crypto.randomUUID is unavailable.
app.commandLine.appendSwitch("host-resolver-rules", "MAP operator-browser.test 127.0.0.1");
app.commandLine.appendSwitch("no-proxy-server");

async function run() {
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.url === "/next") { res.end('<title>Next</title><h1>Navigation verified</h1>'); return; }
  res.end(`<!doctype html><title>Operator browser test</title>
    <label>Name <input id="name"></label><label>Password <input type="password" value="never-show-this"></label>
    <label>Color <select id="color"><option value="red">Red</option><option value="blue">Blue</option></select></label>
    <button id="save">Save</button><button disabled>Disabled</button><button id="change">Change page</button>
    <a href="/next">Next page</a><p id="result">Not saved</p>
    <script>
      document.querySelector('#save').onclick = () => { document.querySelector('#result').textContent = document.querySelector('#name').value + ':' + document.querySelector('#color').value; };
      document.querySelector('#change').onclick = () => { document.querySelector('#save').textContent = 'Renamed'; };
    </script>`);
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address() as { port: number };
let enabled = true;
const browser = new AgentBrowser(() => enabled);
const call = (args: any) => browser.execute(args) as Promise<any>;
let assertions = 0;
function check(value: unknown, message: string) { assert.ok(value, message); assertions++; }
try {
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "https://user:pass@example.com/"]) assert.throws(() => browserURL(url));
  let page = await call({ action: "open", url: `http://operator-browser.test:${address.port}` });
  const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes("operator-browser.test"))!;
  const insecure = await window.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: '({ secure: isSecureContext, uuid: typeof crypto.randomUUID })' }]);
  check(!insecure.secure && insecure.uuid === "undefined", "test reproduces insecure HTTP without renderer randomUUID");
  check(page.title === "Operator browser test", "page loaded");
  check(!JSON.stringify(page).includes("never-show-this"), "password value redacted");
  const tab = page.tab;
  const target = (name: string) => ({ tab, snapshot: page.snapshot, ref: page.elements.find((el: any) => el.name === name).ref });
  const stale = target("Save");
  page = await call({ action: "fill", ...target("Name"), text: 'Alice "quoted" ${literal}' });
  check(page.elements.some((e: any) => e.value === 'Alice "quoted" ${literal}'), "fill safely preserves literal text");
  const rejected = await call({ action: "click", ...stale });
  check(rejected.error?.includes("stale"), "stale snapshot rejected");
  page = rejected;
  page = await call({ action: "select", ...target("Color"), value: "blue" });
  check(page.elements.some((e: any) => e.value === "blue"), "select changed");
  page = await call({ action: "click", ...target("Save") });
  check(page.text.includes('Alice "quoted" ${literal}:blue'), "form result observed");
  page = await call({ action: "click", ...target("Disabled") });
  check(page.error?.includes("disabled"), "disabled button refused");
  enabled = false;
  await assert.rejects(call({ action: "click", ...target("Save") }), /выключен/);
  enabled = true;
  await assert.rejects(browser.execute({ action: "open", url: "https://example.com" }, () => false), /cancelled/);
  page = await call({ action: "click", ...target("Next page") });
  check(page.title === "Next", "navigation observed after click");
  page = await call({ action: "back", tab });
  if (page.title !== "Operator browser test") console.error("Back state:", JSON.stringify(page));
  check(page.title === "Operator browser test", "back navigation observed");
  const other = new AgentBrowser(() => true);
  await assert.rejects(other.execute({ action: "snapshot", tab }), /Unknown tab/);
  other.close();
  const closed = await call({ action: "close", tab });
  check(closed.tabs.length === 0, "closed window removed");
  console.log(`PASS browser integration: ${assertions} state checks plus URL, permission, cancellation and ownership checks`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  browser.close();
  server.close();
  app.exit(process.exitCode ?? 0);
}
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
setTimeout(() => { console.error("Browser integration timed out"); app.exit(1); }, 45000).unref();
