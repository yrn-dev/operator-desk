import { useMemo, useState } from "react";
import type { LineState, SessionSummary } from "../types.ts";
import { ContextMenu, menuIcons, type MenuAction } from "./ContextMenu.tsx";
import { BrandIcon } from "./BrandIcon.tsx";

/** Группирует историю по дням: сегодня, вчера, «11 сентября», старое — по годам. */
function groupByDate(sessions: SessionSummary[]): Array<[string, SessionSummary[]]> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;

  const groups = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const date = new Date(session.updatedAt);
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const distance = Math.round((today - start) / day);

    let label: string;
    if (distance <= 0) label = "Сегодня";
    else if (distance === 1) label = "Вчера";
    else if (distance < 7) label = "На этой неделе";
    else if (date.getFullYear() === now.getFullYear()) {
      label = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    } else {
      label = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
    }

    const bucket = groups.get(label);
    if (bucket) bucket.push(session);
    else groups.set(label, [session]);
  }
  return [...groups.entries()];
}

/** Знак сессии: по нему видно, где диалог начали — в окне или в терминале. */
function SessionMark({ origin, active }: { origin: "desk" | "cli"; active: boolean }) {
  return (
    <span className="session-mark" data-active={active || undefined}>
      {origin === "cli" ? (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-label="начат в терминале">
          <path d="M4.4 6l2 2-2 2M8.4 10.4h3.2" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-label="начат в приложении">
          <rect x="2.4" y="3.2" width="11.2" height="9.6" rx="1.6" />
          <path d="M2.4 6.2h11.2" />
        </svg>
      )}
    </span>
  );
}

function shortCwd(cwd: string): string {
  if (/^(\/home\/[^/]+|\/Users\/[^/]+)$/.test(cwd)) return "~";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

const rowBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "5px 9px",
  marginBottom: 1,
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};

/** Файл сессии, лента которой сейчас открыта. */
function activeFile(lines: Map<string, LineState>, activeId: string | null): string | null {
  return (activeId && lines.get(activeId)?.sessionFile) || null;
}

