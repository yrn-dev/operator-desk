/** Bound summaries even when a provider ignores cancellation or never produces a result. */
export async function withSummaryDeadline(work, signal, timeoutMs = 45000) {
    const controller = new AbortController();
    let timer;
    let onAbort;
    const deadline = new Promise((_, reject) => {
        onAbort = () => {
            const error = new Error("Compaction cancelled");
            error.name = "AbortError";
            controller.abort(error);
            reject(error);
        };
        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => {
            const error = new Error("Compaction summary timed out");
            error.name = "CompactionTimeoutError";
            controller.abort(error);
            reject(error);
        }, timeoutMs);
    });
    try {
        if (signal?.aborted) return await deadline;
        return await Promise.race([deadline, Promise.resolve().then(() => work(controller.signal))]);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        controller.abort();
    }
}

export function boundedText(value, limit) {
    const text = String(value ?? "");
    if (text.length <= limit) return text;
    const marker = "\n[Middle omitted; original content remains in session history.]\n";
    const head = Math.floor((limit - marker.length) / 3);
    return text.slice(0, head) + marker + text.slice(-(limit - marker.length - head));
}

/** Recover an honest extractive checkpoint; never replace history with an empty summary. */
export function recoverySummary(preparation) {
    const all = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
    const userText = message => typeof message.content === "string" ? message.content
        : (message.content ?? []).filter(block => block.type === "text").map(block => block.text).join("\n");
    const users = all.filter(message => message.role === "user");
    const requests = [...new Set([users[0], ...users.slice(-6)].filter(Boolean))];
    const work = all.filter(message => message.role === "assistant").slice(-8).map(message => {
        const text = userText(message);
        const tools = (message.content ?? []).filter(block => block.type === "toolCall")
            .map(block => `${block.name}(${boundedText(JSON.stringify(block.arguments), 1200)})`).join("\n");
        return boundedText([text, tools].filter(Boolean).join("\n"), 1800);
    }).filter(Boolean);
    return [
        "## Recovery checkpoint\nThe summary service was unavailable. This is a local extractive checkpoint, not a verified account of completion. The original conversation and tool results remain in session history. Continue the user's authorized task; inspect retained results and files before repeating actions. Preserve refusals and pending approval requirements.",
        preparation.previousSummary ? `## Previous checkpoint\n${boundedText(preparation.previousSummary, 10000)}` : "",
        `## User requests and constraints\n${boundedText(requests.map(userText).join("\n\n---\n\n"), 16000)}`,
        `## Recent assistant progress and tool calls\n${work.join("\n\n") || "See retained recent messages."}`,
    ].filter(Boolean).join("\n\n");
}
