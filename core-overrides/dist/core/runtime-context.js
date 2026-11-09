import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let archiveDir;
const archived = new Map();
const textOf = message => (Array.isArray(message.content) ? message.content : []).filter(b => b.type === "text").map(b => b.text).join("\n");
const digest = text => createHash("sha256").update(text).digest("hex");
const stable = value => value && typeof value === "object"
    ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const OBSERVATIONS = new Set(["read", "read_full", "grep", "find", "ls", "memory_recall", "git_status", "git_diff"]);
function observationText(message) {
    const text = textOf(message);
    if (message.toolName !== "browser") return text;
    try {
        const page = JSON.parse(text);
        // Observation IDs change on every snapshot even when the page does not.
        return JSON.stringify({ ...page, snapshot: undefined });
    } catch { return text; }
}

/** Count observed failures, never merely the number or duration of useful steps. */
export function inspectProgress(messages) {
    const calls = new Map();
    const observations = [];
    let errors = 0;
    for (const message of messages) {
        if (message.role === "user") { calls.clear(); observations.length = 0; errors = 0; }
        if (message.role === "assistant") {
            for (const block of message.content ?? []) if (block.type === "toolCall") calls.set(block.id, block);
        }
        if (message.role !== "toolResult") continue;
        const call = calls.get(message.toolCallId);
        const key = digest(JSON.stringify([message.toolName, stable(call?.arguments), observationText(message)]));
        errors = message.isError ? errors + 1 : 0;
        const readOnly = OBSERVATIONS.has(message.toolName) || message.toolName === "browser" && ["snapshot", "tabs"].includes(call?.arguments?.action);
        if (!message.isError && !readOnly) observations.length = 0;
        observations.push({ key, error: Boolean(message.isError), readOnly });
        if (observations.length > 24) observations.shift();
    }
    const last = observations.at(-1);
    const repeats = last ? observations.filter(item => item.key === last.key).length : 0;
    return { stalled: errors >= 12 || Boolean(last?.error && repeats >= 6) || Boolean(last?.readOnly && repeats >= 12),
        warning: errors >= 4 || Boolean(last?.error && repeats >= 3) || Boolean(last?.readOnly && repeats >= 6), errors, repeats };
}

function archive(text) {
    const key = digest(text);
    if (archived.has(key)) return archived.get(key);
    archiveDir ??= mkdtempSync(join(tmpdir(), "operator-tool-context-"));
    const file = join(archiveDir, `${key}.txt`);
    writeFileSync(file, text, { mode: 0o600 });
    // Bound the index; files remain readable for the lifetime of the session.
    if (archived.size >= 256) archived.delete(archived.keys().next().value);
    archived.set(key, file);
    return file;
}

/** A request-only view: complete tool results remain in session history and on disk. */
export function prepareRuntimeContext(context, { omitThinking = false } = {}) {
    const progress = inspectProgress(context.messages);
    let recentResults = 0;
    const messages = context.messages.slice();
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (omitThinking && message.role === "assistant" && message.content.some(block => block.type === "thinking")) {
            messages[i] = { ...message, content: message.content.filter(block => block.type !== "thinking") };
        }
        if (message.role !== "toolResult" || ++recentResults <= 8) continue;
        let changed = false;
        const content = message.content.map(block => {
            if (block.type !== "text" || block.text.length <= 4000) return block;
            try {
                const file = archive(block.text);
                changed = true;
                return { ...block, text: `${block.text.slice(0, 1600)}\n\n[Earlier tool output shortened for context. Full original: ${file}; read the relevant section if needed.]\n\n${block.text.slice(-1200)}` };
            } catch { return block; }
        });
        if (changed) messages[i] = { ...message, content };
    }
    let systemPrompt = context.systemPrompt;
    if (progress.stalled) systemPrompt += "\n\n[Runtime: repeated attempts made no observable progress.] Tool execution is paused for this response. Give a concise, honest status: verified completed work, the concrete blocker, and what is needed next. Do not claim completion. Do not invent tool calls. A new user instruction resumes tool access.";
    else if (progress.warning) systemPrompt += "\n\n[Runtime: repeated failures or unchanged observations.] Reassess the current approach before the next action. Read the actual error, check prerequisites or choose an available alternative. Avoid repeating the same failed call or polling an unchanged result. Preserve the user's goal and authorization.";
    return { context: { ...context, messages, systemPrompt, ...(progress.stalled ? { tools: [] } : {}) }, ...progress };
}
