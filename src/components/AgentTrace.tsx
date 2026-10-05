import { useMemo, useState, type ReactNode } from "react";
import type { PluginInfo, ToolRun } from "../types.ts";
import { toolCaption } from "../lineReducer.ts";
import { presentTool } from "../toolPresentation.ts";
import { PluginMark } from "./BrandIcon.tsx";
import { ToolIcon } from "./ToolIcon.tsx";

/*
 * Ход работы агента: общая шапка «Работает…» с пиксельным индикатором,
 * под ней — строки действий. Строка показывает иконку (под курсором она
 * сменяется шевроном), название действия и чип с аргументом. По нажатию
 * результат раскрывается под действием.
 *
 * Механика и раскладка взяты из компонента ai-agent-response (21st.dev)
 * один в один; данные — настоящие вызовы инструментов оператора.
 */

/* ── Названия действий по-русски ────────────────────────────────── */

const TITLES: Record<string, string> = {
  bash: "Выполняю",
  read: "Читаю",
  write: "Пишу",
  edit: "Правлю",
  grep: "Ищу в тексте",
  find: "Ищу файлы",
  ls: "Смотрю папку",
  fetch: "Загружаю",
  web_search: "Ищу в сети",
  task_update: "Веду план",
};

function title(name: string): string {
  return TITLES[name] ?? name;
}

/* ── Пиксельный индикатор 3×3 ───────────────────────────────────── */

/** Волна идёт от середины к краям — порядок задержек как в оригинале. */
const DOT_DELAYS = Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3);
  const column = i % 3;
  return (column + Math.abs(row - 1)) * 90;
});

