/**
 * Субагент: подзадача уходит в отдельный процесс operator со своим контекстом,
 * в основную ленту возвращается только итог. Так большой поиск или разбор
 * не съедает окно главного диалога.
 */
import { spawnPortable } from "./platform.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "typebox";

const DEFAULT_TIMEOUT = 600;

const parameters = Type.Object(
  {
    task: Type.String({
      description:
        "Полная постановка задачи для субагента: что изучить или сделать и что вернуть. " +
        "Субагент не видит текущий диалог, поэтому опиши контекст целиком.",
    }),
    cwd: Type.Optional(
      Type.String({ description: "Рабочая папка субагента. По умолчанию — папка текущей сессии." }),
    ),
    readOnly: Type.Optional(
      Type.Boolean({
        description:
          "true — субагенту оставить только инструменты чтения (read, grep, find, ls). " +
          "Годится для поиска и разбора кода. По умолчанию true.",
      }),
    ),
    timeout: Type.Optional(
      Type.Number({ description: `Предел в секундах (по умолчанию ${DEFAULT_TIMEOUT}).` }),
    ),
  },
  { additionalProperties: false },
);

/**
 * Чем запускать субагента. Если оператор работает встроенным в приложение
 * (Electron в роли Node), тем же способом запускаем и подзадачу.
 */
function operatorLauncher() {
  const entry = process.argv[1] ?? "";
  if (entry.endsWith("cli.js") && process.execPath) {
    return { command: process.execPath, prefix: [entry], env: { ELECTRON_RUN_AS_NODE: "1" } };
  }
  return { command: process.env.OPERATOR_DESK_BIN || "opr", prefix: [], env: {} };
}

export function createSubagentTool() {
  return {
    name: "subagent",
    label: "Субагент",
    description:
      "Запускает отдельного агента с чистым контекстом для объёмной подзадачи и возвращает только его итоговый ответ. " +
      "Бери его для поиска по большому проекту, разбора незнакомого кода, сбора фактов — всё, где промежуточный вывод " +
      "тебе не нужен и только засорит контекст. Задачу описывай самодостаточно: субагент не видит этот диалог.",
    promptSnippet: "subagent — подзадача в отдельном агенте, в ответ приходит только итог",
    parameters,
    executionMode: "parallel",

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const cwd = params.cwd || ctx?.cwd || process.cwd();
      const readOnly = params.readOnly ?? true;
      const limit = (params.timeout ?? DEFAULT_TIMEOUT) * 1000;

      const launcher = operatorLauncher();
      const args = [...launcher.prefix, "--print", "--no-session"];
      if (readOnly) args.push("--tools", "read,grep,find,ls,read_full");
      args.push(params.task);

      onUpdate?.({ content: [{ type: "text", text: "субагент работает…" }], details: undefined });

      const devNull = fs.openSync(os.devNull, "r");
      const child = spawnPortable(launcher.command, args, {
        cwd,
        env: { ...process.env, ...launcher.env, NO_COLOR: "1" },
        stdio: [devNull, "pipe", "pipe"],
      });

      let out = "";
      let err = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        out += chunk;
        onUpdate?.({
          content: [{ type: "text", text: out.slice(-400) }],
          details: undefined,
        });
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => (err += chunk));

      const stop = setTimeout(() => child.kill(), limit);
      const onAbort = () => child.kill();
      signal?.addEventListener("abort", onAbort);

      const code = await new Promise((resolve) => {
        child.on("error", () => resolve(-1));
        child.on("close", (value) => resolve(value ?? -1));
      });

      clearTimeout(stop);
      signal?.removeEventListener("abort", onAbort);
      try {
        fs.closeSync(devNull);
      } catch {
        // Уже закрыт.
      }

      const answer = out.trim();
      if (code !== 0 || !answer) {
        return {
          content: [
            {
              type: "text",
              text: `Субагент не справился (код ${code}). ${err.trim().slice(0, 400)}`,
            },
          ],
          isError: true,
          details: { cwd, readOnly },
        };
      }

      return {
        content: [{ type: "text", text: answer }],
        details: { cwd, readOnly, task: params.task },
      };
    },
  };
}

/** Полный путь до файла, чтобы мост мог сослаться на себя при отладке. */
export const subagentPath = path.resolve(new URL(import.meta.url).pathname);