export function Sidebar({
  lines,
  order,
  activeId,
  collapsed,
  history,
  historyBusy,
  onNew,
  onOpenFolder,
  onOpenPlugins,
  pluginCount,
  onClose,
  onOpenHistory,
  onRename,
  onDelete,
  onExport,
  onCopied,
}: {
  lines: Map<string, LineState>;
  order: string[];
  activeId: string | null;
  collapsed: boolean;
  history: SessionSummary[];
  historyBusy: boolean;
  onNew: () => void;
  onOpenFolder: () => void;
  onOpenPlugins: () => void;
  pluginCount: number;
  onClose: (id: string) => void;
  onOpenHistory: (session: SessionSummary) => void;
  onRename: (session: SessionSummary, name: string) => void;
  onDelete: (session: SessionSummary) => void;
  onExport: (session: SessionSummary, format: "html" | "json") => void;
  onCopied?: (message: string) => void;
}) {
  const grouped = useMemo(() => groupByDate(history), [history]);
  const current = activeFile(lines, activeId);
  const busyFiles = useMemo(
    () =>
      new Set(
        order
          .map((id) => lines.get(id))
          .filter((line) => line?.lamp === "live")
          .map((line) => line!.sessionFile)
          .filter(Boolean) as string[],
      ),
    [order, lines],
  );
  const openFiles = useMemo(
    () => new Set(order.map((id) => lines.get(id)?.sessionFile).filter(Boolean) as string[]),
    [order, lines],
  );
  const [menu, setMenu] = useState<{ x: number; y: number; session: SessionSummary } | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null);

  const actionsFor = (session: SessionSummary): MenuAction[] => [
    {
      label: "Переименовать",
      icon: menuIcons.rename,
      onSelect: () => setRenaming({ path: session.path, value: session.title }),
    },
    {
      label: "Сохранить как HTML",
      icon: menuIcons.html,
      onSelect: () => onExport(session, "html"),
    },
    {
      label: "Сохранить как JSON",
      icon: menuIcons.json,
      onSelect: () => onExport(session, "json"),
    },
    {
      label: "Продолжить в терминале",
      icon: menuIcons.terminal,
      onSelect: () => {
        // Готовая команда: вставить в терминал и продолжить тот же диалог.
        navigator.clipboard.writeText(`opr --session "${session.path}"`);
        onCopied?.("Команда скопирована — вставьте её в терминал");
      },
    },
    {
      label: "Показать файл",
      icon: menuIcons.folder,
      onSelect: () => window.operator.reveal(session.path),
    },
    ...(openFiles.has(session.path)
      ? [
          {
            label: "Закрыть",
            icon: menuIcons.close,
            onSelect: () => {
              const id = order.find((item) => lines.get(item)?.sessionFile === session.path);
              if (id) onClose(id);
            },
          },
        ]
      : []),
    {
      label: "Удалить",
      icon: menuIcons.trash,
      danger: true,
      onSelect: () => onDelete(session),
    },
  ];

  return (
    <aside
      className="panel"
      aria-hidden={collapsed}
      style={{
        width: collapsed ? 0 : 300,
        flex: "none",
        overflow: "hidden",
        borderRight: `1px solid ${collapsed ? "transparent" : "var(--line)"}`,
        background: "var(--bg)",
        transition: "width var(--normal) var(--ease), border-color var(--normal) var(--ease)",
      }}
    >
      <div
        style={{
          width: 300,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          opacity: collapsed ? 0 : 1,
          transform: collapsed ? "translateX(-12px)" : "none",
          transition: "opacity var(--fast) var(--ease), transform var(--normal) var(--ease)",
        }}
      >
      {/* Кнопки окна macOS лежат в левом верхнем углу — освобождаем им полосу. */}
      {window.operator.platform === "darwin" && (
        <div className="drag-strip" style={{ height: 28, flex: "none" }} />
      )}
      <div className="drag-strip" style={{ display: "flex", gap: 6, padding: "10px 10px 6px 8px" }}>
        <button
          onClick={onNew}
          className="control"
          title="Начать новый диалог в текущей папке"
          style={{ flex: 1, color: "var(--text)" }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
            <path d="M7 2.6v8.8M2.6 7h8.8" />
          </svg>
          Новый диалог
        </button>
        <button
          onClick={onOpenFolder}
          className="control"
          title="Открыть другую папку"
          style={{ padding: 0, width: "var(--control-height)", justifyContent: "center", flex: "none" }}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
            <path d="M2.4 4.4a1 1 0 011-1h2.8l1.4 1.6h4.9a1 1 0 011 1v5.6a1 1 0 01-1 1h-9.1a1 1 0 01-1-1V4.4z" />
          </svg>
        </button>
      </div>

      <button
        onClick={onOpenPlugins}
        className="row"
        title="Плагины: браузер, базы, документация"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          margin: "2px 10px 6px 8px",
          padding: "7px 9px",
          borderRadius: 8,
          fontSize: 13,
          color: "var(--text-muted)",
          textAlign: "left",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <BrandIcon name="mcp" size={15} muted />
        <span style={{ flex: 1 }}>Плагины</span>
        {pluginCount > 0 && (
          <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{pluginCount}</span>
        )}
      </button>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 12px 6px" }}>
        {historyBusy && history.length === 0 && (
          <div style={{ padding: "14px 9px", fontSize: 12.5, color: "var(--text-faint)" }}>
            читаю историю…
          </div>
        )}

        {grouped.map(([label, sessions]) => (
          <div key={label} style={{ marginTop: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "0 9px 6px",
              }}
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="var(--text-faint)" strokeWidth="1.2" strokeLinecap="round" aria-hidden>
                <circle cx="6" cy="6" r="4.4" />
                <path d="M6 3.6V6l1.7 1.1" />
              </svg>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                {label}
              </span>
              <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{sessions.length}</span>
            </div>
            {sessions.map((session) => (
              <div
                key={session.path}
                className="row"
                data-active={session.path === current || undefined}
                onClick={() => renaming?.path !== session.path && onOpenHistory(session)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, session });
                }}
                title={`${session.title}\n${session.cwd}`}
                style={{
                  ...rowBase,
                  alignItems: "flex-start",
                  gap: 9,
                  lineHeight: 1.45,
                  paddingLeft: 9,
                  borderLeft: `2px solid ${session.path === current ? "var(--text)" : "transparent"}`,
                  borderBottom: "1px solid var(--line-soft)",
                  background: session.path === current ? "var(--bg-active)" : "transparent",
                  color: "var(--text)",
                }}
                onMouseEnter={(e) => {
                  if (session.path !== current) e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (session.path !== current) e.currentTarget.style.background = "transparent";
                }}
              >
                <SessionMark origin={session.origin} active={session.path === current} />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                {renaming?.path === session.path ? (
                  <input
                    autoFocus
                    value={renaming.value}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenaming({ path: session.path, value: e.target.value })}
                    onBlur={() => setRenaming(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const name = renaming.value.trim();
                        if (name && name !== session.title) onRename(session, name);
                        setRenaming(null);
                      }
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    style={{
                      width: "100%",
                      padding: "1px 5px",
                      borderRadius: 4,
                      border: "1px solid var(--accent)",
                      background: "var(--bg-inset)",
                      color: "var(--text)",
                      fontSize: 13,
                      outline: "none",
                    }}
                  />
                ) : (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      overflow: "hidden",
                      color: session.path === current ? "#ffffff" : "var(--text)",
                      fontWeight: session.path === current ? 600 : 400,
                    }}
                  >
                    {openFiles.has(session.path) && (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          flex: "none",
                          borderRadius: "50%",
                          background: busyFiles.has(session.path) ? "var(--ok)" : "var(--text-faint)",
                          boxShadow: busyFiles.has(session.path)
                            ? "0 0 6px rgba(111,169,138,.5)"
                            : "none",
                        }}
                      />
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {session.title}
                    </span>
                  </span>
                )}
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontFamily: "var(--mono)",
                      color: "var(--text-faint)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {shortCwd(session.cwd)}
                  </span>
                  <span
                    style={{
                      flex: "none",
                      color: session.path === current ? "var(--text-muted)" : "var(--text-faint)",
                    }}
                  >
                    {new Date(session.updatedAt).toLocaleTimeString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          actions={actionsFor(menu.session)}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}
