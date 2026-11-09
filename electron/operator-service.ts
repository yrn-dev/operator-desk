import { app } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

declare const __OPERATOR_SERVICE_URL__: string;

type Preference = { enabled: boolean | null; installationId?: string };
type EventName = "app_open" | "agent_used";
export type LatestVersion = { version: string; url: string; sha512: string; kind: "nsis" | "appimage" | "deb" | "pacman"; notes?: string };

const origin = __OPERATOR_SERVICE_URL__.replace(/\/$/, "");
const releaseManifestUrl = "https://opr.pzero.kz/download/operator-updates.json";
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
  if (!app.isPackaged) return null;
  try {
    const response = await fetch(releaseManifestUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const manifest = await response.json() as Record<string, any>;
    const release = manifest.desktop;
    if (typeof release?.version !== "string" || !isNewer(release.version, app.getVersion())) return null;
    const platformPackages = release.packages?.[process.platform];
    let kind: LatestVersion["kind"];
    if (process.platform === "win32") kind = "nsis";
    else if (process.platform === "linux") {
      const osRelease = (() => { try { return fs.readFileSync("/etc/os-release", "utf8"); } catch { return ""; } })();
      const distro = `${osRelease.match(/^ID=(.*)$/m)?.[1] ?? ""} ${osRelease.match(/^ID_LIKE=(.*)$/m)?.[1] ?? ""}`.toLowerCase().replaceAll('"', "");
      kind = process.env.APPIMAGE ? "appimage" : /arch|manjaro/.test(distro) ? "pacman" : /debian|ubuntu|linuxmint|pop/.test(distro) ? "deb" : "appimage";
    } else return null;
    const asset = process.platform === "linux" ? platformPackages?.[kind] : platformPackages;
    if (typeof asset?.url !== "string" || typeof asset.sha512 !== "string") return null;
    const url = new URL(asset.url);
    if (url.protocol !== "https:" || url.hostname !== "opr.pzero.kz" || !/^\/download\/Operator-\d+\.\d+\.\d+-/.test(url.pathname)) return null;
    if (!path.basename(url.pathname).startsWith(`Operator-${release.version}-`)) return null;
    if (!/^[A-Za-z0-9+/]{86}==$/.test(asset.sha512)) return null;
    return { version: release.version, url: url.toString(), sha512: asset.sha512, kind,
      notes: typeof release.notes === "string" ? release.notes.slice(0, 600) : undefined };
  } catch {
    return null;
  }
}
