/**
 * Расширение-мост между operator и десктопом.
 *
 * Десктоп запускает оператор с `-e <этот файл>` и передаёт путь к своему конфигу
 * в OPERATOR_DESK_CONFIG. Через событие tool_call мост решает, выполнять вызов
 * или нет (разрешения и режим плана), делает снимки файлов перед правкой
 * (откат) и сообщает десктопу о происходящем.
 *
 * Канал наружу — ui.notify со служебным префиксом: десктоп его разбирает,
 * а обычные уведомления с ним не путаются.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createSubagentTool } from "./subagent.mjs";
import { loadPlugins } from "./plugins.mjs";
import { createBackgroundTools, createGithubTool } from "./tasks.mjs";
import { createComputerTool, inspectEnvironment } from "./computer.mjs";
import { IS_WINDOWS } from "./platform.mjs";

const SIGNAL = "@@desk@@";

const CONFIG_PATH = process.env.OPERATOR_DESK_CONFIG ?? "";
const CHECKPOINT_DIR = process.env.OPERATOR_DESK_CHECKPOINTS ?? "";
const PLUGINS_BUILTIN = process.env.OPERATOR_DESK_PLUGINS_BUILTIN ?? "";
const PLUGINS_USER = process.env.OPERATOR_DESK_PLUGINS_USER ?? "";
const PLUGINS_REGISTRY = process.env.OPERATOR_DESK_PLUGINS_REGISTRY ?? "";
const PLUGINS_DATA = process.env.OPERATOR_DESK_PLUGINS_DATA ?? "";
const JOB_LOGS = process.env.OPERATOR_DESK_JOBS ?? "";

/** Инструменты, меняющие файлы: их снимаем в чекпоинт и спрашиваем строже. */
const WRITING_TOOLS = new Set(["write", "edit", "patch"]);

/** Команды, которые нельзя пропускать молча даже в разрешающем режиме. */
const DANGEROUS = [
  /\brm\s+-[a-z]*[rf]/i,
  /\bgit\s+push\b.*--force/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\bchmod\s+-R\s+777\b/i,
  /\b(shutdown|reboot|halt)\b/i,
];

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return { rules: [] };
  }
}

/** Текст, по которому сопоставляются правила: команда для bash, путь для файловых. */
function subjectOf(tool, input) {
  if (tool === "bash") return String(input?.command ?? "");
  return String(input?.path ?? input?.file_path ?? input?.pattern ?? "");
}

function matchRule(rules, tool, subject) {
  for (const rule of rules ?? []) {
    if (rule.tool && rule.tool !== tool) continue;
    if (rule.pattern) {
      try {
        if (!new RegExp(rule.pattern, "i").test(subject)) continue;
      } catch {
        continue;
      }
    }
    return rule.action;
  }
  return null;
}

