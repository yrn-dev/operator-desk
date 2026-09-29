import { BrowserWindow, net, session } from "electron";

/**
 * Карточка ссылки из ответа модели: заголовок, домен, иконка и картинка.
 * У обычного сайта картинку даёт og:image. У localhost и страниц без неё —
 * снимок самой страницы из невидимого окна: так видно, что поднялось на порту.
 */
export type LinkPreview = {
  url: string;
  host: string;
  title: string;
  /** data: URL — рендер не ходит в сеть сам. */
  image: string | null;
  icon: string | null;
};

const cache = new Map<string, Promise<LinkPreview>>();
const PAGE_BYTES = 768 * 1024;
const IMAGE_BYTES = 4 * 1024 * 1024;

function isLocal(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127\./.test(host) ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    /^(10|192\.168)\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

async function fetchLimited(url: string, limit: number, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await net.fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OperatorDesk/0.3; link preview)" },
    });
    const length = Number(response.headers.get("content-length") ?? 0);
    if (!response.ok || length > limit) return null;
    return response;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function toDataUrl(url: string): Promise<string | null> {
  const response = await fetchLimited(url, IMAGE_BYTES, 8000);
  if (!response) return null;
  const type = response.headers.get("content-type")?.split(";")[0].trim() ?? "";
  if (!type.startsWith("image/")) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > IMAGE_BYTES) return null;
  return `data:${type};base64,${bytes.toString("base64")}`;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim();
}

/** Значение meta-тега по property или name, в любом порядке атрибутов. */
function meta(html: string, key: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (name !== key) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content) return decodeEntities(content);
  }
  return null;
}

function iconHref(html: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? "";
    if (!rel.split(/\s+/).includes("icon") && !rel.includes("apple-touch-icon")) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href) return decodeEntities(href);
  }
  return null;
}

async function readPage(url: string): Promise<{ title: string | null; image: string | null; icon: string | null }> {
  const response = await fetchLimited(url, PAGE_BYTES * 4, 8000);
  if (!response || !(response.headers.get("content-type") ?? "").includes("html")) {
    return { title: null, image: null, icon: null };
  }
  // Метаданные лежат в <head> — дальше первых сотен килобайт читать незачем.
  const reader = response.body?.getReader();
  let html = "";
  if (reader) {
    const decoder = new TextDecoder();
    while (html.length < PAGE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    void reader.cancel().catch(() => undefined);
  }
  const base = response.url || url;
  const resolve = (href: string | null) => {
    if (!href) return null;
    try {
      return new URL(href, base).toString();
    } catch {
      return null;
    }
  };
  const rawTitle = meta(html, "og:title") ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  return {
    title: rawTitle ? decodeEntities(rawTitle).replace(/\s+/g, " ") : null,
    image: resolve(meta(html, "og:image") ?? meta(html, "twitter:image")),
    icon: resolve(iconHref(html)) ?? resolve("/favicon.ico"),
  };
}

/** Снимок страницы в невидимом окне: без node, в отдельном сеансе, с таймаутом. */
async function snapshot(url: string): Promise<{ image: string | null; title: string | null; icon: string | null }> {
  const partition = "link-preview";
  const previewSession = session.fromPartition(partition);
  previewSession.removeAllListeners("will-download");
  previewSession.on("will-download", (event) => event.preventDefault());

  const view = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      offscreen: true,
      partition,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  view.webContents.setAudioMuted(true);
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  let icon: string | null = null;
  view.webContents.on("page-favicon-updated", (_event, icons) => {
    icon = icon ?? icons[0] ?? null;
  });

  try {
    const loaded = new Promise<boolean>((resolve) => {
      view.webContents.once("did-finish-load", () => resolve(true));
      view.webContents.once("did-fail-load", (_e, code) => resolve(code === -3)); // -3: переход прерван, страница есть
    });
    void view.loadURL(url).catch(() => undefined);
    const ok = await Promise.race([loaded, new Promise<boolean>((r) => setTimeout(() => r(false), 12000))]);
    if (!ok) return { image: null, title: null, icon: null };
    // Даём SPA дорисоваться: dev-серверы часто рендерят интерфейс уже после load.
    await new Promise((r) => setTimeout(r, 1500));
    const shot = await view.webContents.capturePage();
    const image = shot.isEmpty() ? null : `data:image/jpeg;base64,${shot.resize({ width: 800 }).toJPEG(82).toString("base64")}`;
    return { image, title: view.webContents.getTitle() || null, icon };
  } catch {
    return { image: null, title: null, icon: null };
  } finally {
    view.destroy();
  }
}

async function build(url: string): Promise<LinkPreview> {
  const parsed = new URL(url);
  const host = parsed.host;
  const local = isLocal(parsed.hostname);

  const page = await readPage(url);
  let image = page.image ? await toDataUrl(page.image) : null;
  let title = page.title;
  let iconUrl = page.icon;

  // Своей картинки нет или это localhost — показываем саму страницу.
  if (!image || local) {
    const shot = await snapshot(url);
    image = shot.image ?? image;
    title = title ?? shot.title;
    iconUrl = iconUrl ?? shot.icon;
  }

  const icon = iconUrl ? await toDataUrl(iconUrl) : null;
  return { url, host, title: title || host, image, icon };
}

export function linkPreview(url: string): Promise<LinkPreview | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Promise.resolve(null);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return Promise.resolve(null);
  const key = parsed.toString();
  let pending = cache.get(key);
  if (!pending) {
    pending = build(key).catch(() => ({ url: key, host: parsed.host, title: parsed.host, image: null, icon: null }));
    cache.set(key, pending);
    // localhost меняется от правки к правке — держим снимок недолго.
    if (isLocal(parsed.hostname)) setTimeout(() => cache.delete(key), 60_000);
  }
  return pending;
}
