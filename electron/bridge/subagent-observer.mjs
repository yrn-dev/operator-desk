/** Sends a child agent's tool activity to its parent without changing its answer. */
const PREFIX = "@@desk-subagent@@";

function report(payload) {
  try { process.stderr.write(`${PREFIX}${JSON.stringify(payload)}\n`); } catch { /* Parent may have exited. */ }
}

function subject(input) {
  if (!input || typeof input !== "object") return "";
  for (const key of ["path", "file_path", "pattern", "glob", "query", "command", "url"]) {
    if (typeof input[key] === "string") return input[key].slice(0, 240);
  }
  return "";
}

export default function observeSubagent(operator) {
  operator.on("tool_call", (event) => {
    report({ kind: "start", id: event.toolCallId, name: event.toolName, subject: subject(event.input) });
  });
  operator.on("tool_result", (event) => {
    const content = Array.isArray(event.content) ? event.content : Array.isArray(event.result?.content) ? event.result.content : [];
    const summary = content.filter((part) => part?.type === "text").map((part) => part.text ?? "").join(" ").trim().slice(0, 280);
    report({ kind: "end", id: event.toolCallId, failed: Boolean(event.isError), summary });
  });
}
