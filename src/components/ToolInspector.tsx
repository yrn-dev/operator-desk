import { useEffect, useMemo, useRef, useState } from "react";
import type { FileInspection, PluginInfo, ToolRun } from "../types.ts";
import { toolCaption } from "../lineReducer.ts";
import { PluginMark } from "./BrandIcon.tsx";
import { ToolIcon } from "./ToolIcon.tsx";
import { FileDiff, parseDiff, TerminalCard, type DiffRow } from "./AgentTrace.tsx";
import { presentTool } from "../toolPresentation.ts";
import { parsePlan, PlanView } from "./TaskPlan.tsx";
import { highlighter } from "../highlight.ts";

const isFileTool = (name: string) => /^(write|edit|patch|write_file|edit_file|patch_file|create_file)$/.test(name.split("__").at(-1) ?? name);

function CodePreview({ code, file }: { code: string; file: string }) {
  const block = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = block.current;
    if (!element || !code) return;
    const extension = file.split(".").at(-1)?.toLowerCase() ?? "";
    void highlighter().then((hljs) => {
      if (!element || !element.isConnected) return;
      try {
        element.innerHTML = hljs.getLanguage(extension)
          ? hljs.highlight(code, { language: extension }).value
          : hljs.highlightAuto(code).value;
      } catch { element.textContent = code; }
    });
  }, [code, file]);
  return <pre className="tool-inspector-code tool-inspector-file-content"><code ref={block}>{code}</code></pre>;
}