export function PixelDots() {
  return (
    <span className="pixel-dots" aria-hidden>
      {DOT_DELAYS.map((delay, index) => (
        <span key={index} style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

/* ── Разбор правки: единый diff превращаем в строки ─────────────── */

export type DiffRow = { old: number | null; cur: number | null; type: "add" | "del" | "ctx"; text: string };

/** Вывод правки бывает единым diff — тогда показываем его как правку. */
export function parseDiff(output: string): DiffRow[] | null {
  const lines = output.split("\n");
  const head = lines.findIndex((line) => /^@@\s*-\d+(,\d+)?\s*\+\d+(,\d+)?\s*@@/.test(line));
  if (head < 0) return null;

  const rows: DiffRow[] = [];
  let oldNo = 0;
  let curNo = 0;

  for (const line of lines.slice(head)) {
    const marks = line.match(/^@@\s*-(\d+)(?:,\d+)?\s*\+(\d+)(?:,\d+)?\s*@@/);
    if (marks) {
      oldNo = Number(marks[1]);
      curNo = Number(marks[2]);
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) rows.push({ old: null, cur: curNo++, type: "add", text: line.slice(1) });
    else if (line.startsWith("-")) rows.push({ old: oldNo++, cur: null, type: "del", text: line.slice(1) });
    else if (line.startsWith(" ") || line === "")
      rows.push({ old: oldNo++, cur: curNo++, type: "ctx", text: line.slice(1) });
    else break;
  }
  return rows.length > 0 ? rows : null;
}

/* ── Иконки строки: шеврон, ошибка, копирование ─────────────────── */

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`trace-chevron${open ? " trace-chevron-open" : ""}`}
      viewBox="0 0 24 24"
      width="13"
      height="13"
      aria-hidden
    >
      <path
        d="m4.5 15.75 7.5-7.5 7.5 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Alert() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--error)" strokeWidth="1.4" aria-hidden>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 5.2v3.4" strokeLinecap="round" />
      <circle cx="8" cy="10.9" r="0.7" fill="var(--error)" stroke="none" />
    </svg>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="trace-copy"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--ok)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2.4 8.4l2.6 2.6 5-5.6" />
          <path d="M7.4 11l1.2 1.2 5-5.6" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
          <rect x="5.4" y="5.4" width="7.2" height="7.2" rx="1.4" />
          <path d="M3.4 10.6V4.2a.8.8 0 01.8-.8h6.4" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

/* ── Терминал: команда, итог, вывод ─────────────────────────────── */

export function TerminalCard({
  command,
  output,
  failed,
  running,
  durationMs,
}: {
  command: string;
  output: string;
  failed: boolean;
  running: boolean;
  durationMs?: number;
}) {
  return (
    <div className="term">
      <div className="term-head">
        <span className="term-lead">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="2" y="3" width="12" height="10" rx="1.6" />
            <path d="M4.8 6.4l2 1.6-2 1.6M8.4 10.2h3" />
          </svg>
          <span className="term-dollar">$</span>
          <span className="term-command">{command}</span>
        </span>
        <span className="term-tail">
          {durationMs !== undefined && <span className="term-time">{durationMs} мс</span>}
          {running ? (
            <span className="term-badge term-run">
              <span className="term-dot" />
              идёт
            </span>
          ) : (
            <span className={`term-badge ${failed ? "term-bad" : "term-good"}`}>
              {failed ? "ошибка" : "готово"}
            </span>
          )}
          <CopyButton text={output ? `$ ${command}\n\n${output}` : `$ ${command}`} label="Скопировать команду" />
        </span>
      </div>
      {output && (
        <div className="term-body">
          <pre>
            {output.split("\n").map((line, index) => {
              const good = /✓|PASS|passed|успешно/i.test(line);
              const bad = /FAIL|Error|ошибка|failed/i.test(line);
              const warn = /WARN|warning|внимание/i.test(line);
              return (
                <div
                  key={index}
                  className={good ? "term-ok" : bad ? "term-err" : warn ? "term-warn" : undefined}
                >
                  {line}
                </div>
              );
            })}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── Правка файла ───────────────────────────────────────────────── */

export function FileDiff({ file, rows }: { file: string; rows: DiffRow[] }) {
  const added = rows.filter((row) => row.type === "add").length;
  const removed = rows.filter((row) => row.type === "del").length;
  const text = rows
    .map((row) => `${row.type === "add" ? "+" : row.type === "del" ? "-" : " "} ${row.text}`)
    .join("\n");

  return (
    <div className="diff">
      <div className="diff-head">
        <span className="diff-file">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5.6 5.8L3.2 8l2.4 2.2M10.4 5.8L12.8 8l-2.4 2.2M9 4.2l-2 7.6" />
          </svg>
          {file}
        </span>
        <span className="diff-tail">
          {added > 0 && <span className="diff-add">+{added}</span>}
          {removed > 0 && <span className="diff-del">−{removed}</span>}
          <CopyButton text={text} label="Скопировать правку" />
        </span>
      </div>
      <div className="diff-body">
        {rows.map((row, index) => (
          <div key={index} className={`diff-row diff-${row.type}`}>
            <span className="diff-no">{row.old ?? ""}</span>
            <span className="diff-no">{row.cur ?? ""}</span>
            <span className="diff-sign">{row.type === "add" ? "+" : row.type === "del" ? "−" : ""}</span>
            <code>{row.text}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Строка действия ────────────────────────────────────────────── */

function TraceRow({ run, plugin, onSelect, selected, details }: { run: ToolRun; plugin?: PluginInfo; onSelect: (run: ToolRun) => void; selected: boolean; details?: ReactNode }) {
  const caption = toolCaption(run.name, run.args);
  const chip = plugin ? `${plugin.name ?? plugin.id}${caption ? ` · ${caption}` : ""}` : caption;
  const running = !run.done;
  const completed = useMemo(() => run.done ? presentTool(run, plugin).title : "", [run, plugin]);
  const isCommand = run.name === "bash";
  const diff = !isCommand && run.output ? parseDiff(run.output) : null;

  return (
    <div className="trace-item">
      <button
        type="button"
        className={`trace-row trace-openable${selected ? " trace-selected" : ""}`}
        aria-expanded={selected}
        aria-label={`Подробности инструмента ${run.name}`}
        onClick={() => onSelect(run)}
      >
        <span className="trace-glyph">
          {plugin ? (
            <>
              <span className="trace-icon" title={`Плагин ${plugin.name ?? plugin.id}`}>
                <PluginMark icon={plugin.resolvedIcon} name={plugin.icon ?? plugin.id} label={plugin.name ?? plugin.id} size={15} />
              </span>
              <Chevron open={selected} />
            </>
          ) : running ? (
            <PixelDots />
          ) : run.failed ? (
            <Alert />
          ) : (
            <>
              <span className="trace-icon">
                <ToolIcon name={run.name} color="var(--text-muted)" />
              </span>
              <Chevron open={selected} />
            </>
          )}
        </span>

        <span className={`trace-title${plugin ? " trace-plugin-title" : ""}${running ? " trace-working" : ""}`}>
          {running ? plugin ? `Использует ${plugin.name ?? plugin.id}` : title(run.name) : completed}
        </span>
        {plugin && running && <span className="trace-plugin-state"><PixelDots /></span>}
        {plugin && run.failed && <span className="trace-plugin-state"><Alert /></span>}

        {chip && (
          <span
            className={`trace-chip${(isCommand || /read|write|edit|ls/.test(run.name)) ? " trace-mono" : ""}`}
          >
            {chip}
          </span>
        )}

        {diff && (
          <span className="trace-counts">
            {diff.some((row) => row.type === "add") && (
              <span className="diff-add">+{diff.filter((row) => row.type === "add").length}</span>
            )}
            {diff.some((row) => row.type === "del") && (
              <span className="diff-del">−{diff.filter((row) => row.type === "del").length}</span>
            )}
          </span>
        )}
      </button>

      {selected && details && <div className="trace-inline-details">{details}</div>}

    </div>
  );
}

/* ── Ход работы целиком ─────────────────────────────────────────── */

export function AgentTrace({ runs, pluginForTool, onSelectTool, selectedToolId, renderDetails }: { runs: ToolRun[]; pluginForTool: (toolName: string) => PluginInfo | undefined; onSelectTool: (run: ToolRun) => void; selectedToolId: string | null; renderDetails: (run: ToolRun) => ReactNode }) {
  return (
    <div className="trace">
      {runs.map((run) => (
        <TraceRow key={run.id} run={run} plugin={pluginForTool(run.name)} onSelect={onSelectTool} selected={selectedToolId === run.id} details={selectedToolId === run.id ? renderDetails(run) : null} />
      ))}
    </div>
  );
}
