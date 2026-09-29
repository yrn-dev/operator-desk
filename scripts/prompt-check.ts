/** Агент должен знать про среду, не потеряв основной системный промпт. */
import fs from "node:fs";
import { OperatorLine } from "../electron/rpc.ts";

fs.mkdirSync("/tmp/prompt-test", { recursive: true });
fs.writeFileSync("/tmp/prompt-test/policy.json", JSON.stringify({ rules: [] }));

const line = new OperatorLine("prompt", {
  cwd: "/tmp/prompt-test",
  extensions: ["/home/yernur/operator-desk/electron/bridge/desk-bridge.mjs"],
  appendPrompt: "/home/yernur/operator-desk/electron/bridge/desk-prompt.md",
  env: {
    OPERATOR_DESK_CONFIG: "/tmp/prompt-test/policy.json",
    OPERATOR_DESK_CHECKPOINTS: "/tmp/prompt-test/cp",
    OPERATOR_DESK_JOBS: "/tmp/prompt-test/jobs",
  },
});

let answer = "";
line.on("event", (event: any) => {
  if (event.type === "message_end" && event.message?.role === "assistant") {
    const text = (event.message.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (text) answer = text;
  }
});
line.on("fatal", (m: string) => { console.error("сбой:", m); process.exit(1); });
line.start();

const idle = new Promise<void>((r) => line.on("event", (e: any) => e.type === "agent_end" && r()));
await new Promise((r) => setTimeout(r, 1500));
await line.send("prompt", {
  message: "Пользователь просит тебя работать со Slack. Такого инструмента у тебя нет. Ответь коротко: что ему сделать?",
});
await Promise.race([idle, new Promise((_, rej) => setTimeout(() => rej(new Error("таймаут")), 120_000))]);

console.log("ответ агента:\n" + answer.slice(0, 600));
const knows = /mcp/i.test(answer);
console.log(`\nзнает про MCP: ${knows ? "да" : "нет"}`);
line.stop();
process.exit(knows ? 0 : 1);
