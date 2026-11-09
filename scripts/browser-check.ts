/** Isolated local integration test; no model credentials or real browser profile. */
import { app, BrowserWindow } from "electron";
import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentBrowser, browserURL } from "../electron/browser.ts";

// Loopback itself is a secure context even over HTTP. Use a mapped .test origin
// to reproduce ordinary HTTP, where renderer crypto.randomUUID is unavailable.
app.commandLine.appendSwitch("host-resolver-rules", "MAP operator-browser.test 127.0.0.1");
app.commandLine.appendSwitch("no-proxy-server");

async function run() {
const fixture = await fs.mkdtemp(join(tmpdir(), "operator-browser-upload-"));
const attachment = join(fixture, 'attachment with spaces.txt');
await fs.writeFile(attachment, 'USER_AUTHORIZED_SYNTHETIC_ATTACHMENT');
let uploaded = "";
const server = http.createServer((req, res) => {
  if (req.url === "/upload") {
    req.setEncoding("utf8"); req.on("data", chunk => { uploaded += chunk; });
    req.on("end", () => { res.end("accepted"); }); return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.url === "/next") { res.end('<title>Next</title><h1>Navigation verified</h1>'); return; }
  res.end(`<!doctype html><title>Operator browser test</title>
    <label>Name <input id="name"></label><label>Password <input type="password" value="never-show-this"></label>
    <label>Color <select id="color"><option value="red">Red</option><option value="blue">Blue</option></select></label>
    <button id="save">Save</button><button disabled>Disabled</button><button id="change">Change page</button>
    <label>Attachment <input id="attachment" type="file"></label>
    <label>Multiple files <input id="many" type="file" multiple></label><button id="send">Send file</button>
    <label for="hidden-file">Hidden attachment</label><input id="hidden-file" type="file" style="display:none">
    <span id="ticker">0</span><p id="upload-result">No file sent</p>
    <a href="/next">Next page</a><p id="result">Not saved</p>
    <script>
      document.querySelector('#save').onclick = () => { document.querySelector('#result').textContent = document.querySelector('#name').value + ':' + document.querySelector('#color').value; };
      document.querySelector('#change').onclick = () => { document.querySelector('#save').textContent = 'Renamed'; };
      document.querySelector('#send').onclick = async () => {
        const file = document.querySelector('#attachment').files[0];
        if (file) { await fetch('/upload', {method:'POST', body:file}); document.querySelector('#upload-result').textContent='Attachment accepted'; }
      };
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
  await window.webContents.executeJavaScript("document.querySelector('#ticker').textContent = 'unrelated refresh'");
  page = await call({ action: "fill", ...target("Name"), text: 'Dynamic page remains usable' });
  check(!page.error, "unrelated DOM updates do not invalidate target");
  await window.webContents.executeJavaScript("setTimeout(() => document.querySelector('#ticker').textContent = 'ASYNC_READY', 150)");
  page = await call({ action: "wait", tab, text: "ASYNC_READY", timeoutMs: 1500 });
  check(page.matched === true, "bounded wait observes asynchronous text");
  page = await call({ action: "wait", tab, text: "MISSING_FOREVER", timeoutMs: 100 });
  check(page.matched === false && Boolean(page.snapshot), "wait timeout returns fresh state without repeating actions");
  await assert.rejects(call({ action: "wait", tab }), /requires/);
  const renamed = target("Save");
  await window.webContents.executeJavaScript("document.querySelector('#save').textContent = 'Changed target'");
  page = await call({ action: "click", ...renamed });
  check(page.error?.includes("stale"), "changed target is rejected despite retaining its node");
  await window.webContents.executeJavaScript("document.querySelector('#save').textContent = 'Save'");
  page = await call({ action: "snapshot", tab });
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
  page = await call({ action: "upload", ...target("Attachment"), files: [join(fixture, "missing.txt")] });
  check(Boolean(page.error), "missing file refused");
  page = await call({ action: "upload", ...target("Attachment"), files: ["relative.txt"] });
  check(Boolean(page.error), "relative file refused");
  page = await call({ action: "upload", ...target("Attachment"), files: [attachment] });
  check(!page.error && page.elements.some((e: any) => e.files?.includes('attachment with spaces.txt')), "file selected through native browser protocol");
  page = await call({ action: "click", ...target("Send file") });
  for (let i = 0; i < 30 && !page.text.includes("Attachment accepted"); i++) {
    await new Promise(resolve => setTimeout(resolve, 50)); page = await call({ action: "snapshot", tab });
  }
  check(uploaded === 'USER_AUTHORIZED_SYNTHETIC_ATTACHMENT' && page.text.includes("Attachment accepted"), "server actually received complete attachment");
  page = await call({ action: "upload", ...target("Multiple files"), files: [attachment, attachment] });
  check(!page.error && page.elements.some((e: any) => e.multiple && e.files?.length === 2), "multiple file input supported");
  page = await call({ action: "upload", ...target("Hidden attachment"), files: [attachment] });
  check(!page.error && page.elements.some((e: any) => e.name === "Hidden attachment" && e.files?.length === 1), "custom hidden file input supported");
  page = await call({ action: "upload", ...target("Attachment"), files: [attachment, attachment] });
  check(page.error?.includes("one file"), "single-file input rejects multiple files");
  const replacement = target("Save");
  await window.webContents.executeJavaScript("document.querySelector('#save').outerHTML = '<button id=save>Save</button>'");
  page = await call({ action: "click", ...replacement });
  check(page.error?.includes("no longer"), "replaced node cannot reuse old reference");
  enabled = false;
  await assert.rejects(call({ action: "upload", ...target("Attachment"), files: [attachment] }), /выключен/);
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
  await fs.rm(fixture, { recursive: true, force: true });
  app.exit(process.exitCode ?? 0);
}
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
setTimeout(() => { console.error("Browser integration timed out"); app.exit(1); }, 45000).unref();
