/**
 * Долгие процессы и работа с GitHub.
 *
 * background_run запускает команду отдельно от диалога: агент не ждёт её конца,
 * а смотрит вывод по мере надобности. Так поднимаются серверы, сборки и тесты.
 */
import { spawn } from "node:child_process";
import { IS_WINDOWS, killTree, spawnPortable } from "./platform.mjs";
import fs from "node:fs";
import path from "node:path";
import { Type } from "typebox";

const jobs = new Map();

function logPath(dir, id) {
  return path.join(dir, `${id}.log`);
}

function tail(file, limit = 4000) {
  try {
    const text = fs.readFileSync(file, "utf8");
    return text.length > limit ? `…${text.slice(-limit)}` : text;
  } catch {
    return "";
  }
}

export function createBackgroundTools(logDir, notify) {
  fs.mkdirSync(logDir, { recursive: true });

  const run = {
    name: "background_run",
    label: "Фоновая команда",
    description:
      "Запускает долгую команду в фоне и сразу возвращает её идентификатор: dev-сервер, сборку, тесты, наблюдение за логом. " +
      "Диалог при этом не блокируется. Вывод смотри инструментом background_check, останавливай через background_stop. " +
      "Для быстрых команд бери обычный bash.",
    promptSnippet: "background_run — запустить долгий процесс в фоне",
    parameters: Type.Object(
      {
        command: Type.String({ description: "Команда для оболочки" }),
        cwd: Type.Optional(Type.String({ description: "Рабочая папка" })),
        name: Type.Optional(Type.String({ description: "Короткое имя процесса для списка" })),
      },
      { additionalProperties: false },
    ),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const id = `job-${Date.now().toString(36)}`;
      const cwd = params.cwd || ctx?.cwd || process.cwd();
      const file = logPath(logDir, id);
      const out = fs.openSync(file, "a");

      const child = spawn(params.command, {
        cwd,
        shell: true,
        // Своя группа процессов есть только в Unix: по ней потом и останавливаем.
        detached: !IS_WINDOWS,
        windowsHide: true,
        stdio: ["ignore", out, out],
      });
      child.unref();

      jobs.set(id, {
        id,
        pid: child.pid,
        name: params.name || params.command.slice(0, 40),
        command: params.command,
        cwd,
        file,
        startedAt: new Date().toISOString(),
        alive: true,
      });

      child.on("exit", (code) => {
        const job = jobs.get(id);
        if (job) {
          job.alive = false;
          job.exitCode = code;
        }
        notify?.({ kind: "job", action: "exit", id, code });
      });

      notify?.({ kind: "job", action: "start", id, name: params.name || params.command, pid: child.pid });

      return {
        content: [
          {
            type: "text",
            text: `Запущено в фоне: ${id} (pid ${child.pid}). Вывод: background_check id=${id}`,
          },
        ],
        details: { id, pid: child.pid, cwd },
      };
    },
  };

  const check = {
    name: "background_check",
    label: "Проверить фон",
    description:
      "Показывает список фоновых процессов или конец вывода одного из них. Без id — список, с id — последние строки лога.",
    promptSnippet: "background_check — список фоновых процессов и их вывод",
    parameters: Type.Object(
      {
        id: Type.Optional(Type.String({ description: "Идентификатор процесса" })),
        lines: Type.Optional(Type.Number({ description: "Сколько последних строк показать (по умолчанию 40)" })),
      },
      { additionalProperties: false },
    ),
    async execute(_id, params) {
      if (!params.id) {
        const list = [...jobs.values()];
        if (list.length === 0) {
          return { content: [{ type: "text", text: "Фоновых процессов нет." }], details: {} };
        }
        const text = list
          .map(
            (job) =>
              `${job.id} · ${job.alive ? "работает" : `завершён (${job.exitCode ?? "?"})`} · ${job.name}`,
          )
          .join("\n");
        return { content: [{ type: "text", text }], details: { count: list.length } };
      }

      const job = jobs.get(params.id);
      if (!job) {
        return {
          content: [{ type: "text", text: `Процесс ${params.id} не найден.` }],
          isError: true,
          details: {},
        };
      }

      const limit = params.lines ?? 40;
      const text = tail(job.file).split("\n").slice(-limit).join("\n");
      return {
        content: [
          {
            type: "text",
            text: `${job.alive ? "Работает" : `Завершён (${job.exitCode ?? "?"})`}: ${job.command}\n\n${text || "(вывода пока нет)"}`,
          },
        ],
        details: { id: job.id, alive: job.alive },
      };
    },
  };

  const stop = {
    name: "background_stop",
    label: "Остановить фон",
    description: "Останавливает фоновый процесс по идентификатору.",
    promptSnippet: "background_stop — остановить фоновый процесс",
    parameters: Type.Object({ id: Type.String({ description: "Идентификатор процесса" }) }, {
      additionalProperties: false,
    }),
    async execute(_id, params) {
      const job = jobs.get(params.id);
      if (!job) {
        return { content: [{ type: "text", text: "Такого процесса нет." }], isError: true, details: {} };
      }
      killTree(job.pid);
      job.alive = false;
      notify?.({ kind: "job", action: "stop", id: job.id });
      return { content: [{ type: "text", text: `Процесс ${job.id} остановлен.` }], details: {} };
    },
  };

  return [run, check, stop];
}

