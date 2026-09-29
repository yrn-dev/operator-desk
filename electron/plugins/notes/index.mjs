/**
 * Заметки проекта: то, что должно пережить конец диалога.
 *
 * Хранятся обычным markdown-файлом в рабочей папке — его видно в репозитории,
 * можно править руками и коммитить вместе с кодом.
 */
import fs from "node:fs";
import path from "node:path";

function fileFor(settings, cwd) {
  const name = settings.file || ".operator-notes.md";
  return path.isAbsolute(name) ? name : path.join(cwd || process.cwd(), name);
}

function readNotes(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export default function notesPlugin({ operator, settings }) {
  operator.registerTool({
    name: "note_add",
    label: "Записать в заметки",
    description:
      "Сохраняет решение или договорённость в заметки проекта. Уместно для того, " +
      "что понадобится в следующих диалогах: выбранный подход, причины отказа, ссылки.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: {
        text: { type: "string", description: "Текст заметки одной-двумя фразами" },
        cwd: { type: "string", description: "Рабочая папка проекта" },
      },
    },
    async execute(_id, params) {
      const file = fileFor(settings, params.cwd);
      const stamp = new Date().toISOString().slice(0, 10);
      const line = `- ${stamp} — ${params.text.trim()}\n`;
      try {
        if (!fs.existsSync(file)) {
          fs.writeFileSync(file, `# Заметки проекта\n\n${line}`, "utf8");
        } else {
          fs.appendFileSync(file, line, "utf8");
        }
        return { content: [{ type: "text", text: `Записано в ${path.basename(file)}` }], details: {} };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Не удалось записать: ${String(error)}` }],
          isError: true,
          details: {},
        };
      }
    },
  });

  operator.registerTool({
    name: "note_list",
    label: "Прочитать заметки",
    description: "Показывает заметки проекта — что было решено в прошлых диалогах.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { cwd: { type: "string", description: "Рабочая папка проекта" } },
    },
    async execute(_id, params) {
      const file = fileFor(settings, params.cwd);
      const text = readNotes(file).trim();
      return {
        content: [{ type: "text", text: text || "Заметок пока нет." }],
        details: {},
      };
    },
  });
}
