/** Видит ли модель картинку во втором ходу, а не только в первом сообщении. */
import fs from "node:fs";
import { OperatorLine } from "../electron/rpc.ts";

const data = fs.readFileSync("build/icon.png").toString("base64");
const model = process.argv[2] ?? "qwen3-8";
console.log("модель:", model);
const line = new OperatorLine("vision", { cwd: process.cwd(), model, provider: "alem-ai" });

let answer = "";
line.on("event", (event: any) => {
  if (event.type === "message_end" && event.message?.role === "assistant") {
    const text = (event.message.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (text) answer = text;
  }
});
line.start();

const waitIdle = () =>
  new Promise<void>((resolve) => {
    const off = line.on("event", (e: any) => {
      if (e.type === "agent_end") resolve();
    });
    void off;
  });

await new Promise((r) => setTimeout(r, 1500));

console.log("ход 1: обычный вопрос");
await line.send("prompt", { message: "Ответь одним словом: привет" });
await waitIdle();
console.log("  ответ:", answer.slice(0, 60));

console.log("ход 2: та же сессия, теперь с картинкой");
await line.send("prompt", {
  message: "Опиши одним предложением, что на этом изображении.",
  images: [{ type: "image", data, mimeType: "image/png" }],
});
await waitIdle();
console.log("  ответ:", answer.slice(0, 200));

const sees = !/не\s+(могу|получил|вижу)|cannot see|can’t see|can't see/i.test(answer);
console.log(`\nвидит картинку во втором ходу: ${sees ? "да" : "нет"}`);
line.stop();
process.exit(sees ? 0 : 1);
