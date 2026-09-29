/**
 * Сквозная проверка: поднимаем линию, задаём вопрос, собираем ленту
 * тем же редьюсером, что и приложение. Запуск: npm run smoke
 */
import { OperatorLine } from "../electron/rpc.ts";
import { applyEvent, speak } from "../src/lineReducer.ts";
import type { LineState } from "../src/types.ts";

const QUESTION = "Выполни в bash `echo связь-есть` и покажи вывод. Больше ничего не делай.";

let state: LineState = {
  id: "smoke",
  label: "smoke",
  cwd: process.cwd(),
  lamp: "ready",
  entries: [],
  model: null,
  contextWindow: 262144,
  contextUsed: 0,
  thinkingLevel: "off",
  autoCompaction: true,
  showThinking: true,
};

const line = new OperatorLine("smoke", { cwd: process.cwd() });
line.on("event", (event) => {
  state = applyEvent(state, event);
});
line.on("fatal", (message: string) => {
  console.error("сбой:", message);
  process.exit(1);
});

line.start();

const idle = new Promise<void>((resolve) => {
  line.on("event", (event: { type: string }) => {
    if (event.type === "agent_end") resolve();
  });
});

const state0 = await line.send<any>("get_state");
console.log(`модель: ${state0?.model?.provider}/${state0?.model?.id}`);
state = { ...state, model: state0.model, contextWindow: state0.model?.contextWindow ?? state.contextWindow };

state = speak(state, QUESTION);
await line.send("prompt", { message: QUESTION });

const timeout = new Promise<void>((_, reject) =>
  setTimeout(() => reject(new Error("нет ответа за 120 с")), 120_000),
);
await Promise.race([idle, timeout]);

console.log("\n── лента ──");
for (const entry of state.entries) {
  if (entry.kind === "say") {
    console.log(`[${entry.role}] ${entry.text.trim().slice(0, 200) || "(пусто)"}`);
  } else if (entry.kind === "tool") {
    const status = entry.failed ? "сбой" : entry.done ? "готово" : "идёт";
    console.log(`[инструмент ${entry.name} · ${status}] ${entry.output.trim().slice(0, 120)}`);
  } else {
    console.log(`[заметка] ${entry.text}`);
  }
}

const ranBash = state.entries.some((e) => e.kind === "tool" && e.name === "bash" && e.done);
const answered = state.entries.some((e) => e.kind === "say" && e.role === "operator" && e.text.trim());
console.log(`\nконтекст: ${state.contextUsed} токенов · лампа: ${state.lamp}`);
console.log(`bash отработал: ${ranBash ? "да" : "нет"} · ответ получен: ${answered ? "да" : "нет"}`);

line.stop();
process.exit(ranBash && answered ? 0 : 1);
