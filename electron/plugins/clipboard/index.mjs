/**
 * Системный буфер обмена.
 *
 * Программа для этого в каждой системе своя: pbcopy/pbpaste в macOS,
 * wl-copy или xclip в Linux (смотря Wayland или X11), Set/Get-Clipboard
 * в Windows. Плагин выбирает то, что есть, и честно говорит, если нечего.
 */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const IS_MAC = process.platform === "darwin";
const IS_WINDOWS = process.platform === "win32";
const IS_WAYLAND = !IS_MAC && !IS_WINDOWS && Boolean(process.env.WAYLAND_DISPLAY);

function has(command) {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return dirs.some((dir) => fs.existsSync(path.join(dir, command)));
}

function run(command, args, input) {
  return new Promise((resolve) => {
    const child = execFile(command, args, { timeout: 8000 }, (error, stdout) => {
      resolve({ ok: !error, out: String(stdout ?? ""), err: error ? String(error.message) : "" });
    });
    if (input !== undefined) {
      child.stdin.end(input);
    }
  });
}

function reader() {
  if (IS_MAC) return ["pbpaste", []];
  if (IS_WINDOWS) return ["powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"]];
  if (IS_WAYLAND && has("wl-paste")) return ["wl-paste", ["--no-newline"]];
  if (has("xclip")) return ["xclip", ["-selection", "clipboard", "-o"]];
  if (has("xsel")) return ["xsel", ["--clipboard", "--output"]];
  return null;
}

function writer() {
  if (IS_MAC) return ["pbcopy", []];
  if (IS_WINDOWS) return ["powershell", ["-NoProfile", "-Command", "$input | Set-Clipboard"]];
  if (IS_WAYLAND && has("wl-copy")) return ["wl-copy", []];
  if (has("xclip")) return ["xclip", ["-selection", "clipboard"]];
  if (has("xsel")) return ["xsel", ["--clipboard", "--input"]];
  return null;
}

const MISSING =
  "В системе нет программы для буфера обмена. Linux: поставьте wl-clipboard (Wayland) " +
  "или xclip (X11).";

export default function clipboardPlugin({ operator }) {
  operator.registerTool({
    name: "clipboard_read",
    label: "Прочитать буфер",
    description: "Возвращает текст из системного буфера обмена — то, что пользователь скопировал.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute() {
      const tool = reader();
      if (!tool) return { content: [{ type: "text", text: MISSING }], isError: true, details: {} };
      const result = await run(tool[0], tool[1]);
      const text = result.out.trim();
      return {
        content: [{ type: "text", text: text || "Буфер обмена пуст." }],
        isError: !result.ok,
        details: {},
      };
    },
  });

  operator.registerTool({
    name: "clipboard_write",
    label: "Положить в буфер",
    description: "Кладёт текст в системный буфер обмена, чтобы пользователь мог его вставить.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: { text: { type: "string", description: "Что положить в буфер" } },
    },
    async execute(_id, params) {
      const tool = writer();
      if (!tool) return { content: [{ type: "text", text: MISSING }], isError: true, details: {} };
      // wl-copy держит процесс, пока владеет буфером, — его не ждём.
      if (tool[0] === "wl-copy") {
        const child = spawn(tool[0], tool[1], { stdio: ["pipe", "ignore", "ignore"], detached: true });
        child.stdin.end(params.text);
        child.unref();
      } else {
        await run(tool[0], tool[1], params.text);
      }
      return {
        content: [{ type: "text", text: `В буфере: ${params.text.slice(0, 80)}` }],
        details: {},
      };
    },
  });
}
