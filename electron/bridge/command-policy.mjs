/** Shared by foreground/background shell tools and the Desktop policy editor. */
export const COMMAND_TOOLS = new Set(["bash", "background_run"]);

export function subjectOf(tool, input) {
  if (COMMAND_TOOLS.has(tool)) return String(input?.command ?? "");
  return String(input?.path ?? input?.file_path ?? input?.pattern ?? "");
}

export function matchRule(rules, tool, subject) {
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!rule || (rule.tool && rule.tool !== tool)) continue;
    if (typeof rule.subject === "string" && rule.subject !== subject) continue;
    if (rule.pattern) {
      try { if (!new RegExp(rule.pattern, "i").test(subject)) continue; }
      catch { continue; }
    }
    if (["allow", "ask", "deny"].includes(rule.action)) return rule;
  }
  return null;
}

/** Store the complete subject literally, including arguments and shell operators. */
export function rememberedRule(tool, subject) {
  if (typeof tool !== "string" || !tool || typeof subject !== "string" || !subject.trim()) {
    throw new Error("Нельзя запомнить пустой инструмент или действие.");
  }
  return { tool, subject, action: "allow" };
}

/**
 * Inspect words conservatively, including quoted shell payloads and wrappers.
 * This is a confirmation heuristic, not an operating-system sandbox.
 */
export function isDangerousCommand(command) {
  const words = String(command).replace(/\\\r?\n/g, "")
    .replace(/\\([^\s])/g, "$1").replace(/["']/g, "")
    .split(/([;&|()\r\n])|\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const name = words[i].split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, "");
    if (!/^(rm|git|dd|chmod|shutdown|reboot|halt|mkfs(?:\..*)?)$/.test(name)) continue;
    const args = [];
    for (let j = i + 1; j < words.length && !/^[;&|()\r\n]$/.test(words[j]); j++) args.push(words[j]);
    // Options after -- are operands, including file names beginning with '-'.
    const end = args.indexOf("--");
    const options = (end < 0 ? args : args.slice(0, end)).map(value => value.toLowerCase());
    if (name === "rm" && options.some(arg => /^-[^-]*[rf]/i.test(arg) || /^--(recursive|force)(=|$)/.test(arg))) return true;
    if (name === "git") {
      const push = options.indexOf("push");
      if (push >= 0 && (options.slice(push + 1).some(arg => /^--force(?:-with-lease|-if-includes)?(?:=|$)/.test(arg) || /^-[^-]*f/.test(arg)) || args.slice(push + 1).some(arg => arg.startsWith("+")))) return true;
      const reset = options.indexOf("reset");
      if (reset >= 0 && options.slice(reset + 1).some(arg => /^--hard(?:=|$)/.test(arg))) return true;
    }
    if (name === "dd" && args.some(arg => /^if=/.test(arg))) return true;
    if (/^mkfs(?:\.|$)/.test(name) || /^(shutdown|reboot|halt)$/.test(name)) return true;
    if (name === "chmod" && options.some(arg => arg === "--recursive" || /^-[^-]*r/.test(arg)) && args.includes("777")) return true;
  }
  return false;
}
