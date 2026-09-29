/** Проверка вложений: картинка уходит модели как image-контент. */
import fs from "node:fs";
import { OperatorLine } from "../electron/rpc.ts";

const file = "build/icon.png";
const data = fs.readFileSync(file).toString("base64");

const line = new OperatorLine("attach", { cwd: process.cwd() });
line.on("fatal", (m: string) => { console.error("сбой:", m); process.exit(1); });

let answer = "";
line.on("event", (event: any) => {
  if (event.type === "message_end" && event.message?.role === "assistant") {
    const text = (event.message.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    if (text.trim()) answer = text.trim();
  }
});

const done = new Promise<void>((resolve) => {
  line.on("event", (event: { type: string }) => {
    if (event.type === "agent_end") resolve();
  });
});

line.start();
await new Promise((r) => setTimeout(r, 1200));
await line.send("prompt", {
  message: "Что изображено на картинке? Ответь одним коротким предложением.",
  images: [{ type: "image", data, mimeType: "image/png" }],
});

await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("таймаут")), 90_000))]);
console.log(`модель увидела: ${answer || "(пусто)"}`);
line.stop();
process.exit(answer ? 0 : 1);
