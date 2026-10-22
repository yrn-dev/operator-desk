import type { AgentEvent } from "./rpc.ts";

/** The transcript uses text snapshots, not the model's full protocol history. */
export function transcriptEvent(event: AgentEvent): AgentEvent | null {
  if (event.type === "agent_end") return { type: event.type, willRetry: event.willRetry };
  if (event.type === "turn_start" || event.type === "turn_end") return null;
  if (["message_start", "message_update", "message_end"].includes(event.type)) {
    const update = event.assistantMessageEvent as { partial?: any } | undefined;
    const message: any = update?.partial ?? event.message;
    if (message?.role !== "assistant") return null;
    return { type: event.type, message: {
      role: message.role,
      content: Array.isArray(message.content) ? message.content.filter((block: any) => block.type === "text" || block.type === "thinking")
        .map((block: any) => block.type === "text" ? { type: "text", text: block.text } : { type: "thinking", thinking: block.thinking }) : [],
      ...(event.type === "message_end" ? { usage: message.usage, stopReason: message.stopReason, errorMessage: message.errorMessage } : {}),
    } };
  }
  return event;
}

/** Coalesce replaceable snapshots; always deliver boundaries immediately and in order. */
export function createUiEventStream(send: (event: AgentEvent) => void, intervalMs = 32) {
  const pending = new Map<string, AgentEvent>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    for (const event of pending.values()) send(event);
    pending.clear();
  };
  return {
    push(raw: AgentEvent) {
      if (disposed) return;
      const event = transcriptEvent(raw);
      if (!event) return;
      const key = event.type === "message_update" ? "message" : event.type === "tool_execution_update" ? `tool:${event.toolCallId}` : null;
      if (key !== null) {
        pending.set(key, event);
        timer ??= setTimeout(flush, intervalMs);
      } else { flush(); send(event); }
    },
    flush,
    dispose() { disposed = true; if (timer) clearTimeout(timer); timer = undefined; pending.clear(); },
  };
}
