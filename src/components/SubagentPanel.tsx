import { ArrowLeft, Check, CircleAlert, Layers3, X } from "lucide-react";
import type { SubagentDetails, SubagentStep, ToolRun } from "../types.ts";
import { Markdown } from "./Markdown.tsx";

function detailsOf(run: ToolRun): SubagentDetails {
  const value = run.details && typeof run.details === "object" ? run.details as Partial<SubagentDetails> : {};
  const args = run.args ?? {};
  return {
    task: typeof value.task === "string" ? value.task : String(args.task ?? "Подзадача"),
    label: typeof value.label === "string" ? value.label : String(args.label ?? ""),
    cwd: typeof value.cwd === "string" ? value.cwd : String(args.cwd ?? ""),
    readOnly: typeof value.readOnly === "boolean" ? value.readOnly : args.readOnly !== false,
    steps: Array.isArray(value.steps) ? value.steps : [],
  };
}

const ACTIONS: Record<string, string> = {
  read: "Читает файл", read_full: "Читает файл", grep: "Ищет в тексте",
  find: "Ищет файлы", ls: "Смотрит папку", bash: "Выполняет команду",
  write: "Создаёт файл", edit: "Правит файл", patch: "Применяет правку",
  web_search: "Ищет в сети", fetch: "Открывает страницу",
};

function action(step: SubagentStep) {
  return ACTIONS[step.name] ?? step.name.replaceAll("_", " ");
}

function label(run: ToolRun, index: number) {
  const info = detailsOf(run);
  return info.label.trim() || info.task.split(/[.!?\n]/)[0].trim().slice(0, 48) || `Субагент ${index + 1}`;
}

function status(run: ToolRun) {
  if (!run.done) return "Работает";
  return run.failed ? "Ошибка" : "Готово";
}

export function SubagentPanel({ runs, selectedId, onSelect, onClose }: {
  runs: ToolRun[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const selected = runs.find((run) => run.id === selectedId);
  const current = selected ? detailsOf(selected) : null;
  const running = runs.filter((run) => !run.done).length;

  return (
    <aside className="subagent-panel" aria-label="Субагенты">
      <div className="subagent-head">
        {selected ? (
          <button className="subagent-icon-button" onClick={() => onSelect(null)} aria-label="К списку субагентов"><ArrowLeft size={16} /></button>
        ) : <Layers3 size={16} aria-hidden />}
        <div className="subagent-heading">
          <strong>{selected ? label(selected, runs.indexOf(selected)) : "Субагенты"}</strong>
          <span>{selected ? status(selected) : running ? `${running} работают · ${runs.length} всего` : `${runs.length} всего`}</span>
        </div>
        <button className="subagent-icon-button" onClick={onClose} aria-label="Скрыть панель субагентов"><X size={16} /></button>
      </div>

      {selected && current ? (
        <div className="subagent-scroll" key={selected.id}>
          <div className="subagent-section-label">Задача</div>
          <p className="subagent-task">{current.task}</p>
          <div className="subagent-facts">
            <span>{current.readOnly ? "Только чтение" : "Может изменять файлы"}</span>
            {current.cwd && <span title={current.cwd}>{current.cwd}</span>}
          </div>

          <div className="subagent-section-label">Ход работы · {current.steps.length}</div>
          {current.steps.length ? (
            <ol className="subagent-steps">
              {current.steps.map((step, index) => (
                <li className="subagent-step" key={`${step.id}-${index}`}>
                  <span className={`subagent-step-mark ${step.failed ? "is-error" : step.done ? "is-done" : "is-running"}`}>
                    {step.failed ? <CircleAlert size={13} /> : step.done ? <Check size={13} /> : <span className="subagent-pulse" />}
                  </span>
                  <div className="subagent-step-body">
                    <strong>{action(step)}</strong>
                    {step.subject && <code title={step.subject}>{step.subject}</code>}
                    {step.failed && step.summary && <p>{step.summary}</p>}
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="subagent-muted">{selected.done ? "Подробные действия для этой сессии не сохранены." : "Начинает работу…"}</p>}

          {selected.done && (
            <div className="subagent-result">
              <div className="subagent-section-label">Результат</div>
              {selected.output.trim() ? <Markdown text={selected.output} /> : <p className="subagent-muted">Ответа нет.</p>}
            </div>
          )}
        </div>
      ) : (
        <div className="subagent-scroll">
          <p className="subagent-intro">Operator поручил этим агентам отдельные части задачи.</p>
          <div className="subagent-list">
            {runs.map((run, index) => {
              const info = detailsOf(run);
              const last = info.steps.at(-1);
              return (
                <button key={run.id} className="subagent-card" onClick={() => onSelect(run.id)}>
                  <span className={`subagent-card-status ${run.failed ? "is-error" : run.done ? "is-done" : "is-running"}`} aria-hidden />
                  <span className="subagent-card-copy">
                    <strong>{label(run, index)}</strong>
                    <span className="subagent-card-task">{info.task}</span>
                    <span className="subagent-card-meta">{info.readOnly ? "Только чтение" : "Работа с файлами"} · {status(run)}</span>
                    {last && !run.done && <span className="subagent-card-activity">{action(last)}{last.subject ? ` · ${last.subject}` : ""}</span>}
                  </span>
                  <span className="subagent-card-arrow" aria-hidden>›</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
