/** Проверка разрешений: запрос доходит до клиента, ответ решает судьбу вызова. */
import fs from "node:fs";
import { OperatorLine } from "../electron/rpc.ts";

fs.rmSync("/tmp/bridge-test/allowed.txt", { force: true });
fs.writeFileSync("/tmp/bridge-test/config.json", JSON.stringify({ mode: "ask", rules: [] }));

const line = new OperatorLine("perm", {
  cwd: "/tmp/bridge-test",
  extensions: ["/home/yernur/operator-desk/electron/bridge/desk-bridge.mjs"],
  env: {
    OPERATOR_DESK_CONFIG: "/tmp/bridge-test/config.json",
    OPERATOR_DESK_CHECKPOINTS: "/tmp/bridge-test/checkpoints",
  },
});

line.on("event", (event: any) => {
  if (event.type !== "extension_ui_request") return;
  if (event.method === "notify") {
    console.log("сигнал моста:", String(event.message).slice(0, 90));
    return;
  }
  console.log(`диалог: ${event.method} «${event.title}» варианты=${JSON.stringify(event.options ?? [])}`);
  // Отвечаем так же, как ответит окно десктопа.
  line.respondUI(event.id, { value: "Разрешить" });
});
line.on("fatal", (m: string) => { console.error("сбой:", m); process.exit(1); });
line.on("event", (event: any) => {
  if (event.type === "tool_execution_end") console.log(`инструмент ${event.toolName} ошибка=${event.isError}`);
  if (event.type === "message_end" && event.message?.role === "assistant") {
    const text = (event.message.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (text) console.log("ответ:", text.slice(0, 120));
  }
});
line.start();

const idle = new Promise<void>((r) => line.on("event", (e: { type: string }) => e.type === "agent_end" && r()));
await new Promise((r) => setTimeout(r, 1500));
await line.send("prompt", { message: "Создай файл /tmp/bridge-test/allowed.txt со словом привет." });
await Promise.race([idle, new Promise((_, rej) => setTimeout(() => rej(new Error("таймаут")), 90_000))]);

const created = fs.existsSync("/tmp/bridge-test/allowed.txt");
const snapshots = fs.existsSync("/tmp/bridge-test/checkpoints") ? fs.readdirSync("/tmp/bridge-test/checkpoints").length : 0;
console.log(`\nфайл создан после разрешения: ${created ? "да" : "нет"} · снимков в чекпоинтах: ${snapshots}`);

line.stop();
process.exit(created ? 0 : 1);
