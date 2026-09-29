/** Фоновый процесс должен стартовать, писать лог и останавливаться. */
import fs from "node:fs";
import { OperatorLine } from "../electron/rpc.ts";

fs.mkdirSync("/tmp/jobs-test", { recursive: true });
fs.writeFileSync("/tmp/jobs-test/policy.json", JSON.stringify({ rules: [] }));

const line = new OperatorLine("jobs", {
  cwd: "/tmp/jobs-test",
  extensions: ["/home/yernur/operator-desk/electron/bridge/desk-bridge.mjs"],
  env: {
    OPERATOR_DESK_CONFIG: "/tmp/jobs-test/policy.json",
    OPERATOR_DESK_CHECKPOINTS: "/tmp/jobs-test/cp",
    OPERATOR_DESK_JOBS: "/tmp/jobs-test/jobs",
  },
});

const used = new Set<string>();
line.on("event", (event: any) => {
  if (event.type === "tool_execution_end" && /background/.test(event.toolName ?? "")) {
    used.add(event.toolName);
    console.log(`${event.toolName}: ${(event.result?.content ?? []).map((c: any) => c.text).join("").slice(0, 120)}`);
  }
});
line.on("fatal", (m: string) => { console.error("сбой:", m); process.exit(1); });
line.start();

const idle = new Promise<void>((r) => line.on("event", (e: any) => e.type === "agent_end" && r()));
await new Promise((r) => setTimeout(r, 1500));
await line.send("prompt", {
  message:
    "Запусти в фоне инструментом background_run команду: for i in 1 2 3; do echo tick-$i; sleep 1; done. " +
    "Затем через background_check посмотри её вывод и скажи, что увидел.",
});
await Promise.race([idle, new Promise((_, rej) => setTimeout(() => rej(new Error("таймаут")), 150_000))]);

console.log(`\nиспользовано инструментов: ${[...used].join(", ") || "нет"}`);
line.stop();
process.exit(used.has("background_run") ? 0 : 1);
