import { app } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

declare const __OPERATOR_SERVICE_URL__: string;

type Preference = { enabled: boolean | null; installationId?: string };
type EventName = "app_open" | "agent_used";
export type LatestVersion = { version: string; url: string; notes?: string };

const origin = __OPERATOR_SERVICE_URL__.replace(/\/$/, "");
let lastUseDay = "";

function validOrigin(): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch {
    return false;
  }
}

function preferencePath(): string {
  return path.join(app.getPath("userData"), "usage-statistics.json");
}

function readPreference(): Preference {
  try {
    const value = JSON.parse(fs.readFileSync(preferencePath(), "utf8"));
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : null,
      installationId: typeof value.installationId === "string" && /^[0-9a-f-]{36}$/.test(value.installationId)
        ? value.installationId : undefined,
    };
  } catch {
    return { enabled: null };
  }
}

function writePreference(value: Preference): void {
  const file = preferencePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows handles permissions differently. */ }
}

export function usagePreference(): { enabled: boolean | null; configured: boolean } {
  return { enabled: readPreference().enabled, configured: validOrigin() };
}

export function setUsagePreference(enabled: boolean): void {
  const previous = readPreference();
  writePreference(enabled
    ? { enabled: true, installationId: previous.installationId ?? randomUUID() }
    : { enabled: false });
  if (enabled) recordUsage("app_open");
}

export function recordUsage(event: EventName): void {
  if (!validOrigin() || !app.isPackaged) return;
  const pref = readPreference();
  if (!pref.enabled || !pref.installationId) return;
  if (event === "agent_used") {
    const today = new Date().toISOString().slice(0, 10);
    if (lastUseDay === today) return;
    lastUseDay = today;
  }
  // Только тип события, случайный ID установки, версия и ОС. Никаких запросов,
  // файлов, ключей или имени компьютера. Ошибка сети не мешает работе агента.
  void fetch(`${origin}/v1/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, installationId: pref.installationId, version: app.getVersion(), platform: process.platform }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

function isNewer(candidate: string, current: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(candidate) || !/^\d+\.\d+\.\d+$/.test(current)) return false;
  const a = candidate.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export async function checkLatestVersion(): Promise<LatestVersion | null> {
  if (!validOrigin() || !app.isPackaged) return null;
  try {
    const response = await fetch(`${origin}/v1/latest?platform=${encodeURIComponent(process.platform)}`, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const value = await response.json() as Record<string, unknown>;
    if (typeof value.version !== "string" || typeof value.url !== "string" || !isNewer(value.version, app.getVersion())) return null;
    const url = new URL(value.url);
    if (url.protocol !== "https:" || url.hostname !== "opr.pzero.kz" || !url.pathname.startsWith("/download/")) return null;
    return { version: value.version, url: url.toString(), notes: typeof value.notes === "string" ? value.notes.slice(0, 300) : undefined };
  } catch {
    return null;
  }
}
