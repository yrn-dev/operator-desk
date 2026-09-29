import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type SessionSummary = {
  /** Путь к .jsonl — его принимает команда switch_session. */
  path: string;
  cwd: string;
  title: string;
  /** Время последней записи, ISO. */
  updatedAt: string;
  /** Откуда сессия: из этого приложения или из терминала. */
  origin: "desk" | "cli";
};

const HEAD_BYTES = 48 * 1024;
const MAX_SESSIONS = 300;

/** Каталог сессий оператора: ~/.opr/agent/sessions/<папка проекта>/*.jsonl */
function sessionsRoot(): string {
  return path.join(os.homedir(), ".opr", "agent", "sessions");
}

/** Имя, заданное командой set_session_name: его писал генератор названий. */
function extractName(head: string): string | null {
  let name: string | null = null;
  for (const line of head.split("\n")) {
    if (!line.includes('"type":"session_info"')) continue;
    try {
      const entry = JSON.parse(line);
      if (typeof entry?.name === "string" && entry.name.trim()) name = entry.name.trim();
    } catch {
      continue;
    }
  }
  return name;
}

/** Первая реплика пользователя — запасное название, если имя не задано. */
function extractTitle(head: string): string | null {
  for (const line of head.split("\n")) {
    if (!line.includes('"role":"user"')) continue;
    try {
      const entry = JSON.parse(line);
      const blocks = entry?.message?.content;
      if (!Array.isArray(blocks)) continue;
      const text = blocks
        .filter((block: { type?: string }) => block?.type === "text")
        .map((block: { text?: string }) => block.text ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) return text.length > 90 ? `${text.slice(0, 90)}…` : text;
    } catch {
      continue;
    }
  }
  return null;
}

async function readSession(file: string, own: Set<string>): Promise<SessionSummary | null> {
  let handle;
  try {
    handle = await fs.open(file, "r");
    const stat = await handle.stat();
    if (stat.size === 0) return null;

    const buffer = Buffer.alloc(Math.min(HEAD_BYTES, stat.size));
    await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.toString("utf8");

    const firstLine = head.slice(0, head.indexOf("\n"));
    const header = JSON.parse(firstLine);
    if (header?.type !== "session") return null;

    const title = extractName(head) ?? extractTitle(head);
    if (!title) return null; // пустая сессия без единой реплики

    return {
      path: file,
      cwd: String(header.cwd ?? ""),
      title,
      updatedAt: stat.mtime.toISOString(),
      origin: own.has(file) ? "desk" : "cli",
    };
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/** Все сессии оператора, свежие сверху. */
export async function listSessions(own: Set<string> = new Set()): Promise<SessionSummary[]> {
  const root = sessionsRoot();
  let projectDirs: string[];
  try {
    projectDirs = await fs.readdir(root);
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const dir of projectDirs) {
    try {
      const entries = await fs.readdir(path.join(root, dir));
      for (const entry of entries) {
        if (entry.endsWith(".jsonl")) files.push(path.join(root, dir, entry));
      }
    } catch {
      continue;
    }
  }

  // Имя файла начинается с метки времени, так что свежие видно без stat.
  files.sort((a, b) => path.basename(b).localeCompare(path.basename(a)));

  const summaries: SessionSummary[] = [];
  for (const file of files.slice(0, MAX_SESSIONS)) {
    const summary = await readSession(file, own);
    if (summary) summaries.push(summary);
  }

  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return summaries;
}
