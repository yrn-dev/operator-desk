import { useCallback, useEffect, useState } from "react";
import type { PluginIcon, PluginInfo, PluginStatus } from "../types.ts";
import { BrandIcon, PluginMark } from "./BrandIcon.tsx";

/**
 * Плагины оператора.
 *
 * Плагин — папка с манифестом. Свой код (kind: "tool") получает API агента
 * и регистрирует инструменты прямо в процессе; внешний сервер (kind: "mcp")
 * подключается по протоколу и даёт свои инструменты через отдельный процесс.
 * Для пользователя разница — только в подписи «свой код» или «сервер MCP».
 */

type Ready = { manifest: Record<string, unknown>; label: string; hint: string; brand: string };

/** Готовые серверы протокола: ставятся одной кнопкой, без ручного манифеста. */
const CATALOG: Ready[] = [
  {
    label: "Playwright",
    brand: "playwright",
    hint: "Фронтенд: открыть страницу, нажать, заполнить форму, проверить вёрстку.",
    manifest: {
      id: "playwright",
      name: "Playwright",
      description: "Браузер под управлением агента: страницы, клики, формы.",
      version: "1.0.0",
      kind: "mcp",
      icon: "playwright",
      command: "npx",
      args: ["-y", "@playwright/mcp@latest"],
    },
  },
  {
    label: "Chrome DevTools",
    brand: "chrome",
    hint: "Отладка фронтенда: консоль, сетевые запросы, производительность.",
    manifest: {
      id: "chrome-devtools",
      name: "Chrome DevTools",
      description: "Консоль, сеть и производительность страницы.",
      version: "1.0.0",
      kind: "mcp",
      icon: "chrome",
      command: "npx",
      args: ["-y", "chrome-devtools-mcp@latest"],
    },
  },
  {
    label: "Документация",
    brand: "context7",
    hint: "Свежая документация библиотек вместо догадок по памяти.",
    manifest: {
      id: "context7",
      name: "Документация",
      description: "Актуальная документация библиотек прямо в диалоге.",
      version: "1.0.0",
      kind: "mcp",
      icon: "context7",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
    },
  },
  {
    label: "GitHub",
    brand: "github",
    hint: "Задачи, пул-реквесты и файлы репозитория.",
    manifest: {
      id: "github",
      name: "GitHub",
      description: "Задачи, пул-реквесты и файлы репозитория.",
      version: "1.0.0",
      kind: "mcp",
      icon: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      settings: [
        { key: "token", label: "Токен доступа", secret: true, env: "GITHUB_PERSONAL_ACCESS_TOKEN" },
      ],
    },
  },
  {
    label: "Память",
    brand: "memory",
    hint: "Граф фактов, который остаётся между диалогами.",
    manifest: {
      id: "memory",
      name: "Память",
      description: "Факты и связи между ними, общие для всех диалогов.",
      version: "1.0.0",
      kind: "mcp",
      icon: "memory",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
    },
  },
  {
    label: "PostgreSQL",
    brand: "postgres",
    hint: "Запросы к базе и просмотр схемы. Строку подключения задайте в настройках.",
    manifest: {
      id: "postgres",
      name: "PostgreSQL",
      description: "Запросы к базе и просмотр схемы.",
      version: "1.0.0",
      kind: "mcp",
      icon: "postgres",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
      settings: [
        {
          key: "url",
          label: "Строка подключения",
          hint: "postgresql://пользователь@сервер/база — без неё сервер не запустится",
          // Этот сервер принимает адрес базы последним аргументом.
          arg: true,
          secret: true,
          required: true,
        },
      ],
    },
  },
];

function kindLabel(plugin: PluginInfo): string {
  return plugin.kind === "mcp" ? "сервер MCP" : "свой код";
}

