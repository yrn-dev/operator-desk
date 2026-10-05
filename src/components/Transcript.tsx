import { useEffect, useRef } from "react";
import type { Entry, Note, PluginInfo, Say, ToolRun } from "../types.ts";
import { LinkCards } from "./LinkCards.tsx";
import { Markdown } from "./Markdown.tsx";
import { AttachmentPreview } from "./FileChip.tsx";
import { Logo } from "./Logo.tsx";
import { Thinking } from "./Thinking.tsx";
import { AgentTrace, PixelDots } from "./AgentTrace.tsx";
import { ToolInspector } from "./ToolInspector.tsx";

function UserTurn({ entry }: { entry: Say }) {
  return (
    <div className="enter" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 22 }}>
      <div
        style={{
          maxWidth: "82%",
          padding: "9px 13px",
          borderRadius: 14,
          background: "var(--user-bg)",
          border: "1px solid var(--line)",
          fontSize: 14,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
        }}
      >
        {entry.attachments && entry.attachments.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: entry.text.trim() ? 9 : 0,
            }}
          >
            {entry.attachments.map((item) => (
              <AttachmentPreview key={item.path} item={item} />
            ))}
          </div>
        )}
        {entry.text.trim()}
      </div>
    </div>
  );
}

function AgentTurn({ entry, showThinking }: { entry: Say; showThinking: boolean }) {
  const text = entry.text.trim();
  if (!text && !(showThinking && entry.thinking.trim())) return null;
  return (
    <div className="enter" style={{ marginBottom: 22 }}>
      {showThinking && <Thinking text={entry.thinking} live={entry.streaming && !text} />}
      {text && (
        <>
          <Markdown text={text} />
          {entry.streaming ? <span className="caret" /> : <LinkCards text={text} />}
        </>
      )}
    </div>
  );
}

/** Инструменты, вызванные подряд, показываются одним ходом работы. */
function group(entries: Entry[]): Array<Say | Note | ToolRun[]> {
  const out: Array<Say | Note | ToolRun[]> = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (entry.kind === "tool") {
      if (Array.isArray(last)) last.push(entry);
      else out.push([entry]);
      continue;
    }
    out.push(entry);
  }
  return out;
}

function renderEntry(entry: Say | Note, showThinking: boolean) {
  if (entry.kind === "say") {
    return entry.role === "user" ? (
      <UserTurn key={entry.id} entry={entry} />
    ) : (
      <AgentTurn key={entry.id} entry={entry} showThinking={showThinking} />
    );
  }
  return (
    <div
      key={entry.id}
      style={{
        marginBottom: 14,
        padding: "9px 12px",
        borderRadius: "var(--radius)",
        border: "1px solid var(--line)",
        fontSize: 13,
        color: entry.tone === "alarm" ? "var(--error)" : "var(--text-muted)",
      }}
    >
      {entry.text}
    </div>
  );
}

/** Очертания переписки, пока десктоп восстанавливает сохранённую сессию. */
function Skeleton() {
  return (
    <div className="session-loading" role="status" aria-live="polite">
      <div className="session-loading-head">
        <PixelDots />
        <div>
          <strong>Открываю диалог</strong>
          <span>Загружаю сообщения и действия</span>
        </div>
      </div>
      <div className="session-loading-track" aria-hidden><span /></div>
      <div className="session-loading-preview" aria-hidden>
        <div className="session-loading-user">
          <span className="session-loading-bar" style={{ width: "70%" }} />
          <span className="session-loading-bar" style={{ width: "42%" }} />
        </div>
        <div className="session-loading-reply">
          <span className="session-loading-bar" style={{ width: "92%" }} />
          <span className="session-loading-bar" style={{ width: "75%" }} />
          <span className="session-loading-bar" style={{ width: "84%" }} />
        </div>
        <div className="session-loading-tool">
          <span className="session-loading-bar session-loading-square" />
          <span className="session-loading-bar" style={{ width: "38%" }} />
        </div>
        <div className="session-loading-reply">
          <span className="session-loading-bar" style={{ width: "68%" }} />
          <span className="session-loading-bar" style={{ width: "48%" }} />
        </div>
      </div>
    </div>
  );
}

export function Transcript({
  entries,
  showThinking,
  cwd,
  loading,
  sending,
  compacting,
  pluginForTool,
  onSelectTool,
  selectedToolId,
  inspectionRevision,
  onCloseTool,
}: {
  entries: Entry[];
  showThinking: boolean;
  cwd: string | undefined;
  loading: boolean;
  sending: boolean;
  compacting: boolean;
  pluginForTool: (toolName: string) => PluginInfo | undefined;
  onSelectTool: (run: ToolRun) => void;
  selectedToolId: string | null;
  inspectionRevision: number;
  onCloseTool: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  return (
    <div ref={scroller} onScroll={onScroll} style={{ flex: 1, overflowY: "auto" }}>
      <div className="feed" style={{ maxWidth: "var(--measure)", margin: "0 auto", padding: "26px 24px 22px" }}>
        {loading && entries.length === 0 && <Skeleton />}

        {!loading && entries.length === 0 && (
          <div
            className="hello"
            style={{
              marginTop: "18vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <Logo size={360} />
            </div>
            <div className="hello-heading">Чем займёмся?</div>
            {cwd && (
              <div style={{ marginTop: 7, fontSize: 12.5, color: "var(--text-faint)", fontFamily: "var(--mono)" }}>
                {cwd}
              </div>
            )}
          </div>
        )}
        {group(entries).map((item) =>
          Array.isArray(item) ? (
            <AgentTrace key={item[0].id} runs={item} pluginForTool={pluginForTool} onSelectTool={onSelectTool} selectedToolId={selectedToolId}
              renderDetails={(run) => <ToolInspector run={run} plugin={pluginForTool(run.name)} revision={inspectionRevision} onClose={onCloseTool} />} />
          ) : (
            renderEntry(item, showThinking)
          ),
        )}
        {/* Тем же языком, что «Думает…» и идущие действия: волна точек и блик. */}
        {(sending || compacting) && (
          <div className="sending" role="status" aria-live="polite">
            <PixelDots />
            <span className="sending-label">{compacting ? "Сжимаю контекст" : "Отправляется"}</span>
          </div>
        )}
      </div>
    </div>
  );
}
