import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { spawnPortable } from "./portable.ts";
import path from "node:path";
import { EventEmitter } from "node:events";

/**
 * opr — node-скрипт, поэтому рядом с ним должен быть виден node. У приложения,
 * запущенного из меню рабочего стола, PATH урезан, и каталог nvm туда не входит.
 */
export function pathWithBin(bin: string): string {
  const dir = path.dirname(bin);
  const current = process.env.PATH ?? "";
  return current.split(path.delimiter).includes(dir) ? current : `${dir}${path.delimiter}${current}`;
}

/** Событие агента, как его отдаёт operator в режиме --mode rpc. */
export type AgentEvent = { type: string; [key: string]: unknown };

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

export type LineOptions = {
  cwd: string;
  provider?: string;
  model?: string;
  bin?: string;
  /** Аргументы перед своими: путь к cli.js, когда оператор встроен. */
  prefixArgs?: string[];
  /** Расширения, подгружаемые в процесс (мост десктопа). */
  extensions?: string[];
  /** Файл с дополнением к системному промпту — про саму среду. */
  appendPrompt?: string;
  /** Дополнительные переменные окружения для процесса. */
  env?: Record<string, string>;
};

/**
 * Одна «линия» — отдельный процесс operator в режиме RPC.
 * Команды уходят в stdin построчным JSON, ответы и события приходят из stdout.
 */
export class OperatorLine extends EventEmitter {
  readonly id: string;
  readonly cwd: string;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private seq = 0;
  private pending = new Map<string, Pending>();
  private stderrTail: string[] = [];
  /** Процесс жив и его stdin ещё можно писать. */
  private alive = false;

  constructor(id: string, private options: LineOptions) {
    super();
    this.id = id;
    this.cwd = options.cwd;
  }

  start(): void {
    const args = [...(this.options.prefixArgs ?? []), "--mode", "rpc"];
    if (this.options.provider) args.push("--provider", this.options.provider);
    if (this.options.model) args.push("--model", this.options.model);
    for (const extension of this.options.extensions ?? []) args.push("-e", extension);
    if (this.options.appendPrompt) args.push("--append-system-prompt", this.options.appendPrompt);

    const bin = this.options.bin ?? "opr";
    this.proc = spawnPortable(bin, args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.options.env, NO_COLOR: "1", PATH: pathWithBin(bin) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;

    this.alive = true;

    // Когда opr умирает во время записи, поток отдаёт EPIPE событием error.
    // Без слушателя это необработанное исключение и падение всего приложения.
    this.proc.stdin.on("error", () => {
      this.alive = false;
    });

    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.consume(chunk));

    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk: string) => {
      this.stderrTail.push(chunk);
      if (this.stderrTail.length > 50) this.stderrTail.shift();
    });

    this.proc.on("error", (err) => {
      this.alive = false;
      this.emit("fatal", `не удалось запустить «${bin}»: ${err.message}`);
    });

    this.proc.on("exit", (code) => {
      this.alive = false;
      const reason = new Error(`линия оборвалась (код ${code ?? "?"})`);
      for (const [, p] of this.pending) p.reject(reason);
      this.pending.clear();
      this.emit("exit", code, this.stderrTail.join(""));
    });
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      this.dispatch(parsed);
    }
  }

  private dispatch(message: Record<string, unknown>): void {
    if (message.type === "response") {
      const id = String(message.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (message.success) pending.resolve(message.data);
      else pending.reject(new Error(String(message.error ?? "команда отклонена")));
      return;
    }
    this.emit("event", message as AgentEvent);
  }

  /** Отправляет команду и ждёт ответа с тем же id. */
  /**
   * Линия отвечает, только пока процесс жив и его stdin не уничтожен.
   * Флаг killed на это не годится: он встаёт лишь после нашего kill(),
   * а смерть по внешнему сигналу его не меняет.
   */
  private get writable(): boolean {
    return this.alive && Boolean(this.proc) && !this.proc!.stdin.destroyed;
  }

  send<T = unknown>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (!this.writable) {
      return Promise.reject(new Error("линия не подключена"));
    }
    const id = `c${++this.seq}`;
    const command = JSON.stringify({ ...payload, id, type }) + "\n";
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending["resolve"], reject });
      try {
        this.proc!.stdin.write(command, (err) => {
          if (err) {
            this.pending.delete(id);
            reject(err);
          }
        });
      } catch (err) {
        // Запись в уничтоженный поток бросает синхронно, минуя обратный вызов.
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  /**
   * Ответ на запрос диалога от расширения. В RPC такие запросы приходят
   * событием extension_ui_request и ждут ответа с тем же id.
   */
  respondUI(id: string, payload: Record<string, unknown>): void {
    if (!this.writable) return;
    try {
      this.proc!.stdin.write(JSON.stringify({ type: "extension_ui_response", id, ...payload }) + "\n");
    } catch {
      // Линия уже оборвалась — отвечать некому.
    }
  }

  stop(): void {
    // Ждущие ответа промисы надо отклонить, иначе вызывающий висит вечно.
    const reason = new Error("линия закрыта");
    for (const [, p] of this.pending) p.reject(reason);
    this.pending.clear();

    this.alive = false;
    const proc = this.proc;
    this.proc = null;
    if (!proc) return;

    proc.kill();
    // Если на SIGTERM процесс не ушёл, добиваем — иначе останется сиротой.
    setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    }, 2000).unref();
  }
}
