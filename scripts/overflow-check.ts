/**
 * Переполнение контекста глазами ленты: прогоняет записанные события оператора
 * (ошибка переполнения → сжатие → повтор) через applyEvent и печатает, что видно.
 * Запуск: npx tsx scripts/overflow-check.ts <events.jsonl>
 */
import fs from "node:fs";
import { applyEvent } from "../src/lineReducer.ts";
import type { LineState } from "../src/types.ts";

const file = process.argv[2];
let line: LineState = {
  id: "t", label: "t", cwd: "/tmp", lamp: "ready", entries: [], model: null,
  contextWindow: 262144, contextUsed: 0, thinkingLevel: "off", autoCompaction: true, showThinking: true, sending: true,
};
for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
  if (!raw.trim()) continue;
  const event = JSON.parse(raw);
  if (event.type === "response" || event.type === "extension_ui_request") continue;
  line = applyEvent(line, event);
  if (["message_end", "compaction_start", "compaction_end", "agent_end"].includes(event.type)) {
    console.log(`${event.type.padEnd(17)} лампа=${line.lamp} сжатие=${line.compacting ? "да" : "нет"} отправка=${line.sending ? "да" : "нет"}`);
  }
}
console.log("\nлента:");
for (const e of line.entries) {
  if (e.kind === "note") console.log(`  [${e.tone}] ${e.text}`);
  if (e.kind === "say") console.log(`  ${e.role}: ${e.text.trim()}`);
}
