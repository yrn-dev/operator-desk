/** Агент должен сам снять экран и описать увиденное. */
import fs from "node:fs";
import { OperatorLine } from "../electron/rpc.ts";

fs.mkdirSync("/tmp/auto-test", { recursive: true });
fs.writeFileSync("/tmp/auto-test/policy.json", JSON.stringify({ rules: [], computerUse: true }));

const line = new OperatorLine("auto", {
  cwd: "/tmp/auto-test",
  provider: "alem-ai",
  model: "qwen3-8",
  extensions: ["/home/yernur/operator-desk/electron/bridge/desk-bridge.mjs"],
  appendPrompt: "/home/yernur/operator-desk/electron/bridge/desk-prompt.md",
  env: {
    OPERATOR_DESK_CONFIG: "/tmp/auto-test/policy.json",
    OPERATOR_DESK_CHECKPOINTS: "/tmp/auto-test/cp",
    OPERATOR_DESK_JOBS: "/tmp/auto-test/jobs",
  },
});

let sawScreenshot = false;
let answer = "";
line.on("event", (event: any) => {
  if (event.type === "tool_execution_end" && event.toolName === "computer") {
    console.log(`computer(${event.args?.action ?? "?"}) → ${(event.result?.content ?? []).map((c: any) => c.text).join("").slice(0, 110)}`);
  }
  if (event.type === "tool_execution_end" && event.toolName === "computer") {
    const text = (event.result?.content ?? []).map((c: any) => c.text).join("");
    // Разбор снимка приходит текстом: изображение в диалог не попадает.
    if (text.length > 80 && !event.result?.isError) sawScreenshot = true;
  }
  if (event.type === "message_end" && event.message?.role === "assistant") {
    const text = (event.message.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (text) answer = text;
  }
});
line.on("fatal", (m: string) => { console.error("сбой:", m); process.exit(1); });
line.start();

const idle = new Promise<void>((r) => line.on("event", (e: any) => e.type === "agent_end" && r()));
await new Promise((r) => setTimeout(r, 1500));
await line.send("prompt", { message: "Посмотри на мой экран и опиши одним предложением, что на нём происходит." });
await Promise.race([idle, new Promise((_, rej) => setTimeout(() => rej(new Error("таймаут")), 180_000))]);

console.log("\nответ агента: " + answer.slice(0, 300));
console.log(`экран разобран: ${sawScreenshot ? "да" : "нет"}`);
line.stop();
process.exit(sawScreenshot ? 0 : 1);
