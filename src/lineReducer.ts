import type { Attachment, Entry, LineState, Say, ToolRun } from "./types.ts";

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

/** Текст ошибки провайдера без служебного хвоста LiteLLM. */
function shortError(message: string): string {
  const text = message
    .replace(/No fallback model group found[\s\S]*$/i, "")
    .replace(/^\d{3}\s+/, "")
    .replace(/litellm\.\w+:\s*/gi, "")
    .replace(/OpenAIException\s*-\s*/gi, "")
    .trim();
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

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
        lamp: "ready",
        entries: entries.map((e) => (e.kind === "say" ? { ...e, streaming: false } : e)),
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
      const contextUsed =
        usage && typeof usage.input === "number"
          ? usage.input + (usage.output ?? 0)
          : state.contextUsed;

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
          ? note(next, "Контекст переполнен — сжимаю его и повторю запрос.")
          : note(next, `Модель ответила ошибкой: ${shortError(reason)}`, "alarm");
      }
      return next;
    }

    case "compaction_start":
      return { ...state, compacting: true };

    case "compaction_end": {
      // С повтором оператор сразу продолжит ход — линия остаётся занятой.
      const next = { ...state, compacting: false, lamp: event.willRetry ? ("live" as const) : ("ready" as const) };
      if (event.aborted) return note(next, "Сжатие контекста отменено.");
      if (event.errorMessage) {
        return note(next, `Не удалось сжать контекст: ${shortError(String(event.errorMessage))}`, "alarm");
      }
      if (!event.result) return next;
      // Точный размер станет известен со следующим ответом модели.
      return note({ ...next, contextUsed: 0 }, "Контекст сжат: старая часть диалога заменена краткой сводкой.");
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
          e.kind === "tool" && e.id === event.toolCallId ? { ...e, output } : e,
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
                failed: Boolean(event.isError),
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

export function note(state: LineState, text: string, tone: "info" | "alarm" = "info"): LineState {
  const entry: Entry = { kind: "note", id: nextId(), tone, text };
  return { ...state, entries: [...state.entries, entry] };
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
    }
  }

  return entries;
}
