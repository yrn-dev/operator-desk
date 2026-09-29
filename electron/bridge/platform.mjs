/**
 * Мелочи, которые в трёх системах устроены по-разному.
 *
 * Главная — запуск программ на Windows: с Node 20.12 spawn отказывается
 * выполнять .cmd и .bat без оболочки (защита от подстановки аргументов),
 * а половина инструментов там именно .cmd — npx, gh, python. Поэтому такие
 * команды мы запускаем через cmd.exe, экранируя аргументы сами.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const IS_WINDOWS = process.platform === "win32";
export const IS_MAC = process.platform === "darwin";

/** Расширения исполняемых файлов Windows: PATHEXT, но без мусора. */
function windowsExtensions() {
  const raw = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  return raw.split(";").filter(Boolean).map((item) => item.toLowerCase());
}

/**
 * Находит программу в PATH. На Windows перебирает расширения: там «gh» —
 * это gh.cmd или gh.exe, и без расширения файла просто нет.
 */
export function findExecutable(name) {
  if (path.isAbsolute(name)) return fs.existsSync(name) ? name : null;

  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const names = IS_WINDOWS
    ? path.extname(name)
      ? [name]
      : windowsExtensions().map((ext) => name + ext)
    : [name];

  for (const dir of dirs) {
    for (const candidate of names) {
      const full = path.join(dir, candidate);
      try {
        if (IS_WINDOWS) {
          if (fs.existsSync(full)) return full;
        } else {
          fs.accessSync(full, fs.constants.X_OK);
          return full;
        }
      } catch {
        // Следующий вариант.
      }
    }
  }
  return null;
}

/** Аргумент для cmd.exe: кавычки нужны всему, где есть пробел или кавычка. */
function quoteForCmd(argument) {
  if (!/[\s"^&|<>()]/.test(argument)) return argument;
  return `"${argument.replace(/"/g, '\\"')}"`;
}

/**
 * Во что превращается запуск в текущей системе. Отдельной функцией — чтобы
 * решение можно было проверить тестом, не запуская ничего на самом деле.
 */
export function resolveSpawn(command, args = [], options = {}) {
  if (!IS_WINDOWS) return { command, args, options };

  const resolved = findExecutable(command) ?? command;
  const extension = path.extname(resolved).toLowerCase();

  if (extension === ".cmd" || extension === ".bat") {
    const comspec = process.env.COMSPEC || "cmd.exe";
    const line = [resolved, ...args].map(quoteForCmd).join(" ");
    return {
      command: comspec,
      args: ["/d", "/s", "/c", line],
      options: { ...options, windowsVerbatimArguments: true },
    };
  }

  return { command: resolved, args, options };
}

export function spawnPortable(command, args = [], options = {}) {
  const plan = resolveSpawn(command, args, options);
  return spawn(plan.command, plan.args, plan.options);
}

/**
 * Останавливает процесс вместе с потомками. В Unix это группа процессов,
 * в Windows — taskkill с деревом: отрицательный pid там недопустим,
 * а без /T остаются дети (npx запускает node отдельным процессом).
 */
export function killPlan(pid, { force = false } = {}) {
  if (IS_WINDOWS) {
    return { command: "taskkill", args: ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])] };
  }
  return { signal: force ? "SIGKILL" : "SIGTERM", group: -pid };
}

export function killTree(pid, { force = false } = {}) {
  if (!pid) return;
  if (IS_WINDOWS) {
    const plan = killPlan(pid, { force });
    try {
      spawn(plan.command, plan.args, { stdio: "ignore", windowsHide: true }).unref();
    } catch {
      // Процесса уже нет.
    }
    return;
  }

  const signal = force ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Процесса уже нет.
    }
  }
}
