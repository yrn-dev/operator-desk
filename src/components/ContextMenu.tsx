import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MenuAction = {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  onSelect: () => void;
};

/** Меню по правому клику: всплывает у курсора и закрывается по клику вне. */
export function ContextMenu({
  x,
  y,
  actions,
  onClose,
}: {
  x: number;
  y: number;
  actions: MenuAction[];
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Меряем меню у левого края, где ему ничто не мешает развернуться на всю
  // ширину: если сразу поставить его у курсора, окно сожмёт блок и обрежет
  // подписи, а измеренная ширина окажется неверной.
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const close = () => onClose();
    const escape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [onClose]);

  // Меню не должно уезжать за край окна.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const gap = 8;
    // У правого края раскрываем влево от курсора, а не прижимаем к стенке.
    const left = x + width + gap > window.innerWidth ? x - width : x;
    const top = y + height + gap > window.innerHeight ? y - height : y;
    setPosition({
      left: Math.max(gap, Math.min(left, window.innerWidth - width - gap)),
      top: Math.max(gap, Math.min(top, window.innerHeight - height - gap)),
    });
  }, [x, y, actions.length]);

  // Меню живёт в корне страницы: внутри панели его обрезали бы её границы.
  return createPortal(
    <div
      ref={box}
      onMouseDown={(e) => e.stopPropagation()}
      className="popover"
      style={{
        position: "fixed",
        left: position ? position.left : 0,
        top: position ? position.top : 0,
        visibility: position ? "visible" : "hidden",
        zIndex: 100,
        minWidth: 190,
        maxWidth: "min(320px, calc(100vw - 16px))",
        padding: 4,
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--line)",
        background: "var(--bg-raised)",
        boxShadow: "0 14px 34px rgba(0,0,0,.55)",
      }}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={() => {
            action.onSelect();
            onClose();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            width: "100%",
            padding: "7px 9px",
            borderRadius: 6,
            fontSize: 13,
            textAlign: "left",
            whiteSpace: "nowrap",
            color: action.danger ? "var(--error)" : "var(--text-muted)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            if (!action.danger) e.currentTarget.style.color = "var(--text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            if (!action.danger) e.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          <span style={{ display: "flex", flex: "none" }}>{action.icon}</span>
          {action.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** Иконки пунктов меню — тот же штрих, что и у остальных. */
export const menuIcons = {
  rename: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.8 3.1l2.1 2.1-6.6 6.6-2.8.7.7-2.8 6.6-6.6z" />
    </svg>
  ),
  html: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 2.8h4.6L12 6.2v7a1 1 0 01-1 1H4a1 1 0 01-1-1v-9.4a1 1 0 011-1z" />
      <path d="M8.4 2.9v3.4H12" />
      <path d="M5.6 9.4l-1 1.2 1 1.2M9.4 9.4l1 1.2-1 1.2" />
    </svg>
  ),
  json: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6.4 2.8c-1.4 0-2 .7-2 2v1.6c0 .9-.5 1.6-1.4 1.6.9 0 1.4.7 1.4 1.6v1.6c0 1.3.6 2 2 2" />
      <path d="M9.6 2.8c1.4 0 2 .7 2 2v1.6c0 .9.5 1.6 1.4 1.6-.9 0-1.4.7-1.4 1.6v1.6c0 1.3-.6 2-2 2" />
    </svg>
  ),
  folder: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.4 4.4a1 1 0 011-1h2.8l1.4 1.6h4.9a1 1 0 011 1v5.6a1 1 0 01-1 1h-9.1a1 1 0 01-1-1V4.4z" />
    </svg>
  ),
  close: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden>
      <path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8" />
    </svg>
  ),
  terminal: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <path d="M4.8 6.4l2 1.6-2 1.6M8.4 10.2h3" />
    </svg>
  ),
  trash: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 4.4h10M6.4 4.4V3.2a.8.8 0 01.8-.8h1.6a.8.8 0 01.8.8v1.2" />
      <path d="M4.4 4.4l.6 8a1 1 0 001 .9h4a1 1 0 001-.9l.6-8" />
    </svg>
  ),
};
