/** Проверка: имя сессии сохраняется в файл и попадает в историю. */
import fs from "node:fs";
import { OperatorLine } from "../electron/rpc.ts";
import { listSessions } from "../electron/sessions.ts";

const line = new OperatorLine("title", { cwd: process.cwd() });
line.on("fatal", (m: string) => { console.error("сбой:", m); process.exit(1); });
line.start();
await new Promise((r) => setTimeout(r, 1200));

const done = new Promise<void>((resolve) => {
  line.on("event", (e: { type: string }) => e.type === "agent_end" && resolve());
});
await line.send("prompt", { message: "Скажи одно слово: готово" });
await done;

const state = await line.send<any>("get_state");
console.log(`файл сессии: ${state.sessionFile?.split("/").pop()}`);

await line.send("set_session_name", { name: "Проверка имени сессии" });
await new Promise((r) => setTimeout(r, 600));

const raw = fs.readFileSync(state.sessionFile, "utf8");
console.log(`session_info в файле: ${raw.includes('"type":"session_info"') ? "да" : "нет"}`);

const sessions = await listSessions(new Set([state.sessionFile]));
const mine = sessions.find((s) => s.path === state.sessionFile);
console.log(`история видит: «${mine?.title}» · origin=${mine?.origin}`);

line.stop();
process.exit(mine?.title === "Проверка имени сессии" && mine.origin === "desk" ? 0 : 1);
