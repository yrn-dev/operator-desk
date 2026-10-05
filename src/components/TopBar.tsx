import { useEffect, useRef, useState } from "react";
import type { Job, LineState } from "../types.ts";

const ghost: React.CSSProperties = {
  padding: "5px 9px",
  borderRadius: 6,
  color: "var(--text-muted)",
  fontSize: 12.5,
};

/** Тонкая полоса: боковая панель, папка, контекст, модель, действия. */
export function TopBar({
  line,
  sidebarCollapsed,
  onToggleSidebar,
  onCompact,
  onNewSession,
  jobs,
  mcpCount,
  onOpenMcp,
  onOpenReadiness,
  onOpenUsage,
  subagentCount,
  subagentsOpen,
  onToggleSubagents,
}: {
  line: LineState | undefined;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onCompact: () => void;
  onNewSession: () => void;
  jobs: Job[];
  mcpCount: number;
  onOpenMcp: () => void;
  onOpenReadiness: () => void;
  onOpenUsage: () => void;
  subagentCount: number;
  subagentsOpen: boolean;
  onToggleSubagents: () => void;
}) {
  const [menu, setMenu] = useState<"model" | "more" | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const used = line?.contextUsed ?? 0;
  const total = line?.contextWindow ?? 1;
  const percent = Math.min(100, Math.round((used / total) * 100));
  const short = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n));

  return (
    <header
      ref={box}
      className="drag-strip"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 44,
        padding: "0 10px 0 8px",
        borderBottom: "1px solid var(--line)",
        position: "relative",
        zIndex: 10,
      }}
    >
      <button
        onClick={onToggleSidebar}
        className="control control-ghost"
        style={{ padding: 0, width: "var(--control-height)", justifyContent: "center" }}
        title={sidebarCollapsed ? "Показать список сессий" : "Скрыть список сессий"}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M6 3v10"
            stroke="currentColor"
            strokeWidth="1.3"
            style={{
              opacity: sidebarCollapsed ? 0.35 : 1,
              transition: "opacity var(--normal) var(--ease)",
            }}
          />
        </svg>
      </button>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          minWidth: 0,
          paddingLeft: 2,
        }}
        title={line ? `${line.label}\n${line.cwd}` : undefined}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {line ? line.label : "нет сессии"}
        </span>
        {line && (
          <span
            style={{
              flex: "none",
              fontSize: 12,
              fontFamily: "var(--mono)",
              color: "var(--text-faint)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {shortPath(line.cwd)}
          </span>
        )}
      </div>

      {line?.lamp === "live" && (
        <span style={{ fontSize: 12.5, color: "var(--ok)", flex: "none" }}>работает</span>
      )}

      <div style={{ flex: 1 }} />

      {subagentCount > 0 && (
        <button className={`control control-ghost subagent-toggle${subagentsOpen ? " is-active" : ""}`} onClick={onToggleSubagents}
          aria-pressed={subagentsOpen} title="Показать субагентов">
          <span className="subagent-toggle-dots" aria-hidden><i /><i /><i /></span>
          Субагенты <span className="subagent-toggle-count">{subagentCount}</span>
        </button>
      )}

      {jobs.some((job) => job.alive) && (
        <span
          title={jobs.filter((job) => job.alive).map((job) => job.name).join("\n")}
          style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--ok)" }}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
            <circle cx="6" cy="6" r="4.6" stroke="currentColor" strokeWidth="1.3" opacity="0.35" />
            <path d="M6 1.4a4.6 4.6 0 014.6 4.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <animateTransform attributeName="transform" type="rotate" from="0 6 6" to="360 6 6" dur="1s" repeatCount="indefinite" />
            </path>
          </svg>
          {jobs.filter((job) => job.alive).length} в фоне
        </span>
      )}

      {line && (used > 0 || line.compacting) && (
        // Счётчик контекста — он же кнопка сжатия: не нужно искать её в меню.
        <button
          onClick={onCompact}
          disabled={line.compacting || line.lamp !== "ready"}
          className="control control-ghost"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: percent > 80 ? "var(--warn)" : "var(--text-faint)",
          }}
          title={
            line.compacting
              ? "Контекст сжимается"
              : `Контекст: ${used} из ${total} токенов (${percent}%)\nНажмите, чтобы сжать`
          }
        >
          <ContextRing percent={percent} />
          {line.compacting ? "сжимаю…" : `${short(used)} / ${short(total)}`}
        </button>
      )}

      <div style={{ position: "relative" }}>
        <button
          onClick={() => setMenu(menu === "more" ? null : "more")}
          disabled={!line}
          style={{ ...ghost, padding: "5px 7px" }}
          title="Ещё"
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden>
            <circle cx="3" cy="7.5" r="1.3" />
            <circle cx="7.5" cy="7.5" r="1.3" />
            <circle cx="12" cy="7.5" r="1.3" />
          </svg>
        </button>
        {menu === "more" && (
          <Menu>
            <MenuItem
              onClick={() => {
                onNewSession();
                setMenu(null);
              }}
            >
              Очистить и начать заново
            </MenuItem>
            <MenuItem
              onClick={() => {
                onCompact();
                setMenu(null);
              }}
            >
              Сжать контекст
            </MenuItem>
            <MenuItem
              onClick={() => {
                onOpenMcp();
                setMenu(null);
              }}
            >
              Плагины{mcpCount > 0 ? ` · ${mcpCount}` : ""}
            </MenuItem>
            <MenuItem
              onClick={() => {
                onOpenReadiness();
                setMenu(null);
              }}
            >
              Готовность
            </MenuItem>
            <MenuItem
              onClick={() => {
                onOpenUsage();
                setMenu(null);
              }}
            >
              Статистика использования
            </MenuItem>
          </Menu>
        )}
      </div>
    </header>
  );
}

/** Кольцо заполнения контекста: тонкая дуга вместо ещё одной строки цифр. */
function ContextRing({ percent }: { percent: number }) {
  const r = 5.2;
  const circumference = 2 * Math.PI * r;
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flex: "none" }} aria-hidden>
      <circle cx="6.5" cy="6.5" r={r} stroke="var(--line)" strokeWidth="1.6" />
      <circle
        cx="6.5"
        cy="6.5"
        r={r}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - percent / 100)}
        transform="rotate(-90 6.5 6.5)"
        style={{ transition: "stroke-dashoffset var(--normal) var(--ease)" }}
      />
    </svg>
  );
}

function Menu({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="popover"
      style={{
        position: "absolute",
        right: 0,
        top: "calc(100% + 6px)",
        minWidth: 230,
        maxHeight: 360,
        overflowY: "auto",
        padding: 4,
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--line)",
        background: "var(--bg-raised)",
        boxShadow: "0 12px 32px rgba(0,0,0,.5)",
      }}
    >
      {children}
    </div>
  );
}

function MenuItem({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "7px 9px",
        borderRadius: 6,
        fontSize: 13,
        textAlign: "left",
        color: selected ? "var(--text)" : "var(--text-muted)",
        background: selected ? "var(--bg-active)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

/** ~/… и не более трёх последних сегментов пути. */
function shortPath(cwd: string): string {
  const home = cwd.match(/^(\/home\/[^/]+|\/Users\/[^/]+|[A-Z]:\\Users\\[^\\]+)/)?.[0];
  const shown = home ? `~${cwd.slice(home.length)}` : cwd;
  const parts = shown.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return shown;
  return `…/${parts.slice(-3).join("/")}`;
}
