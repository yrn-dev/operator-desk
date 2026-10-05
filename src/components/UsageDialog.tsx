import { useEffect, useState } from "react";

export function UsageDialog({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<{ enabled: boolean | null; configured: boolean } | null>(null);

  useEffect(() => { void window.operator.usagePreference().then(setState); }, []);

  const choose = async (enabled: boolean) => {
    setState(await window.operator.setUsagePreference(enabled));
    onClose();
  };

  return (
    <div className="overlay" style={{ position: "fixed", inset: 0, zIndex: 190, display: "grid", placeItems: "center", background: "rgba(0,0,0,.6)", padding: 24 }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="usage-title" style={{ width: "100%", maxWidth: 490, padding: 22, borderRadius: 14, border: "1px solid var(--line)", background: "var(--bg-raised)", boxShadow: "0 24px 60px rgba(0,0,0,.6)" }}>
        <h2 id="usage-title" style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: "0 0 12px" }}>Помочь улучшить Operator?</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
          ИИ-агент Operator использует ваш ноутбук, чтобы выполнять задачи. Разрешите отправлять короткую статистику, чтобы мы знали, сколько людей им пользуются?
        </p>
        <p style={{ color: "var(--text-faint)", fontSize: 12, lineHeight: 1.5 }}>
          При запуске и первом запросе за день отправляются случайный ID установки, версия и ОС. Диалоги, файлы и ключи не отправляются; сервер видит IP-адрес. Статистику можно отключить в любое время.
          {state && !state.configured && " Сервер статистики пока не подключён; отправка начнётся только после подключения в новой сборке."}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button className="control" onClick={() => void choose(false)} style={{ padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8, color: "var(--text-muted)" }}>
            {state?.enabled ? "Отключить" : "Не разрешать"}
          </button>
          <button className="control" onClick={() => void choose(true)} style={{ padding: "8px 12px", borderRadius: 8, background: "var(--text)", color: "var(--bg)" }}>
            {state?.enabled ? "Оставить включённой" : "Разрешить"}
          </button>
        </div>
      </div>
    </div>
  );
}
