import type { PermissionAsk } from "../types.ts";

/**
 * Запрос разрешения на вызов инструмента. Приходит из моста, пока агент ждёт
 * ответа — поэтому окно модальное и без «крестика»: решение обязательно.
 */
export function PermissionDialog({
  ask,
  onAnswer,
}: {
  ask: PermissionAsk;
  onAnswer: (choice: string) => void;
}) {
  const danger = ask.title.toLowerCase().includes("опасн");

  return (
    <div
      className="overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "grid",
        placeItems: "center",
        background: "rgba(0,0,0,.55)",
        padding: 24,
      }}
    >
      <div
        className="sheet"
        style={{
          width: "100%",
          maxWidth: 520,
          padding: 20,
          borderRadius: 14,
          border: `1px solid ${danger ? "var(--error)" : "var(--line)"}`,
          background: "var(--bg-raised)",
          boxShadow: "0 24px 60px rgba(0,0,0,.6)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
          <svg
            width="17"
            height="17"
            viewBox="0 0 16 16"
            fill="none"
            stroke={danger ? "var(--error)" : "var(--warn)"}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M8 2.6l5.6 9.8H2.4L8 2.6z" />
            <path d="M8 6.6v3M8 11.2v.1" />
          </svg>
          <span style={{ fontSize: 15, color: "var(--text)" }}>{ask.title}</span>
        </div>

        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 18 }}>
          Агент просит выполнить действие. Решение применится к этому вызову;
          «всегда» запомнит правило для похожих.
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {ask.options.map((option) => {
            const primary = option === "Разрешить";
            const reject = option === "Отклонить";
            return (
              <button
                key={option}
                autoFocus={primary}
                onClick={() => onAnswer(option)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: `1px solid ${primary ? "var(--accent)" : "var(--line)"}`,
                  background: primary ? "var(--accent)" : "transparent",
                  color: primary ? "#1c1917" : reject ? "var(--error)" : "var(--text-muted)",
                  fontSize: 13,
                }}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
