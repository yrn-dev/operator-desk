import fs from "node:fs";
import { OperatorLine } from "../electron/rpc.ts";
const width = process.argv[2] ?? "800";
const data = fs.readFileSync(`/tmp/shot-${width}.png`).toString("base64");
const line = new OperatorLine("size", { cwd: "/tmp", provider: "alem-ai", model: "qwen3-8" });
let answer = "";
line.on("event", (e: any) => {
  if (e.type === "message_end" && e.message?.role === "assistant") {
    const t = (e.message.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (t) answer = t;
  }
});
line.start();
const idle = new Promise<void>((r) => line.on("event", (e: any) => e.type === "agent_end" && r()));
await new Promise((r) => setTimeout(r, 1500));
await line.send("prompt", { message: "Что на этом снимке экрана? Одно предложение.", images: [{ type: "image", data, mimeType: "image/png" }] });
await Promise.race([idle, new Promise((r) => setTimeout(r, 90_000))]);
console.log(`ширина ${width}: ${answer.slice(0, 150)}`);
line.stop();
process.exit(/не\s+(могу|вижу)|cannot/i.test(answer) ? 1 : 0);
