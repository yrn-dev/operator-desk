/** Видит ли модель картинку, если до неё в истории были вызовы инструментов. */
import fs from "node:fs";
import { OperatorLine } from "../electron/rpc.ts";

const data = fs.readFileSync("/tmp/shot-1280.png").toString("base64");
const line = new OperatorLine("vt", { cwd: "/tmp", provider: "alem-ai", model: "qwen3-8" });

let answer = "";
line.on("event", (e: any) => {
  if (e.type === "message_end" && e.message?.role === "assistant") {
    const t = (e.message.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (t) answer = t;
  }
});
line.start();

const idle = () => new Promise<void>((r) => line.on("event", (e: any) => e.type === "agent_end" && r()));
await new Promise((r) => setTimeout(r, 1500));

console.log("ход 1: заставляем вызвать инструмент");
await line.send("prompt", { message: "Выполни в bash: echo привет" });
await idle();
console.log("  ответ:", answer.slice(0, 60).replace(/\n/g, " "));

console.log("ход 2: теперь картинка");
await line.send("prompt", { message: "Опиши одним предложением, что на этом изображении.", images: [{ type: "image", data, mimeType: "image/png" }] });
await idle();
console.log("  ответ:", answer.slice(0, 180).replace(/\n/g, " "));

const blind = /не\s+(могу|вижу|получил|прикреплен)|пуст|cannot see/i.test(answer);
console.log(`\nвидит после вызова инструмента: ${blind ? "НЕТ" : "да"}`);
line.stop();
process.exit(blind ? 1 : 0);
