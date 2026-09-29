import { useState } from "react";
import type { ScreenEnv } from "../types.ts";

/** Подсказка, как добрать недостающее, — по системе пользователя. */
function fixHint(env: ScreenEnv | null): string | null {
  if (!env || env.missing.length === 0) return null;
  const missing = env.missing.join(", ");
  if (navigator.userAgent.includes("Linux")) {
    return `Не хватает: ${missing}. В сеансе Wayland мышью и клавиатурой управляет ydotool: установите его (например, sudo pacman -S ydotool) и запустите службу ydotoold.`;
  }
  if (navigator.userAgent.includes("Mac")) {
    return `Не хватает: ${missing}. Для мыши нужен cliclick (brew install cliclick), а приложению — доступ в разделе «Универсальный доступ».`;
  }
  return `Не хватает: ${missing}.`;
}

/**
 * Кнопка «Автопилот»: разрешает агенту смотреть на экран и работать мышью
 * и клавиатурой. Выключено по умолчанию — при включении показываем, что это
 * значит и чего в системе не хватает.
 */
export function Autopilot({
  enabled,
  env,
  onChange,
}: {
  enabled: boolean;
  env: ScreenEnv | null;
  onChange: (enabled: boolean) => void;
}) {
  const [asking, setAsking] = useState(false);
  const hint = fixHint(env);
  const canSee = Boolean(env && env.screenshot.length > 0);
  const canAct = Boolean(env?.input);

  return (
    <>
      <button
        onClick={() => (enabled ? onChange(false) : setAsking(true))}
        title={
          enabled
            ? "Агент видит экран и может действовать мышью и клавиатурой"
            : "Разрешить агенту работать за компьютером"
        }
        className="control"
        data-active={enabled ? "true" : undefined}
        style={enabled ? { borderColor: "var(--warn)", color: "var(--warn)" } : undefined}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="2" y="2.6" width="12" height="8.4" rx="1.4" />
          <path d="M6 13.4h4" />
          <path d="M6.6 5.6l3.4 2.2-3.4 2.2z" fill="currentColor" stroke="none" />
        </svg>
        Автопилот
      </button>

      {asking && (
        <div
          onMouseDown={() => setAsking(false)}
          className="overlay"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 160,
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
              maxWidth: 520,
              padding: 20,
              borderRadius: 14,
              border: "1px solid var(--line)",
              background: "var(--bg-raised)",
              boxShadow: "0 24px 60px rgba(0,0,0,.6)",
            }}
          >
            <div style={{ fontSize: 15, color: "var(--text)", marginBottom: 10 }}>
              Включить автопилот?
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 14 }}>
              Агент сможет снимать экран, двигать мышью, нажимать клавиши и запускать
              приложения — то есть работать за компьютером вместо вас. Он видит всё,
              что открыто на экране, включая чужие окна. Выключайте, когда не нужно.
            </div>

            <div
              style={{
                padding: "10px 12px",
                marginBottom: 14,
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--bg-inset)",
                fontSize: 12.5,
              }}
            >
              <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                <span style={{ color: canSee ? "var(--ok)" : "var(--error)" }}>
                  {canSee ? "✓" : "✕"}
                </span>
                <span style={{ color: "var(--text-muted)" }}>видит экран</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <span style={{ color: canAct ? "var(--ok)" : "var(--error)" }}>
                  {canAct ? "✓" : "✕"}
                </span>
                <span style={{ color: "var(--text-muted)" }}>управляет мышью и клавиатурой</span>
              </div>
              {hint && (
                <div style={{ marginTop: 9, color: "var(--warn)", lineHeight: 1.55 }}>{hint}</div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setAsking(false)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  color: "var(--text-muted)",
                  fontSize: 13,
                }}
              >
                Отмена
              </button>
              <button
                onClick={() => {
                  onChange(true);
                  setAsking(false);
                }}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--warn)",
                  background: "var(--warn)",
                  color: "#1c1917",
                  fontSize: 13,
                }}
              >
                Включить
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