export default function deskBridge(operator) {
  // ui доступен только из контекста обработчика, не из фабрики.
  const send = (ctx, payload) => {
    try {
      ctx?.ui?.notify(SIGNAL + JSON.stringify(payload));
    } catch {
      // Десктоп не слушает — работаем дальше молча.
    }
  };

  /** Снимок файла до правки: позволяет откатить изменение целиком. */
  function checkpoint(ctx, tool, input) {
    if (!CHECKPOINT_DIR || !WRITING_TOOLS.has(tool)) return;
    const target = input?.path ?? input?.file_path;
    if (!target || typeof target !== "string") return;

    try {
      fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
      const id = crypto.randomUUID();
      const existed = fs.existsSync(target);
      if (existed) fs.copyFileSync(target, path.join(CHECKPOINT_DIR, id));
      send(ctx, {
        kind: "checkpoint",
        id,
        tool,
        file: target,
        existed,
        at: new Date().toISOString(),
      });
    } catch (error) {
      send(ctx, { kind: "checkpoint-failed", file: String(target), error: String(error) });
    }
  }

  operator.on("tool_call", async (event, ctx) => {
    lastCtx = ctx;
    const config = readConfig();
    const tool = event.toolName;
    const subject = subjectOf(tool, event.input);

    const explicit = matchRule(config.rules, tool, subject);
    const dangerous = tool === "bash" && DANGEROUS.some((pattern) => pattern.test(subject));

    if (explicit === "deny") {
      send(ctx, { kind: "denied", tool, subject });
      return { block: true, reason: "Вызов запрещён правилами разрешений." };
    }

    // Спрашиваем только то, что можно не восстановить: остальное агент делает сам.
    const needsAsk = explicit === "ask" || (explicit !== "allow" && dangerous);

    if (!needsAsk) {
      checkpoint(ctx, tool, event.input);
      return;
    }

    // Без диалогового канала спрашивать некого — пропускаем, но помечаем.
    if (!ctx?.hasUI) {
      send(ctx, { kind: "auto-allowed", tool, subject });
      checkpoint(ctx, tool, event.input);
      return;
    }

    const choice = await ctx.ui.select(
      `Опасная команда: ${subject.slice(0, 120)}`,
      ["Разрешить", "Разрешить всегда", "Отклонить"],
      { timeout: 300_000 },
    );

    if (choice === "Разрешить всегда") {
      send(ctx, { kind: "remember", tool, subject });
    }

    if (choice !== "Разрешить" && choice !== "Разрешить всегда") {
      send(ctx, { kind: "denied", tool, subject });
      return { block: true, reason: "Пользователь отклонил этот вызов." };
    }

    checkpoint(ctx, tool, event.input);
  });

  // Подзадачи в отдельном агенте: экономят контекст основного диалога.
  operator.registerTool(createSubagentTool());

  // Долгие процессы и GitHub.
  let lastCtx = null;
  if (JOB_LOGS) {
    for (const tool of createBackgroundTools(JOB_LOGS, (payload) => send(lastCtx, payload))) {
      operator.registerTool(tool);
    }
  }
  operator.registerTool(createGithubTool());

  // Управление экраном включается пользователем и по умолчанию выключено.
  operator.registerTool(
    createComputerTool(
      () => readConfig().computerUse === true,
      // Приложению сообщаем только факт снимка — разбор идёт отдельным процессом.
      (file) => send(lastCtx, { kind: "shot", file }),
      // Просим приложение снять экран: файл появится в общей папке.
      (id) => send(lastCtx, { kind: "capture", id }),
    ),
  );

  /** Команды-хуки из конфига: выполняются на событиях, как в настройках Claude Code. */
  function runHooks(event, payload) {
    const config = readConfig();
    const hooks = Array.isArray(config.hooks) ? config.hooks : [];
    for (const hook of hooks) {
      if (hook.event !== event) continue;
      if (hook.tool && hook.tool !== payload.tool) continue;
      try {
        spawn(hook.command, {
          shell: true,
          cwd: hook.cwd || process.cwd(),
          detached: !IS_WINDOWS,
          windowsHide: true,
          stdio: "ignore",
          env: {
            ...process.env,
            OPERATOR_HOOK_EVENT: event,
            OPERATOR_HOOK_TOOL: payload.tool ?? "",
            OPERATOR_HOOK_FILE: payload.file ?? "",
          },
        }).unref();
      } catch {
        // Хук не должен ломать работу агента.
      }
    }
  }

  // Инструменты плагинов появляются у агента рядом со встроенными.
  let pluginsReady = null;
  if (PLUGINS_BUILTIN || PLUGINS_USER) {
    pluginsReady = loadPlugins(operator, {
      builtinDir: PLUGINS_BUILTIN,
      userDir: PLUGINS_USER,
      registryFile: PLUGINS_REGISTRY,
      dataDir: PLUGINS_DATA,
      notify: (payload) => send(lastCtx, { kind: "plugin-message", ...payload }),
    }).catch((error) => ({
      plugins: [{ id: "plugins", name: "Плагины", status: "error", tools: 0, error: String(error) }],
    }));
  }

  // Ядро читает auth.json один раз при старте, а ключ десктоп дописывает в файл,
  // пока процесс уже живёт, — без перечитывания запрос падает с «No API key found».
  let registry = null;
  const reloadAuth = () => {
    try {
      registry?.authStorage?.reload?.();
    } catch {}
  };
  let authWatched = false;
  operator.on("input", (_event, ctx) => {
    registry = ctx.modelRegistry ?? registry;
    reloadAuth();
  });

  operator.on("session_start", (_event, ctx) => {
    registry = ctx.modelRegistry ?? registry;
    const authFile = registry?.authStorage?.storage?.authPath;
    if (authFile && !authWatched) {
      authWatched = true;
      fs.watchFile(authFile, { interval: 1000, persistent: false }, reloadAuth);
    }
    send(ctx, { kind: "ready", config: readConfig(), screen: inspectEnvironment() });
    // Ждать плагины здесь нельзя: обработчик задерживает саму сессию, а внешние
    // серверы поднимаются секундами. Сводка уходит десктопу, когда будет готова.
    if (pluginsReady) {
      pluginsReady.then((summary) => send(ctx, { kind: "plugins", plugins: summary.plugins }));
    }
  });
}
