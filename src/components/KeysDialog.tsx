import { useEffect, useState } from "react";
import type { KeyEntry, ModelInfo } from "../types.ts";

/** Понятное имя провайдера и подсказка, где взять ключ. */
const PROVIDERS: Record<string, { label: string; hint: string }> = {
  "alem-ai": { label: "Alem AI", hint: "qwen3-8, gemma4, gpt-oss · llm.alem.ai" },
  ollama: { label: "Ollama", hint: "локальные и облачные модели Ollama" },
  openai: { label: "OpenAI", hint: "platform.openai.com" },
  anthropic: { label: "Anthropic", hint: "console.anthropic.com" },
};

/**
 * Ключи провайдеров. Значения хранит сам оператор в ~/.opr/agent/auth.json,
 * наружу отдаётся только факт наличия ключа и его хвост.
 */
export function KeysDialog({ models, onClose }: { models: ModelInfo[]; onClose: () => void }) {
  const [keys, setKeys] = useState<KeyEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);

  const refresh = () => window.operator.listKeys().then(setKeys);
  useEffect(() => {
    refresh();
  }, []);

  // Провайдеры: те, у кого есть ключ, плюс те, чьи модели уже видны.
  const providers = [...new Set([...keys.map((k) => k.provider), ...models.map((m) => m.provider)])]
    .filter(Boolean)
    .sort();

  const modelsOf = (provider: string) =>
    models.filter((model) => model.provider === provider).map((model) => model.id);

  return (
    <div
      onMouseDown={onClose}
      className="overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 150,
        display: "grid",
        placeItems: "center",
        background: "rgba(0,0,0,.5)",
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
          <span style={{ flex: 1, fontSize: 15, color: "var(--text)" }}>Ключи доступа</span>
          <button onClick={onClose} style={{ color: "var(--text-faint)", fontSize: 18, lineHeight: 1 }}>
            ×
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 18 }}>
          Ключи хранит сам operator, в файле настроек с доступом только для вас.
          После смены ключа начните новый диалог, чтобы он подхватился.
        </div>

        {providers.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--text-faint)" }}>Провайдеров пока нет.</div>
        )}

        {providers.map((provider) => {
          const entry = keys.find((item) => item.provider === provider);
          const meta = PROVIDERS[provider];
          const list = modelsOf(provider);
          const draft = drafts[provider] ?? "";

          return (
            <div
              key={provider}
              style={{
                padding: 14,
                marginBottom: 10,
                borderRadius: 10,
                border: "1px solid var(--line)",
                background: "var(--bg-inset)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: entry?.hasKey ? "var(--ok)" : "var(--line)",
                  }}
                />
                <span style={{ fontSize: 13.5, color: "var(--text)" }}>
                  {meta?.label ?? provider}
                </span>
                {entry?.hasKey && (
                  <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                    ключ сохранён {entry.hint}
                  </span>
                )}
                {saved === provider && (
                  <span style={{ fontSize: 11.5, color: "var(--ok)" }}>обновлён</span>
                )}
              </div>

              <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 10 }}>
                {list.length > 0 ? list.join(" · ") : (meta?.hint ?? "")}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="password"
                  value={draft}
                  placeholder={entry?.hasKey ? "новый ключ — чтобы заменить" : "вставьте ключ"}
                  onChange={(e) => setDrafts({ ...drafts, [provider]: e.target.value })}
                  onKeyDown={async (e) => {
                    if (e.key !== "Enter" || !draft.trim()) return;
                    await window.operator.setKey(provider, draft);
                    setDrafts({ ...drafts, [provider]: "" });
                    setSaved(provider);
                    refresh();
                  }}
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    borderRadius: 7,
                    border: "1px solid var(--line)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontFamily: "var(--mono)",
                    fontSize: 12.5,
                    outline: "none",
                  }}
                />
                <button
                  disabled={!draft.trim()}
                  onClick={async () => {
                    await window.operator.setKey(provider, draft);
                    setDrafts({ ...drafts, [provider]: "" });
                    setSaved(provider);
                    refresh();
                  }}
                  style={{
                    padding: "7px 13px",
                    borderRadius: 7,
                    border: `1px solid ${draft.trim() ? "var(--accent)" : "var(--line)"}`,
                    background: draft.trim() ? "var(--accent)" : "transparent",
                    color: draft.trim() ? "#1c1917" : "var(--text-faint)",
                    fontSize: 12.5,
                    cursor: draft.trim() ? "pointer" : "default",
                  }}
                >
                  Сохранить
                </button>
                {entry?.hasKey && (
                  <button
                    onClick={async () => {
                      await window.operator.removeKey(provider);
                      setSaved(null);
                      refresh();
                    }}
                    title="Убрать ключ"
                    style={{
                      padding: "7px 11px",
                      borderRadius: 7,
                      border: "1px solid var(--line)",
                      color: "var(--error)",
                      fontSize: 12.5,
                    }}
                  >
                    Убрать
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
