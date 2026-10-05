/** Субагент должен отработать в своём процессе и вернуть только итог. */
import fs from "node:fs";
import { OperatorLine } from "../electron/rpc.ts";

fs.mkdirSync("/tmp/sub-test/src", { recursive: true });
fs.writeFileSync("/tmp/sub-test/src/a.ts", "export const alpha = 1;\nexport function findMe() { return 42; }\n");
fs.writeFileSync("/tmp/sub-test/src/b.ts", "export const beta = 2;\n");
fs.writeFileSync("/tmp/sub-test/policy.json", JSON.stringify({ rules: [] }));

const line = new OperatorLine("sub", {
  cwd: "/tmp/sub-test",
  extensions: ["/home/yernur/operator-desk/electron/bridge/desk-bridge.mjs"],
  env: { OPERATOR_DESK_CONFIG: "/tmp/sub-test/policy.json", OPERATOR_DESK_CHECKPOINTS: "/tmp/sub-test/cp" },
});

let used = false;
let sawChildActivity = false;
let sawLiveActivity = false;
line.on("event", (event: any) => {
  if (event.type === "tool_execution_start" && event.toolName === "subagent") {
    used = true;
    console.log("субагент запущен, задача:", String(event.args?.task ?? "").slice(0, 80));
  }
  if (event.type === "tool_execution_update" && event.toolName === "subagent") {
    sawLiveActivity ||= (event.partialResult?.details?.steps?.length ?? 0) > 0;
  }
  if (event.type === "tool_execution_end" && event.toolName === "subagent") {
    const text = (event.result?.content ?? []).map((c: any) => c.text).join("").slice(0, 200);
    const steps = event.result?.details?.steps ?? [];
    sawChildActivity = steps.some((step: any) => step.name === "read" || step.name === "grep" || step.name === "find" || step.name === "ls");
    console.log("итог субагента:", text.replace(/\n/g, " "));
    console.log("действия субагента:", steps.map((step: any) => step.name).join(", "));
  }
});
line.on("fatal", (m: string) => { console.error("сбой:", m); process.exit(1); });
line.start();

const idle = new Promise<void>((r) => line.on("event", (e: any) => e.type === "agent_end" && r()));
await new Promise((r) => setTimeout(r, 1500));
await line.send("prompt", {
  message: "Используй инструмент subagent, чтобы найти в папке src функцию findMe и сказать, что она возвращает. Сам файлы не читай.",
});
await Promise.race([idle, new Promise((_, rej) => setTimeout(() => rej(new Error("таймаут")), 180_000))]);

console.log(`\nсубагент использован: ${used ? "да" : "нет"}`);
console.log(`действия переданы: ${sawChildActivity ? "да" : "нет"}`);
console.log(`живой ход работы: ${sawLiveActivity ? "да" : "нет"}`);
line.stop();
process.exit(used && sawChildActivity && sawLiveActivity ? 0 : 1);
