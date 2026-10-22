import type { Attachment, Entry, LineState, Say, ToolRun } from "./types.ts";
import { describeUserError, type UserErrorKind } from "./userError.ts";

type Block = { type: string; text?: string; thinking?: string };

function collect(message: any): { text: string; thinking: string } {
  const blocks: Block[] = Array.isArray(message?.content) ? message.content : [];
  let text = "";
  let thinking = "";
  for (const block of blocks) {
    if (block.type === "text" && block.text) text += block.text;
    else if (block.type === "thinking" && block.thinking) thinking += block.thinking;
  }
  return { text, thinking };
}

/** Короткое человеческое имя действия для карточки инструмента. */
export function toolCaption(name: string, args: Record<string, unknown>): string {
  const a = args ?? {};
  switch (name) {
    case "bash": return String(a.command ?? "");
    case "read": return String(a.path ?? a.file_path ?? "");
    case "write": return String(a.path ?? a.file_path ?? "");
    case "edit": return String(a.path ?? a.file_path ?? "");
    case "grep": return String(a.pattern ?? "");
    case "find": return String(a.pattern ?? a.glob ?? "");
    case "ls": return String(a.path ?? ".");
    default: {
      const first = Object.values(a)[0];
      return typeof first === "string" ? first : "";
    }
  }
}

function resultText(result: any): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (Array.isArray(result?.content)) {
    return result.content
      .filter((c: Block) => c.type === "text")
      .map((c: Block) => c.text ?? "")
      .join("");
  }
  if (typeof result?.output === "string") return result.output;
  return "";
}

let counter = 0;
const nextId = () => `e${++counter}`;

/** Переполнение контекста: оператор сам сожмёт его и повторит запрос. */
const OVERFLOW = /context length|context window|ContextWindowExceeded|too many tokens|prompt is too long/i;

/** Переводит поток событий agent → ленту переговоров. */
export function applyEvent(state: LineState, event: Record<string, any>): LineState {
  const entries = state.entries;
  const last = entries[entries.length - 1];

  // Ответ пошёл — «отправляется» больше не нужно.
  if (
    state.sending &&
    (event.type === "message_update" ||
      event.type === "tool_execution_start" ||
      event.type === "agent_end")
  ) {
    state = { ...state, sending: false };
  }

  switch (event.type) {
    case "thinking_level_changed":
      return { ...state, thinkingLevel: String(event.level ?? state.thinkingLevel) };

    case "agent_start":
      return { ...state, lamp: "live" };

    case "agent_end":
      return {
        ...state,
        lamp: event.willRetry || state.compacting ? "live" : "ready",
        entries: entries.map((e) => (e.kind === "say" && e.streaming ? { ...e, streaming: false } : e)),
      };

    case "message_start": {
      // Рисуем только ответ модели: эхо реплик пользователя и сообщения
      // с результатами инструментов в ленту не попадают.
      if (event.message?.role !== "assistant") return state;
      const { text, thinking } = collect(event.message);
      const say: Say = { kind: "say", id: nextId(), role: "operator", text, thinking, streaming: true };
      return { ...state, entries: [...entries, say] };
    }

    case "message_update": {
      const partial = event.assistantMessageEvent?.partial ?? event.message;
      const { text, thinking } = collect(partial);
      if (last?.kind === "say" && last.role === "operator") {
        const updated: Say = { ...last, text, thinking };
        return { ...state, entries: [...entries.slice(0, -1), updated] };
      }
      const say: Say = { kind: "say", id: nextId(), role: "operator", text, thinking, streaming: true };
      return { ...state, entries: [...entries, say] };
    }

    case "message_end": {
      if (event.message?.role !== "assistant") return state;
      const { text, thinking } = collect(event.message);
      const usage = event.message?.usage;
      const measured = usage ? (usage.totalTokens ||
        (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)) : 0;
      const contextUsed = measured > 0 ? measured : state.contextUsed;

      let nextEntries = entries;
      if (last?.kind === "say" && last.role === "operator") {
        nextEntries = [...entries.slice(0, -1), { ...last, text, thinking, streaming: false }];
      }
      // Пустая реплика без текста — только инструменты, показывать нечего.
      nextEntries = nextEntries.filter(
        (e) => !(e.kind === "say" && e.role === "operator" && !e.text.trim() && !e.thinking.trim()),
      );
      const next = { ...state, entries: nextEntries, contextUsed };
      // Ответ, оборванный ошибкой, приходит пустым — без заметки лента молчит.
      if (event.message?.stopReason === "error") {
        const reason = String(event.message?.errorMessage ?? "неизвестная ошибка");
        return OVERFLOW.test(reason)
          ? note(next, "Контекст переполнен — сжимаю его и повторю запрос.", "info", "context")
          : errorNote(next, reason);
      }
      return next;
    }

    case "compaction_start":
      return { ...state, compacting: true, sending: false, lamp: "live" };

    case "auto_continue_start":
      return note({ ...state, lamp: "live" }, "Достигнут лимит одного ответа — продолжаю задачу автоматически.");

    case "auto_continue_end":
      return note({ ...state, lamp: "ready" }, "Модель несколько раз исчерпала лимит ответа подряд. Автопродолжение остановлено, чтобы избежать зацикливания.", "alarm");

    case "compaction_end": {
      // С повтором оператор сразу продолжит ход — линия остаётся занятой.
      const next = { ...state, compacting: false, sending: false, lamp: event.willRetry ? ("live" as const) : ("ready" as const) };
      if (event.aborted) return note(next, "Сжатие контекста отменено.");
      if (event.errorMessage) {
        return errorNote(next, event.errorMessage, "Не удалось сократить переписку. ");
      }
      if (!event.result) return next;
      const contextUsed = typeof event.result.estimatedTokensAfter === "number"
        ? event.result.estimatedTokensAfter : next.contextUsed;
      const message = event.result.details?.recovery === "local"
        ? "Не удалось получить сводку от ИИ-сервиса. Сохранил краткий контекст локально. Полная история на месте."
        : "Сохранил важное из переписки. Полная история на месте.";
      return note({ ...next, contextUsed }, message + (event.willRetry ? " Продолжаю задачу." : ""), "info", "context");
    }

    case "tool_execution_start": {
      const run: ToolRun = {
        kind: "tool",
        id: event.toolCallId,
        name: event.toolName,
        args: event.args ?? {},
        output: "",
        done: false,
        failed: false,
        startedAt: Date.now(),
      };
      return { ...state, entries: [...entries, run] };
    }

    case "tool_execution_update": {
      const output = resultText(event.partialResult);
      return {
        ...state,
        entries: entries.map((e) =>
          e.kind === "tool" && e.id === event.toolCallId
            ? { ...e, output, details: event.partialResult?.details ?? e.details }
            : e,
        ),
      };
    }

    case "tool_execution_end": {
      const output = resultText(event.result);
      return {
        ...state,
        entries: entries.map((e) =>
          e.kind === "tool" && e.id === event.toolCallId
            ? {
                ...e,
                output: output || e.output,
                done: true,
                failed: Boolean(event.isError || event.result?.isError),
                details: event.result?.details ?? e.details,
                endedAt: Date.now(),
              }
            : e,
        ),
      };
    }

    default:
      return state;
  }
}

