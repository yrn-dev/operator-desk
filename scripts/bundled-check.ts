/** Встроенный оператор должен работать без системного opr и без Node в PATH. */
import fs from "node:fs";
import path from "node:path";
import { OperatorLine } from "../electron/rpc.ts";

const cli = path.resolve("vendor/node_modules/pzero-operator/dist/cli.js");
const electron = path.resolve("node_modules/electron/dist/electron");
console.log(`ядро в сборке: ${fs.existsSync(cli) ? "есть" : "НЕТ"}`);

const line = new OperatorLine("bundled", {
  cwd: "/tmp",
  bin: electron,
  prefixArgs: [cli],
  env: { ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin:/bin" },
});

let answer = "";
line.on("event", (e: any) => {
  if (e.type === "message_end" && e.message?.role === "assistant") {
    const t = (e.message.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (t) answer = t;
  }
});
line.on("fatal", (m: string) => { console.error("сбой:", m); process.exit(1); });
line.start();

const idle = new Promise<void>((r) => line.on("event", (e: any) => e.type === "agent_end" && r()));
await new Promise((r) => setTimeout(r, 2000));
const state = await line.send<any>("get_state");
console.log(`модель: ${state?.model?.provider}/${state?.model?.id}`);
await line.send("prompt", { message: "Ответь одним словом: работает" });
await Promise.race([idle, new Promise((_, rej) => setTimeout(() => rej(new Error("таймаут")), 90_000))]);
console.log(`ответ: ${answer.slice(0, 80)}`);
line.stop();
process.exit(answer ? 0 : 1);
