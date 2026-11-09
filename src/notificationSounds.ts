import type { SoundCue } from "./notificationEvents.ts";

export type SoundPreferences = { enabled: boolean; volume: number };
const STORAGE_KEY = "operator.notification-sounds.v1";
const DEFAULTS: SoundPreferences = { enabled: true, volume: 0.45 };
const sources: Record<SoundCue, string> = {
  complete: new URL("./assets/sounds/complete.wav", import.meta.url).href,
  attention: new URL("./assets/sounds/attention.wav", import.meta.url).href,
};

export function readSoundPreferences(): SoundPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return { enabled: typeof stored?.enabled === "boolean" ? stored.enabled : DEFAULTS.enabled,
      volume: typeof stored?.volume === "number" && Number.isFinite(stored.volume) ? Math.min(1, Math.max(0, stored.volume)) : DEFAULTS.volume };
  } catch { return { ...DEFAULTS }; }
}

export function saveSoundPreferences(value: SoundPreferences): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* A storage failure must not interrupt a task. */ }
  if (!value.enabled || value.volume === 0) stopNotificationSound();
}

let current: HTMLAudioElement | undefined;
let lastPlayed = 0;
let lastCue: SoundCue | undefined;
export function stopNotificationSound(): void {
  if (current) { current.pause(); current.currentTime = 0; current = undefined; }
}

export async function playNotificationSound(cue: SoundCue, preview = false): Promise<boolean> {
  const preferences = readSoundPreferences();
  if ((!preview && !preferences.enabled) || preferences.volume === 0) return false;
  // Concurrent sessions should not produce a pile-up of notification tones.
  const now = Date.now();
  if (!preview && now - lastPlayed < 900 && (cue === "complete" || lastCue === "attention")) return false;
  if (!preview) { lastPlayed = now; lastCue = cue; }
  stopNotificationSound();
  const audio = new Audio(sources[cue]);
  audio.volume = preferences.volume;
  current = audio;
  audio.addEventListener("ended", () => { if (current === audio) current = undefined; }, { once: true });
  try { await audio.play(); return true; }
  catch { if (current === audio) current = undefined; return false; }
}
