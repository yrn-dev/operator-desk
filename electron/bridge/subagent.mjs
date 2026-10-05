/**
 * Субагент: подзадача уходит в отдельный процесс operator со своим контекстом,
 * в основную ленту возвращается только итог. Так большой поиск или разбор
 * не съедает окно главного диалога.
 */
import { spawnPortable } from "./platform.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";

const DEFAULT_TIMEOUT = 600;
const OBSERVER_PREFIX = "@@desk-subagent@@";
const OBSERVER_PATH = fileURLToPath(new URL("./subagent-observer.mjs", import.meta.url));

const parameters = Type.Object(
  {
    task: Type.String({
      description:
        "Полная постановка задачи для субагента: что изучить или сделать и что вернуть. " +
        "Субагент не видит текущий диалог, поэтому опиши контекст целиком.",
    }),
    label: Type.Optional(Type.String({ description: "Короткая роль или название подзадачи для списка субагентов." })),
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
      "Бери его для сложной или объёмной самостоятельной части работы; независимые части можно поручить нескольким субагентам параллельно. " +
      "Для короткой задачи работай сам. Задачу описывай самодостаточно: субагент не видит этот диалог.",
    promptSnippet: "subagent — отдельный агент для сложной подзадачи; независимые подзадачи можно выполнять параллельно",
    parameters,
    executionMode: "parallel",

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const cwd = params.cwd || ctx?.cwd || process.cwd();
      const readOnly = params.readOnly ?? true;
      const limit = (params.timeout ?? DEFAULT_TIMEOUT) * 1000;
      const steps = [];
      const details = () => ({ task: params.task, label: params.label || "", cwd, readOnly, steps: steps.slice(-80) });

      const launcher = operatorLauncher();
      const args = [...launcher.prefix, "--print", "--no-session", "-e", OBSERVER_PATH];
      if (readOnly) args.push("--tools", "read,grep,find,ls,read_full");
      args.push(params.task);

      const update = (answer = "") => onUpdate?.({
        content: [{ type: "text", text: answer.slice(-400) || "субагент работает…" }],
        details: details(),
      });
      update();

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
        update(out);
      });
      child.stderr.setEncoding("utf8");
      let stderrBuffer = "";
      child.stderr.on("data", (chunk) => {
        stderrBuffer += chunk;
        let newline;
        while ((newline = stderrBuffer.indexOf("\n")) >= 0) {
          const line = stderrBuffer.slice(0, newline).trim();
          stderrBuffer = stderrBuffer.slice(newline + 1);
          if (!line.startsWith(OBSERVER_PREFIX)) {
            err = (err + line + "\n").slice(-4000);
            continue;
          }
          try {
            const activity = JSON.parse(line.slice(OBSERVER_PREFIX.length));
            if (activity.kind === "start") {
              steps.push({ id: activity.id, name: activity.name, subject: activity.subject, done: false, failed: false, summary: "" });
            } else if (activity.kind === "end") {
              const step = steps.find((item) => item.id === activity.id);
              if (step) Object.assign(step, { done: true, failed: activity.failed, summary: activity.summary });
            }
            if (steps.length > 80) steps.splice(0, steps.length - 80);
            update(out);
          } catch { /* Ignore malformed progress lines. */ }
        }
      });

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
          details: details(),
        };
      }

      return {
        content: [{ type: "text", text: answer }],
        details: details(),
      };
    },
  };
}

/** Полный путь до файла, чтобы мост мог сослаться на себя при отладке. */
export const subagentPath = path.resolve(new URL(import.meta.url).pathname);
