/** Проверка операций над сессией: переименование, экспорт JSON и HTML. */
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import { listSessions } from "../electron/sessions.ts";
import { exportSessionJson, renameSession, suggestedName } from "../electron/session-ops.ts";

const tmp = fs.mkdtempSync(`${os.tmpdir()}/ops-`);
const all = await listSessions();
const source = all.find((s) => s.title.includes("Семь умножить")) ?? all[0];
const copy = `${tmp}/copy.jsonl`;
fs.copyFileSync(source.path, copy);
console.log(`взял: «${source.title}»`);

await renameSession(copy, "Новое имя сессии");
const renamed = (await listSessions(new Set())).length;
const head = fs.readFileSync(copy, "utf8");
console.log(`session_info дописан: ${head.trimEnd().endsWith('"name":"Новое имя сессии"}') ? "да" : "нет"} (сессий в истории ${renamed})`);

const json = `${tmp}/${suggestedName("Новое имя сессии", "json")}`;
await exportSessionJson(copy, json);
const parsed = JSON.parse(fs.readFileSync(json, "utf8"));
console.log(`JSON: ${Array.isArray(parsed) ? `${parsed.length} записей` : "не массив"} → ${json.split("/").pop()}`);

const html = `${tmp}/session.html`;
const devNull = fs.openSync(os.devNull, "r");
const code = await new Promise<number>((resolve) => {
  const child = spawn("opr", ["--export", copy, html], { stdio: [devNull, "ignore", "pipe"] });
  let err = "";
  child.stderr?.on("data", (d) => (err += d));
  child.on("close", (c) => {
    if (c !== 0) console.log("stderr:", err.slice(0, 200));
    resolve(c ?? -1);
  });
});
fs.closeSync(devNull);
const size = fs.existsSync(html) ? fs.statSync(html).size : 0;
console.log(`HTML: код ${code}, размер ${size} байт`);
process.exit(code === 0 && size > 0 && Array.isArray(parsed) ? 0 : 1);
