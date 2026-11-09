import { useEffect, useRef, useState } from "react";
import { playNotificationSound, readSoundPreferences, saveSoundPreferences } from "../notificationSounds.ts";
import type { SoundCue } from "../notificationEvents.ts";

export function SoundSettings({ onClose }: { onClose: () => void }) {
  const [preferences, setPreferences] = useState(readSoundPreferences);
  const [error, setError] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const items = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, [onClose]);
  const update = (next: typeof preferences) => { setPreferences(next); saveSoundPreferences(next); };
  const preview = async (cue: SoundCue) => { setError(!await playNotificationSound(cue, true)); };
  return <div className="overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    style={{ position: "fixed", inset: 0, zIndex: 190, display: "grid", placeItems: "center", background: "rgba(0,0,0,.6)", padding: 24 }}>
    <div ref={panel} className="sheet" role="dialog" aria-modal="true" aria-labelledby="sound-title" tabIndex={-1}
      style={{ width: "100%", maxWidth: 440, padding: 22, borderRadius: 14, border: "1px solid var(--line)", background: "var(--bg-raised)", boxShadow: "0 24px 60px rgba(0,0,0,.6)" }}>
      <h2 id="sound-title" style={{ fontSize: 16, fontWeight: 600, margin: "0 0 10px" }}>Звуковые уведомления</h2>
      <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>Два коротких, мягких сигнала — когда работа завершена и когда нужен ваш ответ.</p>
      <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, marginBottom: 20 }}>
        <input type="checkbox" checked={preferences.enabled} onChange={event => update({ ...preferences, enabled: event.target.checked })} style={{ accentColor: "var(--accent)" }} />
        Включить звуки
      </label>
      <label htmlFor="sound-volume" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)" }}>
        <span>Громкость</span><span>{Math.round(preferences.volume * 100)}%</span>
      </label>
      <input id="sound-volume" type="range" min="0" max="100" step="1" value={Math.round(preferences.volume * 100)}
        onChange={event => update({ ...preferences, volume: Number(event.target.value) / 100 })} style={{ width: "100%", margin: "12px 0 20px", accentColor: "var(--accent)" }} />
      {([['complete', 'Работа завершена'], ['attention', 'Нужен ваш ответ']] as const).map(([cue, label]) => <div key={cue}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: "1px solid var(--line)", fontSize: 13 }}>
        <span>{label}</span><button className="control control-ghost" disabled={preferences.volume === 0} onClick={() => void preview(cue)} aria-label={`Прослушать: ${label}`} style={{ padding: "5px 9px" }}>Прослушать</button>
      </div>)}
      {error && <p role="status" style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 12 }}>Не удалось воспроизвести звук. Проверьте громкость и устройство вывода.</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}><button className="control" onClick={onClose}
        style={{ padding: "7px 14px", borderRadius: 8, background: "var(--text)", color: "var(--bg)" }}>Готово</button></div>
    </div>
  </div>;
}
