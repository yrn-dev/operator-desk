import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findExecutable, IS_WINDOWS } from "./portable.ts";

/** Как запускать оператор: своим бинарником или нашим Electron в роли Node. */
export type OperatorLauncher = {
  command: string;
  prefixArgs: string[];
  env: Record<string, string>;
  bundled: boolean;
};

/**
 * Ищет исполняемый файл operator. Приложение, запущенное из меню рабочего стола,
 * получает урезанный PATH — без nvm и ~/.local/bin, поэтому проверяем и их.
 */
/**
 * Оператор, упакованный вместе с приложением. Запускаем его через собственный
 * Electron с ELECTRON_RUN_AS_NODE=1 — тогда пользователю не нужен ни Node,
 * ни глобальная установка.
 */
export function bundledOperator(resourcesPath: string, execPath: string): OperatorLauncher | null {
  const candidates = [
    path.join(resourcesPath, "operator", "lib", "pzero-operator", "dist", "cli.js"),
    path.join(resourcesPath, "operator", "node_modules", "pzero-operator", "dist", "cli.js"),
    path.join(resourcesPath, "app.asar.unpacked", "vendor", "node_modules", "pzero-operator", "dist", "cli.js"),
    path.resolve("vendor", "node_modules", "pzero-operator", "dist", "cli.js"),
  ];

  for (const cli of candidates) {
    if (fs.existsSync(cli)) {
      return {
        command: execPath,
        prefixArgs: [cli],
        env: { ELECTRON_RUN_AS_NODE: "1" },
        bundled: true,
      };
    }
  }
  return null;
}

/** Ищет программу в PATH: нужно и для диагностики готовности. */
export function locateBinary(name: string): string | null {
  return findExecutable(name);
}

export function locateOpr(): string | null {
  const home = os.homedir();

  // На Windows исполняемый файл — opr.cmd, файла без расширения там нет.
  const executable = (candidate: string): string | null => {
    if (IS_WINDOWS) {
      for (const suffix of ["", ".cmd", ".exe", ".bat"]) {
        if (fs.existsSync(candidate + suffix)) return candidate + suffix;
      }
      return null;
    }
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      return null;
    }
  };

  // 1. Собственный PATH — верен, когда приложение запущено из терминала.
  const inPath = findExecutable("opr");
  if (inPath) return inPath;

  // 2. Логин-оболочка знает пользовательский PATH (nvm, asdf, volta).
  //    В Windows такой оболочки нет — там достаточно PATH и путей ниже.
  if (!IS_WINDOWS) {
    try {
      const shell = process.env.SHELL ?? "/bin/sh";
      const found = execFileSync(shell, ["-l", "-c", "command -v opr"], {
        encoding: "utf8",
        timeout: 4000,
      }).trim();
      if (found && executable(found)) return found;
    } catch {
      // Оболочка молчит — идём дальше по известным местам.
    }
  }

  // 3. Установки под менеджерами версий — новые версии первыми.
  for (const root of IS_WINDOWS
    ? [path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "nvm")]
    : [path.join(home, ".nvm", "versions", "node")]) {
    try {
      const versions = fs.readdirSync(root).sort().reverse();
      for (const version of versions) {
        const found = executable(
          IS_WINDOWS ? path.join(root, version, "opr") : path.join(root, version, "bin", "opr"),
        );
        if (found) return found;
      }
    } catch {
      // Менеджер версий не установлен — не беда.
    }
  }

  // 4. Известные места установки — последними: там может лежать чужая обёртка.
  const places = IS_WINDOWS
    ? [
        path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "npm", "opr"),
        path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "Yarn", "bin", "opr"),
        path.join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs", "opr"),
      ]
    : [
        path.join(home, ".local", "bin", "opr"),
        path.join(home, "bin", "opr"),
        "/opt/homebrew/bin/opr",
        "/usr/local/bin/opr",
        "/usr/bin/opr",
      ];

  for (const candidate of places) {
    const found = executable(candidate);
    if (found) return found;
  }

  return null;
}