export function Plugins({ statuses, onClose }: { statuses: PluginStatus[]; onClose: () => void }) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const [catalogIcons, setCatalogIcons] = useState<Record<string, PluginIcon | null>>({});

  const refresh = useCallback(async () => {
    setPlugins(await window.operator.listPlugins());
    setCatalogIcons(await window.operator.catalogIcons(CATALOG.map((item) => item.manifest)));
  }, []);

  useEffect(() => {
    void refresh();
    // Логотипы, которых нет в наборе, докачиваются в фоне — тогда перечитываем.
    return window.operator.onPluginIcons(() => void refresh());
  }, [refresh]);

  const say = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 2600);
  };

  const installed = new Set(plugins.map((item) => item.id));
  const available = CATALOG.filter((item) => !installed.has(String(item.manifest.id)));

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
          maxWidth: 680,
          maxHeight: "82vh",
          overflowY: "auto",
          padding: 20,
          borderRadius: 14,
          border: "1px solid var(--line)",
          background: "var(--bg-raised)",
          boxShadow: "0 24px 60px rgba(0,0,0,.6)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ display: "flex", color: "var(--text-muted)" }}>
            <BrandIcon name="plugin" size={18} />
          </span>
          <span style={{ flex: 1, fontSize: 15, color: "var(--text)" }}>Плагины</span>
          <button onClick={onClose} style={{ color: "var(--text-faint)", fontSize: 18, lineHeight: 1 }}>
            ×
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 4 }}>
          Плагин добавляет оператору инструменты. Свой код работает внутри агента, сервер MCP —
          отдельным процессом. Изменения применяются к следующему диалогу.
        </div>

        <Section text="Установлены" count={plugins.length} />
        {plugins.map((plugin) => {
          const status = statuses.find((item) => item.id === plugin.id);
          const fields = plugin.settings ?? [];
          const expanded = open === plugin.id;
          return (
            <div key={plugin.id} className="plugin-card">
              <div className="plugin-row" style={{ border: "none", margin: 0, background: "transparent" }}>
                <span className="plugin-mark">
                  <PluginMark
                    icon={plugin.resolvedIcon}
                    name={plugin.icon ?? plugin.id}
                    label={plugin.name ?? plugin.id}
                    size={20}
                  />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13.5, color: "var(--text)" }}>{plugin.name ?? plugin.id}</span>
                    <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{kindLabel(plugin)}</span>
                    {plugin.origin === "builtin" && (
                      <span style={{ fontSize: 11, color: "var(--text-faint)" }}>встроенный</span>
                    )}
                    <State plugin={plugin} status={status} />
                  </div>
                  <div className="plugin-hint">
                    {plugin.broken ?? status?.error ?? plugin.description ?? ""}
                  </div>
                </div>

                {(fields.length > 0 || plugin.origin === "user") && (
                  <button
                    className="plugin-action"
                    onClick={() => {
                      setOpen(expanded ? null : plugin.id);
                      setDraft(
                        Object.fromEntries(
                          fields.map((field) => [
                            field.key,
                            String(plugin.values[field.key] ?? field.default ?? ""),
                          ]),
                        ),
                      );
                    }}
                  >
                    {fields.length > 0 ? "Настроить" : "Подробнее"}
                  </button>
                )}

                <button
                  className="plugin-switch"
                  data-on={plugin.enabled || undefined}
                  title={plugin.enabled ? "Выключить" : "Включить"}
                  onClick={async () => {
                    await window.operator.togglePlugin(plugin.id, !plugin.enabled);
                    await refresh();
                  }}
                >
                  <span />
                </button>
              </div>

              {expanded && (
                <div className="plugin-settings">
                  {plugin.kind === "mcp" && (
                    <div className="plugin-facts">
                      {String(plugin.command ?? "")} {(plugin.args ?? []).join(" ")}
                    </div>
                  )}
                  {(plugin.permissions ?? []).map((line) => (
                    <div key={line} className="plugin-facts">
                      {line}
                    </div>
                  ))}
                  {fields.map((field) => (
                    <label key={field.key} style={{ display: "block", marginBottom: 10 }}>
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{field.label}</span>
                      {field.hint && (
                        <span style={{ display: "block", fontSize: 11, color: "var(--text-faint)" }}>
                          {field.hint}
                        </span>
                      )}
                      <input
                        type={field.secret ? "password" : "text"}
                        value={draft[field.key] ?? ""}
                        onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                        spellCheck={false}
                        style={{
                          width: "100%",
                          marginTop: 5,
                          padding: "7px 9px",
                          borderRadius: 7,
                          border: "1px solid var(--line)",
                          background: "var(--bg-inset)",
                          color: "var(--text)",
                          fontSize: 12.5,
                          fontFamily: field.secret ? "var(--mono)" : "var(--sans)",
                          outline: "none",
                        }}
                      />
                    </label>
                  ))}
                  <div style={{ display: "flex", gap: 8 }}>
                    {fields.length > 0 && (
                      <button
                        className="plugin-action plugin-add"
                        onClick={async () => {
                          await window.operator.savePluginSettings(plugin.id, draft);
                          setOpen(null);
                          await refresh();
                          say("Настройки сохранены — вступят в силу в новом диалоге");
                        }}
                      >
                        Сохранить
                      </button>
                    )}
                    <button className="plugin-action" onClick={() => setOpen(null)}>
                      Закрыть
                    </button>
                    {plugin.origin === "user" && (
                      <button
                        className="plugin-action"
                        style={{ marginLeft: "auto", color: "var(--error)" }}
                        onClick={async () => {
                          const result = await window.operator.removePlugin(
                            plugin.id,
                            plugin.name ?? plugin.id,
                          );
                          if (result.ok) {
                            setOpen(null);
                            await refresh();
                            say("Плагин удалён");
                          } else if (result.error) {
                            say(result.error);
                          }
                        }}
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {available.length > 0 && (
          <>
            <Section text="Можно добавить" count={available.length} />
            {available.map((item) => (
              <div key={String(item.manifest.id)} className="plugin-row">
                <span className="plugin-mark">
                  <PluginMark
                    icon={catalogIcons[String(item.manifest.id)]}
                    name={item.brand}
                    label={item.label}
                    size={20}
                  />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: "var(--text)" }}>{item.label}</div>
                  <div className="plugin-hint">{item.hint}</div>
                </div>
                <button
                  className="plugin-action plugin-add"
                  onClick={async () => {
                    const result = await window.operator.addPlugin(item.manifest);
                    if (result.ok) {
                      await refresh();
                      say(`«${item.label}» добавлен`);
                    } else if (result.error) {
                      say(result.error);
                    }
                  }}
                >
                  Добавить
                </button>
              </div>
            ))}
          </>
        )}

        <Section text="Свой плагин" count={0} />
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Плагин — это папка с файлом <code>plugin.json</code> и модулем, который получает API
          агента и регистрирует инструменты. Формат описан в PLUGINS.md.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            className="plugin-action plugin-add"
            onClick={async () => {
              const result = await window.operator.installPlugin();
              if (result.ok) {
                await refresh();
                say(`«${result.name}» установлен`);
              } else if (result.error) {
                say(result.error);
              }
            }}
          >
            Установить из папки
          </button>
          <button className="plugin-action" onClick={() => window.operator.revealPlugins()}>
            Открыть папку плагинов
          </button>
        </div>

        {toast && (
          <div
            className="enter"
            style={{
              position: "sticky",
              bottom: 0,
              marginTop: 14,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--bg-inset)",
              color: "var(--text-muted)",
              fontSize: 12.5,
            }}
          >
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

/** Состояние плагина в работающем диалоге. */
function State({ plugin, status }: { plugin: PluginInfo; status: PluginStatus | undefined }) {
  if (!plugin.enabled) return <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>выключен</span>;
  if (plugin.broken) return <span style={{ fontSize: 11.5, color: "var(--error)" }}>сломан</span>;
  if (!status) {
    return <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>запустится в новом диалоге</span>;
  }
  if (status.status === "error") {
    return <span style={{ fontSize: 11.5, color: "var(--error)" }}>не запустился</span>;
  }
  if (status.status === "off") return <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>выключен</span>;
  return (
    <span style={{ fontSize: 11.5, color: "var(--ok)" }}>
      {status.tools} {status.tools === 1 ? "инструмент" : "инструментов"}
      {status.sleeping && (
        <span style={{ color: "var(--text-faint)" }}> · запустится при вызове</span>
      )}
    </span>
  );
}

function Section({ text, count }: { text: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 8px" }}>
      <span
        style={{
          fontSize: 11,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {text}
      </span>
      <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
      {count > 0 && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{count}</span>}
    </div>
  );
}
