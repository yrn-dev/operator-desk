import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Операции над файлами сессий оператора. Формат — JSONL, где каждая запись
 * ссылается на предыдущую через parentId; имя задаётся записью session_info.
 */

/** Последняя запись файла: её id становится parentId для дописываемой. */
async function lastEntryId(file: string): Promise<string | null> {
  const raw = await fs.readFile(file, "utf8");
  const lines = raw.split("\n").filter((line) => line.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (typeof entry?.id === "string") return entry.id;
    } catch {
      continue;
    }
  }
  return null;
}

/** Переименование = новая запись session_info в конце файла. */
export async function renameSession(file: string, name: string): Promise<void> {
  const entry = {
    type: "session_info",
    id: crypto.randomBytes(4).toString("hex"),
    parentId: await lastEntryId(file),
    timestamp: new Date().toISOString(),
    name: name.trim(),
  };
  await fs.appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function deleteSession(file: string): Promise<void> {
  await fs.unlink(file);
}

/** Экспорт в JSON: массив записей вместо построчного JSONL. */
export async function exportSessionJson(file: string, target: string): Promise<void> {
  const raw = await fs.readFile(file, "utf8");
  const entries = raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  await fs.writeFile(target, JSON.stringify(entries, null, 2), "utf8");
}

/** Имя файла для диалога сохранения. */
export function suggestedName(title: string, extension: string): string {
  const base = title
    .replace(/[\\/:*?"<>|\n\r]+/g, " ")
    .trim()
    .slice(0, 60)
    .replace(/\s+/g, "-");
  return `${base || "session"}.${extension}`;
}

export function isSessionFile(file: string): boolean {
  return path.extname(file) === ".jsonl";
}
