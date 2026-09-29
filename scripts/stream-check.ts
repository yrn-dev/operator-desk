/** Стриминг ответа и события инструментов должны идти без задержек. */
import fs from "node:fs";
import { OperatorLine } from "../electron/rpc.ts";

fs.mkdirSync("/tmp/stream-test", { recursive: true });
fs.writeFileSync("/tmp/stream-test/policy.json", JSON.stringify({ rules: [] }));

const line = new OperatorLine("stream", {
  cwd: "/tmp/stream-test",
  provider: "alem-ai",
  model: "qwen3-8",
  extensions: ["/home/yernur/operator-desk/electron/bridge/desk-bridge.mjs"],
  appendPrompt: "/home/yernur/operator-desk/electron/bridge/desk-prompt.md",
  env: {
    OPERATOR_DESK_CONFIG: "/tmp/stream-test/policy.json",
    OPERATOR_DESK_CHECKPOINTS: "/tmp/stream-test/cp",
    OPERATOR_DESK_JOBS: "/tmp/stream-test/jobs",
    OPERATOR_DESK_MCP: "/tmp/stream-test/mcp.json",
  },
});

let updates = 0;
let firstAt = 0;
const started = Date.now();
line.on("event", (e: any) => {
  if (e.type === "message_update") {
    updates++;
    if (!firstAt) firstAt = Date.now() - started;
  }
});
line.on("fatal", (m: string) => { console.error("сбой:", m); process.exit(1); });
line.start();

const idle = new Promise<void>((r) => line.on("event", (e: any) => e.type === "agent_end" && r()));
await new Promise((r) => setTimeout(r, 1500));
await line.send("prompt", { message: "Посчитай от 1 до 10 через запятую." });
await Promise.race([idle, new Promise((_, rej) => setTimeout(() => rej(new Error("таймаут 90с")), 90_000))]);

console.log(`первый фрагмент через ${firstAt} мс · всего обновлений потока: ${updates} · весь ответ за ${Date.now() - started} мс`);
line.stop();
process.exit(updates > 5 ? 0 : 1);
