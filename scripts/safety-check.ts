/** Обычная работа идёт без вопросов, опасная команда требует подтверждения. */
import fs from "node:fs";
import { OperatorLine } from "../electron/rpc.ts";

fs.mkdirSync("/tmp/safety-test", { recursive: true });
fs.writeFileSync("/tmp/safety-test/policy.json", JSON.stringify({ rules: [] }));
fs.rmSync("/tmp/safety-test/note.txt", { force: true });

function run(message: string, answer: string | null) {
  return new Promise<{ asked: boolean; created: boolean }>((resolve) => {
    const line = new OperatorLine("safety", {
      cwd: "/tmp/safety-test",
      extensions: ["/home/yernur/operator-desk/electron/bridge/desk-bridge.mjs"],
      env: {
        OPERATOR_DESK_CONFIG: "/tmp/safety-test/policy.json",
        OPERATOR_DESK_CHECKPOINTS: "/tmp/safety-test/cp",
      },
    });
    let asked = false;
    line.on("event", (event: any) => {
      if (event.type === "extension_ui_request" && event.method === "select") {
        asked = true;
        console.log(`  спросил: ${event.title.slice(0, 70)}`);
        line.respondUI(event.id, answer ? { value: answer } : { cancelled: true });
      }
      if (event.type === "agent_end") {
        setTimeout(() => {
          line.stop();
          resolve({ asked, created: fs.existsSync("/tmp/safety-test/note.txt") });
        }, 300);
      }
    });
    line.start();
    setTimeout(() => line.send("prompt", { message }), 1500);
  });
}

console.log("1) обычная запись файла:");
const plain = await run("Запиши слово привет в ./note.txt инструментом write.", null);
console.log(`   вопрос задан: ${plain.asked ? "да (плохо)" : "нет (правильно)"} · файл создан: ${plain.created ? "да" : "нет"}`);

console.log("2) опасная команда:");
const danger = await run("Выполни в bash: rm -rf /tmp/safety-test/victim", "Отклонить");
console.log(`   вопрос задан: ${danger.asked ? "да (правильно)" : "нет (плохо)"}`);

process.exit(!plain.asked && plain.created && danger.asked ? 0 : 1);
