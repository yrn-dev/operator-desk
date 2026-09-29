/** У модели maxImages=1 — видит ли она вторую картинку в той же сессии. */
import fs from "node:fs";
import { OperatorLine } from "../electron/rpc.ts";

const shot = fs.readFileSync("/tmp/shot-1280.png").toString("base64");
const icon = fs.readFileSync("build/icon.png").toString("base64");
const line = new OperatorLine("two", { cwd: "/tmp", provider: "alem-ai", model: "qwen3-8" });

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

console.log("картинка 1 (иконка):");
await line.send("prompt", { message: "Что на картинке? Одно предложение.", images: [{ type: "image", data: icon, mimeType: "image/png" }] });
await idle();
console.log("  ", answer.slice(0, 100).replace(/\n/g, " "));

console.log("картинка 2 (снимок экрана) в той же сессии:");
await line.send("prompt", { message: "А что на этой картинке? Одно предложение.", images: [{ type: "image", data: shot, mimeType: "image/png" }] });
await idle();
console.log("  ", answer.slice(0, 160).replace(/\n/g, " "));

const blind = /не\s+(могу|вижу|получил|прикреплен)|пуст|cannot see/i.test(answer);
console.log(`\nвторая картинка видна: ${blind ? "НЕТ" : "да"}`);
line.stop();
process.exit(blind ? 1 : 0);
