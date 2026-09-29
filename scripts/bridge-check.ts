/** Проверка моста: режим плана должен блокировать запись и bash. */
import { OperatorLine } from "../electron/rpc.ts";

const line = new OperatorLine("bridge", {
  cwd: "/tmp/bridge-test",
  extensions: ["/home/yernur/operator-desk/electron/bridge/desk-bridge.mjs"],
  env: {
    OPERATOR_DESK_CONFIG: "/tmp/bridge-test/config.json",
    OPERATOR_DESK_CHECKPOINTS: "/tmp/bridge-test/checkpoints",
  },
});

const notes: string[] = [];
line.on("event", (event: any) => {
  if (event.type === "extension_ui_request") notes.push(`ui:${event.method}`);
  if (event.type === "tool_execution_end") {
    const text = JSON.stringify(event.result ?? "").slice(0, 160);
    notes.push(`tool ${event.toolName} isError=${event.isError} ${text}`);
  }
});
line.on("fatal", (m: string) => { console.error("сбой:", m); process.exit(1); });
line.start();

const idle = new Promise<void>((r) => line.on("event", (e: { type: string }) => e.type === "agent_end" && r()));
await new Promise((r) => setTimeout(r, 1500));
await line.send("prompt", { message: "Создай файл /tmp/bridge-test/should-not-exist.txt со словом привет. Ничего не спрашивай." });
await Promise.race([idle, new Promise((_, rej) => setTimeout(() => rej(new Error("таймаут")), 90_000))]);

const fs = await import("node:fs");
console.log(notes.join("\n"));
console.log(`\nфайл создан: ${fs.existsSync("/tmp/bridge-test/should-not-exist.txt") ? "ДА (плохо)" : "нет (правильно)"}`);
line.stop();
process.exit(fs.existsSync("/tmp/bridge-test/should-not-exist.txt") ? 1 : 0);
