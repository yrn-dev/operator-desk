import fs from "node:fs";
import { OperatorLine } from "../electron/rpc.ts";
fs.writeFileSync("/tmp/bridge-test/config.json", JSON.stringify({ mode: "ask", rules: [] }));
const line = new OperatorLine("raw", {
  cwd: "/tmp/bridge-test",
  extensions: ["/home/yernur/operator-desk/electron/bridge/desk-bridge.mjs"],
  env: { OPERATOR_DESK_CONFIG: "/tmp/bridge-test/config.json", OPERATOR_DESK_CHECKPOINTS: "/tmp/bridge-test/cp" },
});
const seen = new Map<string, number>();
line.on("event", (e: any) => {
  seen.set(e.type, (seen.get(e.type) ?? 0) + 1);
  if (e.type === "extension_ui_request") console.log("UI-ЗАПРОС:", JSON.stringify(e).slice(0, 200));
});
line.start();
await new Promise((r) => setTimeout(r, 2000));
const idle = new Promise<void>((r) => line.on("event", (e: any) => e.type === "agent_end" && r()));
await line.send("prompt", { message: "Запиши слово привет в файл ./note.txt инструментом write." });
await Promise.race([idle, new Promise((r) => setTimeout(r, 60_000))]);
console.log("типы событий:", [...seen.entries()].map(([k, v]) => `${k}×${v}`).join(", "));
console.log("stderr:", (line as any).stderr?.slice?.(-300) ?? "нет");
line.stop();
