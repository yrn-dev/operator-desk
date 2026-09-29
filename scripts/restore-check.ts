import { OperatorLine } from "../electron/rpc.ts";
import { listSessions } from "../electron/sessions.ts";
import { entriesFromMessages } from "../src/lineReducer.ts";

const sessions = await listSessions();
console.log(`найдено сессий: ${sessions.length}`);
const target = sessions.find((s) => s.title.includes("atlas")) ?? sessions[1];
console.log(`открываю: ${target.title}\n  cwd=${target.cwd}\n  файл=${target.path.split("/").pop()}`);

const line = new OperatorLine("restore", { cwd: target.cwd || process.cwd() });
line.on("fatal", (m: string) => { console.error("сбой:", m); process.exit(1); });
line.start();

await new Promise((r) => setTimeout(r, 1500));
await line.send("switch_session", { sessionPath: target.path });
const messages = await line.send<any>("get_messages");
const entries = entriesFromMessages(messages ?? []);

console.log(`\nсообщений: ${messages?.messages?.length ?? 0} → записей в ленте: ${entries.length}`);
for (const entry of entries.slice(0, 8)) {
  if (entry.kind === "say") console.log(`  [${entry.role}] ${entry.text.trim().slice(0, 70).replace(/\n/g, " ")}`);
  else if (entry.kind === "tool") console.log(`  [${entry.name} ${entry.failed ? "✕" : "✓"}] ${String(entry.args.command ?? entry.args.path ?? "").slice(0, 60)}`);
}
line.stop();
process.exit(entries.length > 0 ? 0 : 1);
