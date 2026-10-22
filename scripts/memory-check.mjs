/** Packaged Desktop benchmark: synthetic history, no model or network requests. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager } from '../vendor/node_modules/pzero-operator/dist/core/session-manager.js';

const label = process.argv[2] ?? 'baseline';
const binary = resolve(process.argv[3] ?? 'release/0.3.4/linux-unpacked/operator-desk');
const root = fs.mkdtempSync(join(tmpdir(), 'operator-memory-'));
const home = join(root, 'home'), agent = join(home, '.opr/agent'), profile = join(root, 'config/operator-desk');
fs.mkdirSync(agent, { recursive: true }); fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(join(agent, 'auth.json'), JSON.stringify({ 'alem-ai': { type: 'api_key', key: 'synthetic-only' } }));
fs.writeFileSync(join(agent, 'settings.json'), JSON.stringify({ defaultProvider: 'alem-ai', defaultModel: 'qwen3-8' }));
const manager = SessionManager.create(home, join(agent, 'sessions/--memory--'));
manager.appendModelChange('alem-ai', 'qwen3-8'); manager.appendThinkingLevelChange('off');
const turns = 240;
const usage = { input: 100, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 200, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
for (let i = 0; i < turns; i++) {
  manager.appendMessage({ role: 'user', content: [{ type: 'text', text: `MEMORY_FIXTURE_${i}: проверь файл и покажи результат` }], timestamp: Date.now() });
  manager.appendMessage({ role: 'assistant', provider: 'alem-ai', model: 'qwen3-8', api: 'openai-completions', usage,
    stopReason: 'toolUse', content: [{ type: 'text', text: `Ответ ${i}. Проверены значения:\n\n|Поле|Значение|\n|---|---|\n|Результат|Готово|\n\n\`\`\`javascript\n${'const value = { ok: true, size: 123 };\n'.repeat(12)}\`\`\`` },
      { type: 'toolCall', id: `tool-${i}`, name: 'read', arguments: { path: `fixture-${i}.txt` } }], timestamp: Date.now() });
  manager.appendMessage({ role: 'toolResult', toolCallId: `tool-${i}`, toolName: 'read', content: [{ type: 'text', text: 'Synthetic tool output.\n'.repeat(200) }], isError: false, timestamp: Date.now() });
}
fs.writeFileSync(join(profile, 'desk-sessions.json'), JSON.stringify([manager.getSessionFile()]));
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(root, 'config'), OPERATOR_CODING_AGENT_DIR: agent };
delete env.ELECTRON_RUN_AS_NODE; delete env.OPERATOR_DESK_PROMPT; delete env.OPERATOR_DESK_ATTACH;
const log = fs.openSync(join(root, 'desktop.log'), 'w');
const started = performance.now();
const app = spawn('xvfb-run', ['-a', binary, '--ozone-platform=x11', '--remote-debugging-port=0'], { env, cwd: home, detached: true, stdio: ['ignore', log, log] });
const delay = ms => new Promise(ok => setTimeout(ok, ms));
let ws;
function processes() {
  const all = [];
  for (const pid of fs.readdirSync('/proc').filter(s => /^\d+$/.test(s))) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
      all.push({ pid: Number(pid), ppid: Number(stat[1]), ticks: Number(stat[11]) + Number(stat[12]), cmd: fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ') });
    } catch {}
  }
  const descendants = new Set([app.pid]);
  for (let changed = true; changed;) { changed = false; for (const p of all) if (descendants.has(p.ppid) && !descendants.has(p.pid)) { descendants.add(p.pid); changed = true; } }
  return all.filter(p => {
    if (!descendants.has(p.pid)) return false;
    try { return fs.readlinkSync(`/proc/${p.pid}/exe`) === binary; } catch { return false; }
  }).map(p => {
    const mem = fs.readFileSync(`/proc/${p.pid}/smaps_rollup`, 'utf8');
    const isAgent = fs.readFileSync(`/proc/${p.pid}/environ`, 'utf8').split('\0').includes('ELECTRON_RUN_AS_NODE=1');
    return { pid: p.pid, role: isAgent ? 'agent' : p.cmd.includes('--type=') ? p.cmd.match(/--type=(\S+)/)[1] : 'main',
      pssKiB: Number(mem.match(/^Pss:\s+(\d+)/m)?.[1] ?? 0), rssKiB: Number(mem.match(/^Rss:\s+(\d+)/m)?.[1] ?? 0), ticks: p.ticks };
  });
}
try {
  let port;
  for (let i = 0; i < 150; i++) { try { port = Number(fs.readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); break; } catch {} await delay(100); }
  assert.ok(port, `No debug port: ${root}`);
  let page;
  for (let i = 0; i < 100; i++) { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p => p.type === 'page'); if (page) break; await delay(100); }
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let id = 0; const pending = new Map();
  ws.onmessage = ({ data }) => { const m = JSON.parse(data), p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.fail(new Error(JSON.stringify(m.error))) : p.ok(m.result); } };
  const cdp = (method, params = {}) => new Promise((ok, fail) => { const seq = ++id, timer = setTimeout(() => fail(new Error(`Timeout ${method}`)), 60000); pending.set(seq, { ok, fail, timer }); ws.send(JSON.stringify({ id: seq, method, params })); });
  const evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  for (let i = 0; i < 100; i++) { if (await evaluate('Boolean(window.operator)')) break; await delay(100); }
  let state;
  for (let i = 0; i < 100; i++) {
    state = await evaluate("window.operator.send('session-1','get_state').catch(() => null)");
    if (state?.model) break;
    await delay(100);
  }
  assert.ok(state?.model, 'Initial agent did not become ready');
  const readyMs = Math.round(performance.now() - started);
  await cdp('Performance.enable'); await delay(1500);
  const snapshot = async () => {
    const procs = processes();
    const metrics = Object.fromEntries((await cdp('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    return { pssMiB: Math.round(procs.reduce((sum, p) => sum + p.pssKiB, 0) / 1024), agents: procs.filter(p => p.role === 'agent').length,
      heapMiB: Math.round(metrics.JSHeapUsedSize / 1024 / 1024), domNodes: metrics.Nodes, processes: procs };
  };
  const empty = await snapshot();
  const restoreStart = performance.now();
  await evaluate(`document.querySelector('[title^="MEMORY_FIXTURE_0"]').click()`);
  for (let i = 0; i < 400; i++) { if (await evaluate(`document.body.textContent.includes('MEMORY_FIXTURE_${turns - 1}:')`)) break; await delay(100); }
  assert.ok(await evaluate(`document.body.textContent.includes('MEMORY_FIXTURE_${turns - 1}:')`), 'History not restored');
  const restoreMs = Math.round(performance.now() - restoreStart);
  await delay(2000);
  const history = await snapshot();
  const frameTimes = await evaluate(`(async () => { const values=[]; let before=performance.now(); for(let i=0;i<60;i++){ await new Promise(requestAnimationFrame); const now=performance.now(); values.push(now-before); before=now; } return values.sort((a,b)=>a-b); })()`);
  const idle = processes(), idleStart = performance.now(); await delay(2000); const after = processes();
  const ticks = after.reduce((sum,p) => sum + Math.max(0, p.ticks - (idle.find(q => q.pid===p.pid)?.ticks ?? p.ticks)), 0);
  // Linux's exported /proc stat uses USER_HZ=100 on this test host.
  const result = { label, root, readyMs, restoreMs, turns, empty, history, idleCpuPercent: Math.round(ticks / ((performance.now()-idleStart)/1000)), frameP95Ms: Math.round(frameTimes[56]), passed: true };
  if (label !== 'baseline') {
    assert.equal(history.agents, 1, 'Opening history must replace the empty agent');
    assert.ok(await evaluate("document.querySelectorAll('.feed .md').length <= 35"), 'History DOM must be bounded');
    await evaluate("document.querySelector('.feed').parentElement.scrollTop = 0"); await delay(100);
    await evaluate("document.querySelector('.history-more').click()"); await delay(200);
    assert.ok(await evaluate("document.querySelector('.feed').textContent.includes('MEMORY_FIXTURE_180:')"), 'Earlier page missing');
    assert.ok(await evaluate("document.querySelector('.feed').parentElement.scrollTop > 100"), 'Prepending history lost scroll position');
    for (let i = 0; i < 10; i++) {
      if (!await evaluate("Boolean(document.querySelector('.history-more'))")) break;
      await evaluate("document.querySelector('.feed').parentElement.scrollTop = 0"); await delay(50);
      await evaluate("document.querySelector('.history-more').click()"); await delay(100);
    }
    assert.ok(await evaluate("document.querySelector('.feed').textContent.includes('MEMORY_FIXTURE_0:')"), 'Oldest message unavailable');
    await evaluate("{ const el=document.querySelector('.feed').parentElement; el.scrollTop=el.scrollHeight; }"); await delay(200);
    assert.ok(await evaluate("document.querySelectorAll('.feed .md').length <= 35"), 'Returning to live tail must release old DOM');
    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(join(root, 'history.png'), Buffer.from(shot.data, 'base64'));
    result.historyPagingVerified = true;
  }
  fs.writeFileSync(join(root, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { ws?.close(); if (app.exitCode === null) { try { process.kill(-app.pid, 'SIGTERM'); } catch {} } fs.closeSync(log); }
