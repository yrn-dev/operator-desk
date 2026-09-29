/** MCP-сервер должен подключиться, а его инструмент — стать доступным модели. */
import fs from "node:fs";
import { OperatorLine } from "../electron/rpc.ts";

// Проверка готовит себе всё сама: временные файлы между запусками пропадают.
const dir = "/tmp/mcp-test";
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(`${dir}/policy.json`, JSON.stringify({ rules: [] }));
fs.writeFileSync(
  `${dir}/mcp.json`,
  JSON.stringify({ servers: { fake: { command: "node", args: [`${dir}/fake-server.mjs`] } } }, null, 2),
);
fs.writeFileSync(
  `${dir}/fake-server.mjs`,
  `import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1.0" } } });
  } else if (msg.method === "tools/list") {
    send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{
      name: "echo_upper",
      description: "Возвращает переданный текст заглавными буквами.",
      inputSchema: { type: "object", properties: { text: { type: "string", description: "Текст" } }, required: ["text"] },
    }] } });
  } else if (msg.method === "tools/call") {
    const text = String(msg.params?.arguments?.text ?? "");
    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: text.toUpperCase() }] } });
  }
});
`,
);

const line = new OperatorLine("mcp", {
  cwd: "/tmp/mcp-test",
  extensions: ["/home/yernur/operator-desk/electron/bridge/desk-bridge.mjs"],
  env: {
    OPERATOR_DESK_CONFIG: "/tmp/mcp-test/policy.json",
    OPERATOR_DESK_CHECKPOINTS: "/tmp/mcp-test/cp",
    OPERATOR_DESK_MCP: "/tmp/mcp-test/mcp.json",
  },
});

let called = false;
line.on("event", (event: any) => {
  if (event.type === "extension_ui_request" && event.method === "notify") {
    const message = String(event.message ?? "");
    if (message.includes('"mcp"')) console.log("подключение MCP:", message.slice(8, 160));
  }
  if (event.type === "tool_execution_end" && event.toolName?.startsWith("fake__")) {
    called = true;
    console.log("ответ инструмента MCP:", (event.result?.content ?? []).map((c: any) => c.text).join(""));
  }
});
line.on("fatal", (m: string) => { console.error("сбой:", m); process.exit(1); });
line.start();

const idle = new Promise<void>((r) => line.on("event", (e: any) => e.type === "agent_end" && r()));
await new Promise((r) => setTimeout(r, 3000));
await line.send("prompt", { message: "Вызови инструмент fake__echo_upper с текстом «привет мир» и покажи результат." });
await Promise.race([idle, new Promise((_, rej) => setTimeout(() => rej(new Error("таймаут")), 120_000))]);

console.log(`\nинструмент MCP использован: ${called ? "да" : "нет"}`);
line.stop();
process.exit(called ? 0 : 1);
