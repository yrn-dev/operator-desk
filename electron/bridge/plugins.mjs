/**
 * Плагины оператора.
 *
 * Плагин — папка с манифестом `plugin.json`. Бывает двух видов:
 *
 *   kind: "tool" — код внутри процесса агента. Модуль экспортирует функцию,
 *                  она получает то же API, что и любое расширение оператора:
 *                  регистрирует инструменты, слушает события, ведёт своё
 *                  хранилище. Это и есть настоящий плагин.
 *
 *   kind: "mcp"  — внешний сервер по протоколу MCP. Своего кода не имеет,
 *                  его инструменты подключаются через отдельный процесс.
 *                  Для оператора разницы нет: инструменты появляются рядом.
 *
 * Плагины лежат в двух местах: встроенные едут с приложением, пользовательские
 * — в папке настроек. Что включено и с какими настройками, помнит реестр.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { connectMcpServer } from "./mcp.mjs";

/**
 * Сколько ждать запуска сервера. Обычному хватает 30 секунд, а удалённому
 * со входом через браузер (mcp-remote) — нет: при первом запуске человек
 * логинится и выбирает права, и обрыв на середине сбивает вход целиком.
 * Автор плагина может задать своё значение в секундах: startupTimeout.
 */
function startTimeoutOf(plugin) {
  if (Number(plugin.startupTimeout) > 0) return Number(plugin.startupTimeout) * 1000;
  const line = `${plugin.command ?? ""} ${(plugin.args ?? []).join(" ")}`;
  return /mcp-remote|\bhttps?:\/\//.test(line) ? 5 * 60_000 : 30_000;
}

/** Читает манифесты из папки: каждая подпапка с plugin.json — плагин. */
function readFolder(folder, origin) {
  const found = [];
  let entries = [];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(folder, entry.name);
    const file = path.join(dir, "plugin.json");
    try {
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!manifest.id) manifest.id = entry.name;
      found.push({ ...manifest, dir, origin });
    } catch (error) {
      found.push({
        id: entry.name,
        name: entry.name,
        dir,
        origin,
        broken: `манифест не читается: ${String(error)}`,
      });
    }
  }
  return found;
}

/** Все установленные плагины: встроенные и пользовательские вместе. */
export function listPlugins({ builtinDir, userDir }) {
  const builtin = builtinDir ? readFolder(builtinDir, "builtin") : [];
  const user = userDir ? readFolder(userDir, "user") : [];
  // Пользовательский плагин с тем же идентификатором перекрывает встроенный.
  const byId = new Map();
  for (const plugin of [...builtin, ...user]) byId.set(plugin.id, plugin);
  return [...byId.values()];
}

export function readRegistry(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { disabled: [], settings: {} };
  }
}

/** Простое хранилище плагина: файл с парами ключ-значение рядом с настройками. */
function createStorage(dataDir, id) {
  const file = path.join(dataDir, `${id}.json`);
  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  };
  return {
    get(key, fallback = null) {
      const value = read()[key];
      return value === undefined ? fallback : value;
    },
    set(key, value) {
      const data = read();
      data[key] = value;
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
      return value;
    },
    all: read,
  };
}

/**
 * Поднимает включённые плагины и отдаёт сводку для десктопа.
 * Плагины загружаются параллельно: один медленный не должен держать остальные.
 */
export async function loadPlugins(operator, options) {
  const { builtinDir, userDir, registryFile, dataDir, notify } = options;
  const registry = readRegistry(registryFile);
  const disabled = new Set(registry.disabled ?? []);
  const plugins = listPlugins({ builtinDir, userDir });
  const summary = [];
  const running = [];

  const start = async (plugin) => {
    const base = {
      id: plugin.id,
      name: plugin.name ?? plugin.id,
      kind: plugin.kind ?? "tool",
      origin: plugin.origin,
      version: plugin.version ?? "",
    };

    if (plugin.broken) {
      summary.push({ ...base, status: "error", tools: 0, error: plugin.broken });
      return;
    }
    if (disabled.has(plugin.id)) {
      summary.push({ ...base, status: "off", tools: 0 });
      return;
    }

    const settings = { ...(registry.settings?.[plugin.id] ?? {}) };

    // Без обязательной настройки сервер всё равно не заработает, а ждать его
    // таймаут — значит на полминуты задерживать сводку всех плагинов.
    const missing = (plugin.settings ?? []).filter(
      (field) => field.required && (settings[field.key] === undefined || settings[field.key] === ""),
    );
    if (missing.length) {
      summary.push({
        ...base,
        status: "error",
        tools: 0,
        error: `нужно заполнить в настройках: ${missing.map((field) => field.label ?? field.key).join(", ")}`,
      });
      return;
    }

    try {
      if (base.kind === "mcp") {
        // Настройки плагина уходят серверу переменными окружения.
        // Настройки уходят серверу переменной окружения (env) или хвостом
        // аргументов (arg) — смотря как этот сервер их принимает.
        const env = { ...(plugin.env ?? {}) };
        const args = [...(plugin.args ?? [])];
        for (const field of plugin.settings ?? []) {
          const value = settings[field.key];
          if (value === undefined || value === "") continue;
          if (field.env) env[field.env] = String(value);
          if (field.arg) args.push(String(value));
        }
        const server = await connectMcpServer(operator, plugin.id, {
          command: plugin.command,
          args,
          cwd: plugin.cwd,
          env,
          startTimeout: startTimeoutOf(plugin),
          // Список инструментов запоминается: в следующих диалогах сервер
          // не запускается, пока агент не позовёт его инструмент.
          cacheFile: dataDir ? path.join(dataDir, "tools", `${plugin.id}.json`) : undefined,
          idleTimeout: Number(plugin.idleTimeout) > 0 ? Number(plugin.idleTimeout) * 1000 : undefined,
          keepAlive: plugin.keepAlive === true,
        });
        running.push(server);
        summary.push({ ...base, status: "ready", tools: server.tools.length, toolNames: server.toolNames, sleeping: !server.running });
        return;
      }

      const entry = path.join(plugin.dir, plugin.entry ?? "index.mjs");
      const module = await import(pathToFileURL(entry).href);
      const factory = module.default ?? module.plugin;
      if (typeof factory !== "function") {
        throw new Error("модуль не экспортирует функцию по умолчанию");
      }

      // То, что получает плагин: API оператора и немного своего.
      let count = 0;
      const toolNames = [];
      const api = {
        operator: {
          ...operator,
          registerTool: (tool) => {
            count++;
            if (typeof tool?.name === "string") toolNames.push(tool.name);
            return operator.registerTool(tool);
          },
          on: (event, handler) => operator.on(event, handler),
        },
        id: plugin.id,
        settings,
        dir: plugin.dir,
        storage: createStorage(dataDir, plugin.id),
        notify: (payload) => notify?.({ plugin: plugin.id, ...payload }),
        log: (text) => process.stderr.write(`[плагин ${plugin.id}] ${text}\n`),
      };

      await factory(api);
      summary.push({ ...base, status: "ready", tools: count, toolNames });
    } catch (error) {
      summary.push({
        ...base,
        status: "error",
        tools: 0,
        error: String(error?.message ?? error).slice(0, 300),
      });
    }
  };

  await Promise.all(plugins.map(start));
  summary.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return { plugins: summary, stop: () => running.forEach((server) => server.stop()) };
}
