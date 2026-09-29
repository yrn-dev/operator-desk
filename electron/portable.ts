import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Запуск программ так, как это устроено в каждой системе.
 *
 * На Windows половина инструментов — обёртки .cmd (npx, gh, сам opr после
 * npm i -g), а spawn с Node 20.12 отказывается их выполнять без оболочки.
 * Поэтому такие команды уходят через cmd.exe с экранированием аргументов.
 * То же самое умеет мост — см. electron/bridge/platform.mjs.
 */
export const IS_WINDOWS = process.platform === "win32";
export const IS_MAC = process.platform === "darwin";
export const IS_LINUX = process.platform === "linux";

/** Расширения исполняемых файлов Windows. */
function windowsExtensions(): string[] {
  const raw = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  return raw.split(";").filter(Boolean).map((item) => item.toLowerCase());
}

/**
 * Ищет программу в PATH. На Windows перебирает расширения: «gh» там значит
 * gh.cmd или gh.exe, файла без расширения не существует.
 */
export function findExecutable(name: string): string | null {
  if (path.isAbsolute(name)) return fs.existsSync(name) ? name : null;

  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const names = IS_WINDOWS
    ? path.extname(name)
      ? [name]
      : windowsExtensions().map((extension) => name + extension)
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
        // Пробуем следующий вариант.
      }
    }
  }
  return null;
}

/** Аргумент для cmd.exe: кавычки нужны всему, где есть пробел или спецсимвол. */
function quoteForCmd(argument: string): string {
  if (!/[\s"^&|<>()]/.test(argument)) return argument;
  return `"${argument.replace(/"/g, '\\"')}"`;
}

/** Оболочечные обёртки Windows нельзя запустить напрямую. */
export function needsShell(command: string): boolean {
  if (!IS_WINDOWS) return false;
  const extension = path.extname(findExecutable(command) ?? command).toLowerCase();
  return extension === ".cmd" || extension === ".bat";
}

/** План запуска: отдельно от самого запуска, чтобы его можно было проверить. */
export function resolveSpawn(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {},
): { command: string; args: string[]; options: SpawnOptions } {
  if (!IS_WINDOWS) return { command, args, options };

  const resolved = findExecutable(command) ?? command;
  if (needsShell(resolved)) {
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

export function spawnPortable(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {},
): ChildProcess {
  const plan = resolveSpawn(command, args, options);
  return spawn(plan.command, plan.args, plan.options);
}