/** Работа с GitHub через официальный клиент gh: PR, обзор, проверки. */
export function createGithubTool() {
  return {
    name: "github",
    label: "GitHub",
    description:
      "Работа с GitHub через клиент gh: создать пул-реквест, посмотреть список или содержимое PR, проверить статусы. " +
      "Требует установленного и авторизованного gh.",
    promptSnippet: "github — пул-реквесты и проверки через gh",
    parameters: Type.Object(
      {
        action: Type.Union(
          [
            Type.Literal("pr_create"),
            Type.Literal("pr_list"),
            Type.Literal("pr_view"),
            Type.Literal("pr_checks"),
            Type.Literal("pr_diff"),
          ],
          { description: "Что сделать" },
        ),
        title: Type.Optional(Type.String({ description: "pr_create: заголовок" })),
        body: Type.Optional(Type.String({ description: "pr_create: описание" })),
        base: Type.Optional(Type.String({ description: "pr_create: ветка назначения" })),
        draft: Type.Optional(Type.Boolean({ description: "pr_create: черновик" })),
        number: Type.Optional(Type.Number({ description: "Номер PR для просмотра" })),
        cwd: Type.Optional(Type.String({ description: "Папка репозитория" })),
      },
      { additionalProperties: false },
    ),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const cwd = params.cwd || ctx?.cwd || process.cwd();
      const args = [];

      switch (params.action) {
        case "pr_create":
          args.push("pr", "create");
          if (params.title) args.push("--title", params.title);
          if (params.body) args.push("--body", params.body);
          else args.push("--fill");
          if (params.base) args.push("--base", params.base);
          if (params.draft) args.push("--draft");
          break;
        case "pr_list":
          args.push("pr", "list", "--limit", "20");
          break;
        case "pr_view":
          args.push("pr", "view", ...(params.number ? [String(params.number)] : []), "--comments");
          break;
        case "pr_checks":
          args.push("pr", "checks", ...(params.number ? [String(params.number)] : []));
          break;
        case "pr_diff":
          args.push("pr", "diff", ...(params.number ? [String(params.number)] : []));
          break;
      }

      const result = await new Promise((resolve) => {
        const child = spawnPortable("gh", args, {
          cwd,
          env: { ...process.env, NO_COLOR: "1" },
          windowsHide: true,
        });
        let out = "";
        let err = "";
        child.stdout.on("data", (chunk) => (out += chunk));
        child.stderr.on("data", (chunk) => (err += chunk));
        child.on("error", () => resolve({ code: -1, out, err: "gh не установлен" }));
        child.on("close", (code) => resolve({ code: code ?? -1, out, err }));
      });

      const text = (result.out || result.err || "").trim().slice(0, 8000);
      return {
        content: [{ type: "text", text: text || "gh ничего не вернул" }],
        isError: result.code !== 0,
        details: { action: params.action, cwd },
      };
    },
  };
}
