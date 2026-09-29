/**
 * Клиент MCP (Model Context Protocol) поверх stdio.
 *
 * Каждый инструмент сервера регистрируется в операторе под именем
 * `<сервер>__<инструмент>`, поэтому модель видит их как обычные инструменты.
 *
 * Серверы ленивые. Держать их запущенными дорого: каждый — отдельный node
 * или python на сотни мегабайт, а браузерные ещё и тянут Chromium. Поэтому
 * после первого запуска список инструментов запоминается, и в следующих
 * диалогах инструменты регистрируются из кеша без запуска сервера. Сервер
 * поднимается при первом вызове своего инструмента и засыпает после простоя.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { killTree, spawnPortable } from "./platform.mjs";

const PROTOCOL_VERSION = "2024-11-05";

/** Сколько сервер живёт без вызовов, прежде чем уснуть. */
const DEFAULT_IDLE = 5 * 60_000;

/**
 * Самая содержательная строка из вывода упавшего сервера: обычно это
 * последняя строка трассировки вида «ValueError: …», а не рамки и пустоты.
 */
function lastMeaningfulLine(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trim())
    .filter((line) => line && !/^[│╭╰─┃┏┗━\s]+$/.test(line));
  const error = [...lines].reverse().find((line) => /error|exception|not found|invalid|missing|required|failed/i.test(line));
  return (error ?? lines.at(-1) ?? "").slice(0, 240);
}

/** Одно stdio-соединение с MCP-сервером. */
class McpServer {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.proc = null;
    this.buffer = "";
    this.seq = 0;
    this.pending = new Map();
    this.tools = [];
  }

  get running() {
    return Boolean(this.proc);
  }

  async start() {
    const proc = spawnPortable(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd || process.cwd(),
      env: { ...process.env, ...(this.config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.proc = proc;
    this.buffer = "";

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => this.consume(chunk));

    // Хвост вывода ошибок: без него «сервер остановился» ничего не объясняет,
    // а настоящая причина — нет строки подключения, не тот каталог — лежит здесь.
    this.stderr = "";
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-2000);
    });

    proc.on("exit", (code) => {
      // Уснувший сервер мог уже смениться новым — старый выход его не касается.
      if (this.proc === proc) this.proc = null;
      const reason = lastMeaningfulLine(this.stderr);
      const error = new Error(
        reason ? `сервер остановился: ${reason}` : `сервер остановился (код ${code ?? "?"})`,
      );
      for (const [, pending] of this.pending) pending.reject(error);
      this.pending.clear();
    });

    proc.on("error", (error) => {
      if (this.proc === proc) this.proc = null;
      for (const [, pending] of this.pending) pending.reject(error);
      this.pending.clear();
    });

    await this.request(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "operator-desk", version: "0.1.0" },
      },
      // Серверу со входом через браузер нужно время, пока человек логинится.
      this.config.startTimeout ?? 30_000,
    );
    this.notify("notifications/initialized");

    const listed = await this.request("tools/list", {});
    this.tools = Array.isArray(listed?.tools) ? listed.tools : [];
    return this.tools;
  }

  consume(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }

      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "ошибка MCP"));
      else pending.resolve(message.result);
    }
  }

  request(method, params, timeout = 60_000) {
    if (!this.proc) return Promise.reject(new Error(`MCP «${this.name}»: сервер не запущен`));
    const id = ++this.seq;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP «${this.name}»: ответ не пришёл (${method})`));
      }, timeout);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.proc.stdin.write(payload);
    });
  }

  notify(method, params) {
    this.proc?.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  call(tool, args) {
    return this.request("tools/call", { name: tool, arguments: args ?? {} });
  }

  stop() {
    // npx поднимает node отдельным процессом — гасим всё дерево.
    if (this.proc?.pid) killTree(this.proc.pid, { force: true });
    this.proc = null;
  }
}

/** MCP отдаёт JSON Schema — оператору нужен объект-схема, приводим к нему. */
function toParameters(inputSchema) {
  if (inputSchema && inputSchema.type === "object") {
    return { additionalProperties: false, properties: {}, ...inputSchema };
  }
  return { type: "object", properties: {}, additionalProperties: true };
}

function resultToContent(result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const text = blocks
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text || JSON.stringify(result ?? {}).slice(0, 4000);
}

/**
 * Отпечаток запуска: если поменялись команда, аргументы или окружение,
 * запомненный список инструментов уже не годится. Значения переменных
 * хешируются — секреты в файл кеша не попадают.
 */
function fingerprint(config) {
  const env = Object.entries(config.env ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([config.command, config.args ?? [], env]))
    .digest("hex")
    .slice(0, 16);
}

function readCache(file, print) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data.fingerprint === print && Array.isArray(data.tools) && data.tools.length ? data.tools : null;
  } catch {
    return null;
  }
}

function writeCache(file, print, tools) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ fingerprint: print, savedAt: new Date().toISOString(), tools }));
  } catch {
    // Не записали — в следующий раз сервер просто запустится при старте диалога.
  }
}

/**
 * Подключает сервер и регистрирует его инструменты в операторе.
 * Вызывается загрузчиком плагинов: сервер MCP — это плагин вида "mcp".
 *
 * config.cacheFile — где хранить список инструментов (без него сервер не ленивый),
 * config.idleTimeout — через сколько миллисекунд простоя сервер засыпает,
 * config.keepAlive — не усыплять вовсе (например, браузер с открытыми вкладками).
 */
export async function connectMcpServer(operator, name, config) {
  if (!config?.command) throw new Error("не указана команда запуска");

  const server = new McpServer(name, config);
  const print = fingerprint(config);
  const idle = config.keepAlive ? 0 : (config.idleTimeout ?? DEFAULT_IDLE);
  let idleTimer = null;
  let starting = null;
  let active = 0;

  /** Сервер запущен и готов: поднимаем, если спит, но не дважды. */
  const ensure = () => {
    if (server.running) return Promise.resolve(server.tools);
    if (!starting) {
      starting = server
        .start()
        .then((tools) => {
          if (config.cacheFile) writeCache(config.cacheFile, print, tools);
          return tools;
        })
        .finally(() => {
          starting = null;
        });
    }
    return starting;
  };

  const sleepLater = () => {
    if (!idle || !config.cacheFile) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (active === 0) server.stop();
    }, idle);
    idleTimer.unref?.();
  };

  // Список инструментов из кеша — сервер при этом не запускается вовсе.
  let tools = config.cacheFile ? readCache(config.cacheFile, print) : null;
  if (!tools) {
    tools = await ensure();
    sleepLater();
  }

  for (const tool of tools) {
    operator.registerTool({
      name: `${name}__${tool.name}`.replace(/[^a-zA-Z0-9_]/g, "_"),
      label: `${name}: ${tool.name}`,
      description: tool.description ?? `Инструмент ${tool.name} сервера ${name}`,
      parameters: toParameters(tool.inputSchema),
      async execute(_toolCallId, params) {
        active++;
        clearTimeout(idleTimer);
        try {
          await ensure();
          const result = await server.call(tool.name, params);
          return {
            content: [{ type: "text", text: resultToContent(result) }],
            isError: Boolean(result?.isError),
            details: { server: name, tool: tool.name },
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Плагин «${name}»: ${String(error)}` }],
            isError: true,
            details: { server: name, tool: tool.name },
          };
        } finally {
          active--;
          sleepLater();
        }
      },
    });
  }

  return {
    name,
    tools,
    get running() {
      return server.running;
    },
    stop: () => {
      clearTimeout(idleTimer);
      server.stop();
    },
  };
}
