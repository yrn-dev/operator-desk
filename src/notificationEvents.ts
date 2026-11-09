export type SoundCue = "complete" | "attention";
type AgentEvent = Record<string, any>;
type Turn = { active: boolean; final: SoundCue | null };

/** Only a final request for user input gets the attention cue. Code/URLs are data. */
export function asksForInput(text: string): boolean {
  const prose = text.replace(/```[\s\S]*?(?:```|$)/g, "").replace(/`[^`]*`/g, "")
    .replace(/https?:\/\/\S+/g, "").split("\n").filter(line => !/^\s*(>|\|)/.test(line)).join("\n").trim();
  const last = prose.split(/\n\s*\n/).at(-1)?.replace(/[*_#]/g, "").trim() ?? "";
  return /[?？]\s*[)\]»"'.!…]*$/.test(last) ||
    /^(?:пожалуйста[, ]+)?(?:уточни(?:те)?|подтверди(?:те)?|выбери(?:те)?|пришли(?:те)?|пришлите|напиши(?:те)?|скажи(?:те)?)(?=$|[\s,.:!?])/i.test(last) ||
    /^(?:please\s+)?(?:confirm|choose|select|provide|tell me|let me know)\b/i.test(last);
}

/** No sounds for restored history, token updates, tools, aborts or retries. */
export class NotificationEvents {
  private turns = new Map<string, Turn>();
  private requests = new Set<string>();

  event(id: string, event: AgentEvent): SoundCue | null {
    if (event.type === "agent_start") {
      this.turns.set(id, { active: true, final: null });
      return null;
    }
    const turn = this.turns.get(id);
    if (!turn?.active) return null;
    if (event.type === "message_end" && event.message?.role === "assistant") {
      const message = event.message;
      const text = (Array.isArray(message.content) ? message.content : []).filter((b: any) => b.type === "text").map((b: any) => b.text ?? "").join("").trim();
      turn.final = message.stopReason === "stop" && text ? (asksForInput(text) ? "attention" : "complete") : null;
    }
    if (event.type !== "agent_end" || event.willRetry) return null;
    this.turns.delete(id);
    return turn.final;
  }

  question(id: string, requestId: string): SoundCue | null {
    const key = `${id}\u001f${requestId}`;
    if (this.requests.has(key)) return null;
    if (this.requests.size >= 128) this.requests.delete(this.requests.values().next().value!);
    this.requests.add(key);
    return "attention";
  }

  cancel(id: string) { this.turns.delete(id); }
  close(id: string) {
    this.cancel(id);
    for (const key of this.requests) if (key.startsWith(`${id}\u001f`)) this.requests.delete(key);
  }
}
