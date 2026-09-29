import { useEffect, useState } from "react";
import type { ReadinessReport } from "../types.ts";

const LABELS: Record<string, string> = {
  core: "Ядро operator",
  key: "Ключ провайдера",
  screen: "Снимок экрана",
  input: "Управление мышью и клавиатурой",
  gh: "GitHub (gh)",
  npx: "Загрузка MCP-серверов (npx)",
};

/**
 * Что готово к работе. Показывается при первом запуске и из меню: пользователь
 * видит состояние заранее, а не ловит ошибку посреди задачи.
 */
export function Readiness({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    window.operator.checkReadiness().then(setReport);
  }, []);

  const items = report?.items ?? [];
  const blocking = items.filter((item) => item.required && !item.ok);
  const optional = items.filter((item) => !item.required && !item.ok);

  return (
    <div
      onMouseDown={onClose}
      className="overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 170,
        display: "grid",
        placeItems: "center",
        background: "rgba(0,0,0,.55)",
        padding: 24,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="sheet"
        style={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "80vh",
          overflowY: "auto",
          padding: 20,
          borderRadius: 14,
          border: "1px solid var(--line)",
          background: "var(--bg-raised)",
          boxShadow: "0 24px 60px rgba(0,0,0,.6)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <span style={{ flex: 1, fontSize: 15, color: "var(--text)" }}>Готовность</span>
          <button onClick={onClose} style={{ color: "var(--text-faint)", fontSize: 18, lineHeight: 1 }}>
            ×
          </button>
        </div>

        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 16 }}>
          {blocking.length === 0
            ? "Всё нужное на месте. Необязательные пункты расширяют возможности."
            : "Чтобы приложение заработало, не хватает нескольких вещей."}
        </div>

        {!report && <div style={{ fontSize: 13, color: "var(--text-faint)" }}>проверяю…</div>}

        {items.map((item) => (
          <div
            key={item.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 12px",
              marginBottom: 8,
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--bg-inset)",
            }}
          >
            <span
              style={{
                marginTop: 1,
                color: item.ok ? "var(--ok)" : item.required ? "var(--error)" : "var(--warn)",
                fontSize: 13,
              }}
            >
              {item.ok ? "✓" : item.required ? "✕" : "!"}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "var(--text)" }}>
                {LABELS[item.id] ?? item.id}
                {!item.required && !item.ok && (
                  <span style={{ marginLeft: 7, fontSize: 11.5, color: "var(--text-faint)" }}>
                    необязательно
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.5 }}>
                {item.detail}
              </div>

              {!item.ok && item.fix && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <code
                    style={{
                      flex: 1,
                      padding: "5px 8px",
                      borderRadius: 6,
                      background: "var(--bg)",
                      color: "var(--md-code)",
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.fix}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(item.fix!);
                      setCopied(item.id);
                      setTimeout(() => setCopied(null), 1500);
                    }}
                    style={{
                      padding: "5px 9px",
                      borderRadius: 6,
                      border: "1px solid var(--line)",
                      color: "var(--text-muted)",
                      fontSize: 11.5,
                      flex: "none",
                    }}
                  >
                    {copied === item.id ? "скопировано" : "копировать"}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {optional.length > 0 && blocking.length === 0 && (
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-faint)", lineHeight: 1.55 }}>
            Без необязательных пунктов приложение работает — просто часть умений будет
            недоступна, и агент сам об этом скажет, если они понадобятся.
          </div>
        )}
      </div>
    </div>
  );
}
