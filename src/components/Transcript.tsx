import { useEffect, useRef } from "react";
import type { Entry, Note, Say, ToolRun } from "../types.ts";
import { LinkCards } from "./LinkCards.tsx";
import { Markdown } from "./Markdown.tsx";
import { AttachmentPreview } from "./FileChip.tsx";
import { Logo } from "./Logo.tsx";
import { Thinking } from "./Thinking.tsx";
import { AgentTrace, PixelDots } from "./AgentTrace.tsx";

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

/** Пока лента читается из файла сессии, показываем её очертания. */
function Skeleton() {
  const rows = [
    { width: "38%", align: "flex-end" as const },
    { width: "92%", align: "flex-start" as const },
    { width: "76%", align: "flex-start" as const },
    { width: "54%", align: "flex-end" as const },
    { width: "88%", align: "flex-start" as const },
  ];
  return (
    <div style={{ paddingTop: 8 }}>
      {rows.map((row, index) => (
        <div
          key={index}
          style={{ display: "flex", justifyContent: row.align, marginBottom: 16 }}
        >
          <div
            className="shimmer"
            style={{
              width: row.width,
              height: 14,
              borderRadius: 7,
              animationDelay: `${index * 90}ms`,
            }}
          />
        </div>
      ))}
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
}: {
  entries: Entry[];
  showThinking: boolean;
  cwd: string | undefined;
  loading: boolean;
  sending: boolean;
  compacting: boolean;
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
            <div style={{ color: "var(--text)", opacity: 0.85, marginBottom: 18 }}>
              <Logo size={132} />
            </div>
            <div style={{ fontSize: 15, color: "var(--text-muted)" }}>Чем займёмся?</div>
            {cwd && (
              <div style={{ marginTop: 7, fontSize: 12.5, color: "var(--text-faint)", fontFamily: "var(--mono)" }}>
                {cwd}
              </div>
            )}
          </div>
        )}
        {group(entries).map((item) =>
          Array.isArray(item) ? (
            <AgentTrace key={item[0].id} runs={item} />
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
