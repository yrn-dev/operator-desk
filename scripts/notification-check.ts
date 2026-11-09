import assert from "node:assert/strict";
import { NotificationEvents, asksForInput } from "../src/notificationEvents.ts";

const end = (text: string, stopReason = "stop") => ({ type: "message_end", message: { role: "assistant", stopReason, content: [{ type: "text", text }] } });
const tracker = new NotificationEvents();
assert.equal(tracker.event("restored", end("Old response")), null);
assert.equal(tracker.event("restored", { type: "agent_end" }), null);
tracker.event("a", { type: "agent_start" });
tracker.event("a", end("Reading a file", "toolUse"));
assert.equal(tracker.event("a", { type: "tool_execution_end" }), null);
tracker.event("a", end("Готово, проверка прошла."));
assert.equal(tracker.event("a", { type: "agent_end", willRetry: false }), "complete");
assert.equal(tracker.event("a", { type: "agent_end", willRetry: false }), null);
tracker.event("b", { type: "agent_start" });tracker.event("b", end("Какой файл выбрать?"));
assert.equal(tracker.event("b", { type: "agent_end" }), "attention");
for (const reason of ["error", "aborted", "length", "toolUse"]) {
  tracker.event("c", { type: "agent_start" });tracker.event("c", end("unfinished", reason));
  assert.equal(tracker.event("c", { type: "agent_end", willRetry: false }), null);
}
tracker.event("d", { type: "agent_start" });tracker.event("d", end("partial"));
assert.equal(tracker.event("d", { type: "agent_end", willRetry: true }), null);
tracker.event("d", { type: "agent_start" });tracker.event("d", end("Final verified result"));
assert.equal(tracker.event("d", { type: "agent_end" }), "complete");
tracker.event("cancelled", { type: "agent_start" });tracker.event("cancelled", end("Late success"));tracker.cancel("cancelled");
assert.equal(tracker.event("cancelled", { type: "agent_end" }), null);
assert.equal(tracker.question("p", "q1"), "attention");assert.equal(tracker.question("p", "q1"), null);
tracker.close("p");assert.equal(tracker.question("p", "q1"), "attention");
for (const text of ["Какой вариант выбрать?", "Уточните путь к файлу.", "Пожалуйста, подтверди отправку.", "Please choose a folder.", "Готово.\n\nПродолжить?"]) assert.equal(asksForInput(text), true, text);
for (const text of ["Файл готов.", "Ссылка: https://example.com/?x=1", "Пример:\n```js\nconst a = ok ? 1 : 2;\n```", "> Как дела?", "| Вопрос? | Ответ |", "Вопрос?\n\nОтвет уже получен."]) assert.equal(asksForInput(text), false, text);
console.log("PASS notification routing: final completion/question, permission deduplication, retry, cancel, failures and restored history");