function compareText(before: string, after: string): { rows: DiffRow[]; limited: boolean } {
  if (before === after) return { rows: [], limited: false };
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  // Небольшой LCS сохраняет контекст вокруг вставок и замен. Для больших
  // файлов сравниваем изменённые края, не блокируя интерфейс квадратичной работой.
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;
  const oldMid = a.slice(prefix, a.length - suffix);
  const newMid = b.slice(prefix, b.length - suffix);
  const limited = oldMid.length * newMid.length > 250_000;
  const rows: DiffRow[] = [];
  for (let i = 0; i < prefix; i++) rows.push({ old: i + 1, cur: i + 1, type: "ctx", text: a[i] });
  if (limited) {
    oldMid.forEach((text, i) => rows.push({ old: prefix + i + 1, cur: null, type: "del", text }));
    newMid.forEach((text, i) => rows.push({ old: null, cur: prefix + i + 1, type: "add", text }));
  } else {
    const dp = Array.from({ length: oldMid.length + 1 }, () => new Uint16Array(newMid.length + 1));
    for (let i = oldMid.length - 1; i >= 0; i--) {
      for (let j = newMid.length - 1; j >= 0; j--) {
        dp[i][j] = oldMid[i] === newMid[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < oldMid.length || j < newMid.length) {
      if (i < oldMid.length && j < newMid.length && oldMid[i] === newMid[j]) {
        rows.push({ old: prefix + i + 1, cur: prefix + j + 1, type: "ctx", text: oldMid[i] }); i++; j++;
      } else if (j < newMid.length && (i === oldMid.length || dp[i][j + 1] >= dp[i + 1][j])) {
        rows.push({ old: null, cur: prefix + j + 1, type: "add", text: newMid[j++] });
      } else {
        rows.push({ old: prefix + i + 1, cur: null, type: "del", text: oldMid[i++] });
      }
    }
  }
  for (let i = 0; i < suffix; i++) rows.push({
    old: a.length - suffix + i + 1, cur: b.length - suffix + i + 1, type: "ctx", text: a[a.length - suffix + i],
  });
  return { rows, limited };
}

export function ToolInspector({ run, plugin, onClose, revision }: {
  run: ToolRun;
  plugin?: PluginInfo;
  onClose: () => void;
  revision: number;
}) {
  const [inspection, setInspection] = useState<FileInspection | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    setInspection(null);
    if (!isFileTool(run.name)) return;
    setLoading(true);
    void window.operator.toolInspection(run.id).then((value) => { if (alive) setInspection(value); })
      .catch(() => { if (alive) setInspection(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [run.id, run.name, run.done, revision]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fileDiff = useMemo(() => inspection &&
    (inspection.before.text !== null || !inspection.before.exists) &&
    (inspection.after.text !== null || !inspection.after.exists)
    ? compareText(inspection.before.text ?? "", inspection.after.text ?? "") : null, [inspection]);
  const showFileResult = run.done && !run.failed;
  const outputDiff = showFileResult && !inspection && isFileTool(run.name) ? parseDiff(run.output) ?? parseDiff(String(run.args.patch ?? "")) : null;
  const fallbackEdits = showFileResult && !inspection && !outputDiff && Array.isArray(run.args.edits)
    ? run.args.edits.flatMap((edit) => {
      if (!edit || typeof edit !== "object") return [];
      const pair = edit as { oldText?: unknown; newText?: unknown };
      const oldLines = typeof pair.oldText === "string" ? pair.oldText.split("\n") : [];
      const newLines = typeof pair.newText === "string" ? pair.newText.split("\n") : [];
      return [
        ...oldLines.map((text, index): DiffRow => ({ old: index + 1, cur: null, type: "del", text })),
        ...newLines.map((text, index): DiffRow => ({ old: null, cur: index + 1, type: "add", text })),
      ];
    }) : [];
  const presentation = presentTool(run, plugin);
  const fileStatus = run.failed && isFileTool(run.name) ? "Не удалось изменить файл" : inspection?.status === "created" ? "Создал файл" : inspection?.status === "deleted" ? "Удалил файл" : inspection?.status === "modified" ? "Изменил файл" : presentation.title;
  const content = typeof run.args.content === "string" ? run.args.content : typeof run.args.newText === "string" ? run.args.newText : null;
  const plan = /task|todo|plan/i.test(run.name) ? parsePlan(run.output) : null;
  const caption = toolCaption(run.name, run.args);
  const duration = run.startedAt && run.endedAt ? Math.max(1, run.endedAt - run.startedAt) : null;

  return (
    <section className="tool-inspector" aria-label={`Результат инструмента ${run.name}`}>
      <div className="tool-inspector-head">
        <div className="tool-inspector-mark">
          {plugin ? <PluginMark icon={plugin.resolvedIcon} name={plugin.icon ?? plugin.id} label={plugin.name ?? plugin.id} size={18} />
            : <ToolIcon name={run.name} color="var(--text)" />}
        </div>
        <div className="tool-inspector-heading"><strong>{fileStatus}</strong><span>{presentation.subject || (plugin ? plugin.name ?? plugin.id : "Действие Operator")}</span></div>
        <button type="button" className="tool-inspector-close" onClick={onClose} aria-label="Свернуть результат">×</button>
      </div>
      <div className="tool-inspector-meta">
        <span className={run.failed ? "tool-inspector-error" : ""}>{!run.done ? "Выполняется" : run.failed ? "Ошибка" : "Готово"}</span>
        {duration !== null && <span>{duration} мс</span>}
      </div>
      <div className="tool-inspector-scroll">
        {presentation.parameters.length > 0 && <div className="tool-inspector-parameters">
          {presentation.parameters.map(({ label, value }) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </div>}
        {presentation.resultKind === "time" && <div className="tool-inspector-time">
          <strong>{presentation.primary}</strong><span>{presentation.details}</span>
        </div>}
        {presentation.resultKind === "terminal" && <TerminalCard command={String(run.args.command ?? caption)} output={run.output} failed={run.failed} running={!run.done} durationMs={duration ?? undefined} />}
        {presentation.resultKind === "code" && <CodePreview code={run.output} file={presentation.subject ?? ""} />}
        {presentation.resultKind === "file" && <>
          {run.failed && <p className="tool-inspector-note">{run.output || "Инструмент завершился с ошибкой."}</p>}
          {!run.done && <p className="tool-inspector-note">Ожидаю результат записи файла…</p>}
          {showFileResult && <>
            {loading && <p className="tool-inspector-note">Загружаю изменения…</p>}
            {inspection?.status === "created" && inspection.after.text !== null && <CodePreview code={inspection.after.text} file={inspection.file} />}
            {fileDiff && fileDiff.rows.length > 0 && inspection?.status !== "created" && <FileDiff file={inspection?.file ?? caption} rows={fileDiff.rows} />}
            {fileDiff?.limited && <p className="tool-inspector-note">Большой фрагмент показан как удалённый и добавленный блок.</p>}
            {fileDiff && fileDiff.rows.length === 0 && <p className="tool-inspector-note">Содержимое файла не изменилось.</p>}
            {inspection && !fileDiff && <p className="tool-inspector-note">{inspection.before.reason ?? inspection.after.reason ?? "Текстовое сравнение недоступно."}</p>}
            {!inspection && outputDiff && <FileDiff file={caption || "Файл"} rows={outputDiff} />}
            {!inspection && !outputDiff && fallbackEdits.length > 0 && <FileDiff file={caption || "Файл"} rows={fallbackEdits} />}
            {!inspection && !outputDiff && fallbackEdits.length === 0 && content !== null && <CodePreview code={content} file={presentation.subject ?? ""} />}
            {!loading && !inspection && !outputDiff && fallbackEdits.length === 0 && content === null && <p className="tool-inspector-note">Подробное сравнение для этого вызова недоступно.</p>}
          </>}
        </>}
        {presentation.resultKind === "list" && <div className="tool-inspector-list">
          {presentation.items?.map((item, index) => <div key={`${index}-${item}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></div>)}
        </div>}
        {presentation.resultKind === "fields" && <div className="tool-inspector-facts">
          {presentation.fields?.map(({ label, value }) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
          {presentation.details && <p>{presentation.details}</p>}
        </div>}
        {presentation.resultKind === "text" && <p className="tool-inspector-prose">{presentation.details}</p>}
        {presentation.resultKind === "empty" && <p className="tool-inspector-note">{presentation.details}</p>}
        {plan && <div className="trace-plan"><PlanView plan={plan} /></div>}
        {presentation.links && presentation.links.length > 0 && <div className="tool-inspector-links">
          {presentation.links.map((url) => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{url}</a>)}
        </div>}
      </div>
    </section>
  );
}