export function note(state: LineState, text: string, tone: "info" | "alarm" = "info", icon?: UserErrorKind): LineState {
  const entry: Entry = { kind: "note", id: nextId(), tone, text, ...(icon ? { icon } : {}) };
  return { ...state, entries: [...state.entries, entry] };
}

export function errorNote(state: LineState, error: unknown, prefix = ""): LineState {
  const failure = describeUserError(error);
  return note(state, prefix + failure.message, "alarm", failure.kind);
}

export function speak(state: LineState, text: string, attachments: Attachment[] = []): LineState {
  const entry: Say = {
    kind: "say",
    id: nextId(),
    role: "user",
    text,
    thinking: "",
    streaming: false,
    attachments: attachments.length ? attachments : undefined,
  };
  return { ...state, entries: [...state.entries, entry] };
}

/**
 * Восстанавливает ленту из сохранённой сессии. Принимает и сам массив,
 * и ответ команды get_messages в виде { messages: [...] }.
 */
export function entriesFromMessages(payload: any): Entry[] {
  const messages: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.messages)
      ? payload.messages
      : [];

  const entries: Entry[] = [];
  const toolIndex = new Map<string, ToolRun>();

  for (const message of messages) {
    if (message?.role === "user") {
      const { text } = collect(message);
      if (text.trim()) {
        entries.push({ kind: "say", id: nextId(), role: "user", text, thinking: "", streaming: false });
      }
      continue;
    }

    if (message?.role === "assistant") {
      const { text, thinking } = collect(message);
      if (text.trim() || thinking.trim()) {
        entries.push({ kind: "say", id: nextId(), role: "operator", text, thinking, streaming: false });
      }
      if (message.stopReason === "error") {
        const failure = describeUserError(message.errorMessage, false);
        entries.push({ kind: "note", id: nextId(), tone: "alarm", text: failure.message, icon: failure.kind });
      }
      const blocks: any[] = Array.isArray(message.content) ? message.content : [];
      for (const block of blocks) {
        if (block?.type !== "toolCall") continue;
        const run: ToolRun = {
          kind: "tool",
          id: block.id,
          name: block.name,
          args: block.arguments ?? {},
          output: "",
          done: true,
          failed: false,
        };
        toolIndex.set(block.id, run);
        entries.push(run);
      }
      continue;
    }

    if (message?.role === "toolResult") {
      const run = toolIndex.get(message.toolCallId);
      if (!run) continue;
      run.output = resultText(message);
      run.failed = Boolean(message.isError);
      run.details = message.details;
    }
  }

  return entries;
}
