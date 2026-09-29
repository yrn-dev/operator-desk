import { useEffect, useRef, useState } from "react";
import type { Attachment, Checkpoint, LineState, ModelInfo, ScreenEnv, SlashCommand } from "../types.ts";
import { ModelPicker } from "./ModelPicker.tsx";
import { Autopilot } from "./Autopilot.tsx";
import { AttachmentPreview } from "./FileChip.tsx";

/** Поле ввода: Enter — отправить, Shift+Enter — перенос строки. */
export function Composer({
  busy,
  incoming,
  onIncomingTaken,
  commands,
  line,
  models,
  onSetModel,
  onSetThinking,
  onOpenKeys,
  autopilot,
  screenEnv,
  onAutopilotChange,
  checkpoints,
  onRestore,
  onSend,
  onAbort,
}: {
  busy: boolean;
  /** Файлы, перетащенные в окно. */
  incoming: Attachment[];
  onIncomingTaken: () => void;
  commands: SlashCommand[];
  line: LineState | undefined;
  models: ModelInfo[];
  onSetModel: (provider: string, id: string) => void;
  onSetThinking: (level: string) => void;
  onOpenKeys: () => void;
  autopilot: boolean;
  screenEnv: ScreenEnv | null;
  onAutopilotChange: (enabled: boolean) => void;
  checkpoints: Checkpoint[];
  onRestore: (checkpoint: Checkpoint) => void;
  onSend: (text: string, attachments: Attachment[]) => void;
  onAbort: () => void;
}) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const [focused, setFocused] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
  }, []);

  useEffect(() => {
    if (incoming.length === 0) return;
    setAttachments((prev) => {
      const known = new Set(prev.map((item) => item.path));
      return [...prev, ...incoming.filter((item) => !known.has(item.path))];
    });
    onIncomingTaken();
    area.current?.focus();
  }, [incoming, onIncomingTaken]);

  const grow = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  // Процесс линии оборвался: писать некуда, пока сессию не открыть заново.
  const offline = line?.lamp === "off";

  const submit = () => {
    if (offline) return;
    const text = value.trim();
    if (!text && attachments.length === 0) return;
    onSend(text, attachments);
    setValue("");
    setAttachments([]);
    requestAnimationFrame(grow);
  };

  const attach = async () => {
    const picked = await window.operator.pickFiles();
    if (picked.length === 0) return;
    setAttachments((prev) => {
      const known = new Set(prev.map((item) => item.path));
      return [...prev, ...picked.filter((item) => !known.has(item.path))];
    });
    area.current?.focus();
  };

  const query = /^\/\S*$/.test(value) ? value.slice(1).toLowerCase() : null;
  const matches =
    query === null
      ? []
      : commands
          .filter((command) => command.name.toLowerCase().includes(query))
          .slice(0, 8);
  const suggesting = matches.length > 0;

  const complete = (name: string) => {
    setValue(`/${name} `);
    requestAnimationFrame(() => {
      grow();
      area.current?.focus();
    });
  };

  const lastChange = checkpoints.find((item) => !item.restored);
  const ready = !offline && (value.trim().length > 0 || attachments.length > 0);

  return (
    <div style={{ padding: "0 24px 18px" }}>
      <div style={{ maxWidth: "var(--measure)", margin: "0 auto", position: "relative" }}>
        {suggesting && (
          <div
            className="popover-up"
            style={{
              position: "absolute",
              bottom: "calc(100% + 8px)",
              left: 0,
              right: 0,
              maxHeight: 280,
              overflowY: "auto",
              padding: 4,
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--line)",
              background: "var(--bg-raised)",
              boxShadow: "0 14px 34px rgba(0,0,0,.5)",
              zIndex: 20,
            }}
          >
            {matches.map((command, index) => {
              const active = index === Math.min(highlighted, matches.length - 1);
              return (
                <button
                  key={command.name}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => complete(command.name)}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 10,
                    width: "100%",
                    padding: "7px 9px",
                    borderRadius: 6,
                    textAlign: "left",
                    background: active ? "var(--bg-active)" : "transparent",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12.5,
                      color: "var(--accent)",
                      flex: "none",
                    }}
                  >
                    /{command.name}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 12,
                      color: "var(--text-faint)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {command.description ?? ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {attachments.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "0 4px 10px" }}>
            {attachments.map((item) => (
              <AttachmentPreview
                key={item.path}
                item={item}
                onRemove={() => setAttachments((prev) => prev.filter((a) => a.path !== item.path))}
              />
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            padding: "8px 8px 8px 8px",
            borderRadius: 18,
            border: `1px solid ${focused ? "rgba(247,244,240,.35)" : "var(--line)"}`,
            background: "var(--bg-raised)",
            transition: "border-color var(--normal) var(--ease), background var(--normal) var(--ease)",
          }}
        >
          <button
            onClick={attach}
            title="Прикрепить файлы"
            style={{
              display: "grid",
              placeItems: "center",
              width: 34,
              height: 34,
              flex: "none",
              borderRadius: "50%",
              color: "var(--text-muted)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-active)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 3.4v9.2M3.4 8h9.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          <textarea
            ref={area}
            value={value}
            rows={1}
            disabled={offline}
            placeholder={
              offline
                ? "Линия остановлена — откройте сессию заново"
                : busy
                  ? "Добавить указание на ходу…"
                  : "Спросите или поручите задачу"
            }
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setValue(e.target.value);
              grow();
            }}
            onKeyDown={(e) => {
              if (suggesting) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlighted((index) => (index + 1) % matches.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlighted((index) => (index - 1 + matches.length) % matches.length);
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault();
                  complete(matches[Math.min(highlighted, matches.length - 1)].name);
                  setHighlighted(0);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setValue("");
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            style={{
              flex: 1,
              resize: "none",
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: 14,
              lineHeight: "22px",
              padding: "6px 0",
              maxHeight: 220,
              color: "var(--text)",
            }}
          />

          {busy && !offline ? (
            <button
              onClick={onAbort}
              title="Остановить"
              style={{
                display: "grid",
                placeItems: "center",
                width: 32,
                height: 32,
                marginBottom: 1,
                flex: "none",
                borderRadius: "50%",
                background: "var(--bg-active)",
                color: "var(--text)",
              }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" aria-hidden>
                <rect width="11" height="11" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!ready}
              title="Отправить"
              style={{
                display: "grid",
                placeItems: "center",
                width: 32,
                height: 32,
                marginBottom: 1,
                flex: "none",
                borderRadius: "50%",
                background: ready ? "var(--accent)" : "var(--bg-active)",
                color: ready ? "#1c1917" : "var(--text-faint)",
                cursor: ready ? "pointer" : "default",
                transition: "background var(--fast) var(--ease), transform var(--fast) var(--ease)",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                <path
                  d="M7.5 12V3.5M3.8 7.2L7.5 3.5l3.7 3.7"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 8,
            fontSize: 11.5,
            color: "var(--text-faint)",
          }}
        >
          <ModelPicker line={line} models={models} onSetModel={onSetModel} onSetThinking={onSetThinking} onOpenKeys={onOpenKeys} />

          <Autopilot enabled={autopilot} env={screenEnv} onChange={onAutopilotChange} />

          {lastChange && (
            <button onClick={() => onRestore(lastChange)} className="control" title={lastChange.file}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 8a5 5 0 105-5" />
                <path d="M3 3.4V8h4.4" />
              </svg>
              Отменить правку {fileName(lastChange.file)}
            </button>
          )}

          {/* Подсказка нужна тому, кто уже печатает: в покое она только шумит. */}
          <span
            style={{
              flex: 1,
              textAlign: "right",
              opacity: focused || suggesting ? 1 : 0,
              transition: "opacity var(--normal) var(--ease)",
              pointerEvents: "none",
            }}
          >
            {suggesting
              ? "↑↓ — выбор · Tab — подставить · Esc — отмена"
              : "Enter — отправить · Shift+Enter — новая строка · / — команды"}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Короткое имя файла для кнопки отката. */
function fileName(file: string): string {
  const parts = file.split(/[\\/]/);
  return parts[parts.length - 1] || file;
}
