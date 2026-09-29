/**
 * Проверка системных ветвей запуска программ.
 *
 * Windows-путь проверяется на любой системе: платформа, PATH и PATHEXT
 * подменяются до импорта, а сам запуск не происходит — сверяется план,
 * который строит platform.mjs. Так поломку в экранировании или в поиске
 * .cmd видно сразу, а не на чужом ноутбуке.
 *
 * Запуск: node scripts/platform-check.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bridge = path.join(here, "..", "electron", "bridge", "platform.mjs");

let failures = 0;
const ok = (name, condition, extra = "") => {
  console.log(`${condition ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!condition) failures++;
};

/** Каталог с поддельными программами: npx.cmd как в Windows и обычный exe. */
function makeFakeBin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "operator-platform-"));
  fs.writeFileSync(path.join(dir, "npx.cmd"), "@echo off\n");
  fs.writeFileSync(path.join(dir, "tool.exe"), "");
  return dir;
}

async function checkWindows() {
  const fakeBin = makeFakeBin();
  const realPlatform = process.platform;

  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
  process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe";
  const realPath = process.env.PATH;
  process.env.PATH = fakeBin;

  const { findExecutable, resolveSpawn, killPlan } = await import(`${bridge}?windows`);

  ok("npx находится как npx.cmd", String(findExecutable("npx")).endsWith("npx.cmd"));
  ok("exe находится без расширения в запросе", String(findExecutable("tool")).endsWith("tool.exe"));
  ok("несуществующей программы нет", findExecutable("нетакого") === null);

  const plan = resolveSpawn("npx", ["-y", "@modelcontextprotocol/server-github"], { cwd: "C:\\work" });
  ok("обёртка .cmd идёт через cmd.exe", plan.command.toLowerCase().endsWith("cmd.exe"), plan.command);
  ok("флаги оболочки верные", plan.args.slice(0, 3).join(" ") === "/d /s /c");
  ok(
    "команда и аргументы в одной строке",
    plan.args[3].includes("npx.cmd") && plan.args[3].includes("server-github"),
  );
  ok("verbatim-аргументы включены", plan.options.windowsVerbatimArguments === true);
  ok("рабочая папка сохранена", plan.options.cwd === "C:\\work");

  const spaced = resolveSpawn("npx", ["C:\\Program Files\\x\\y.js"], {});
  ok("аргумент с пробелом закавычен", spaced.args[3].includes('"C:\\Program Files\\x\\y.js"'));

  const direct = resolveSpawn("tool", ["--flag"], {});
  ok("обычный exe запускается напрямую", direct.command.endsWith("tool.exe") && direct.args[0] === "--flag");

  const hard = killPlan(1234, { force: true });
  ok("дерево процессов гасится taskkill", hard.command === "taskkill" && hard.args.join(" ") === "/PID 1234 /T /F");
  ok("без принуждения флага /F нет", !killPlan(1234).args.includes("/F"));

  Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
  process.env.PATH = realPath;
  fs.rmSync(fakeBin, { recursive: true, force: true });
}

async function checkUnix() {
  const { findExecutable, resolveSpawn, killPlan } = await import(`${bridge}?unix`);

  ok("программа находится в PATH", Boolean(findExecutable("node")));
  const plan = resolveSpawn("node", ["--version"], { cwd: "/tmp" });
  ok("команда уходит без оболочки", plan.command === "node" && plan.args[0] === "--version");
  ok("рабочая папка сохранена", plan.options.cwd === "/tmp");
  const kill = killPlan(1234);
  ok("останов идёт по группе процессов", kill.group === -1234 && kill.signal === "SIGTERM");
  ok("принудительный останов — SIGKILL", killPlan(1234, { force: true }).signal === "SIGKILL");
}

console.log("── Windows ──");
await checkWindows();
console.log("\n── Unix ──");
await checkUnix();

console.log(failures === 0 ? "\nвсё верно" : `\nпровалов: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
