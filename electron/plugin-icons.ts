import fs from "node:fs";
import path from "node:path";

/**
 * Логотип плагина. Подбирается по порядку, от самого надёжного источника:
 *
 *   1. Файл самого плагина — icon.svg / icon.png или путь из поля icon.
 *      Автор лучше всех знает, как выглядит его знак.
 *   2. Официальный знак из набора Simple Icons — по полю icon, идентификатору,
 *      названию, пакету сервера и адресу удалённого сервера:
 *      server-github → GitHub, https://mcp.sentry.dev → Sentry,
 *      любой @modelcontextprotocol/server-* → знак протокола MCP.
 *   3. Аватар организации на GitHub из данных пакета — npm, PyPI или образа
 *      Docker — для брендов, которых в наборе нет. Скачивается один раз
 *      и лежит в кеше.
 *
 * Если ничего не нашлось, рендерер рисует монограмму.
 */

export type PluginIcon =
  | { kind: "image"; src: string }
  | { kind: "brand"; title: string; hex: string; path: string };

type Manifest = Record<string, unknown> & { id: string; dir?: string };

const IMAGE_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** Общие слова совпадают с чужими брендами — сами по себе знак не выбирают. */
const GENERIC = new Set([
  "time", "fetch", "memory", "files", "filesystem", "search", "thinking", "notes", "note",
  "everything", "server", "tools", "tool", "plugin", "browser", "database", "shell", "git-server",
  // «mcp» в имени пакета значит лишь «сервер протокола»: @playwright/mcp — не знак MCP.
  "mcp", "dev", "api", "app", "www", "run",
]);

/** Имена, под которыми бренд лежит в наборе иначе, чем его зовут в быту. */
const ALIASES: Record<string, string> = {
  postgres: "postgresql",
  pg: "postgresql",
  chrome: "googlechrome",
  chromedevtools: "googlechrome",
  context7: "upstash",
  mcp: "modelcontextprotocol",
  bravesearch: "brave",
  k8s: "kubernetes",
  gh: "github",
  gdrive: "googledrive",
  notionhq: "notion",
};

/** Прокси, через которые подключаются удалённые серверы: сами они не сервис. */
const PROXIES = new Set(["mcp-remote", "mcp-proxy", "supergateway"]);

let brands: Record<string, [string, string, string]> | null = null;
let brandsFile = "";

export function configureBrandIcons(file: string): void {
  brandsFile = file;
}

function brandSet(): Record<string, [string, string, string]> {
  if (brands) return brands;
  try {
    brands = JSON.parse(fs.readFileSync(brandsFile, "utf8")).icons ?? {};
  } catch {
    brands = {};
  }
  return brands!;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

function argsOf(manifest: Manifest): string[] {
  return (Array.isArray(manifest.args) ? manifest.args : []).filter(
    (arg): arg is string => typeof arg === "string",
  );
}

function commandName(manifest: Manifest): string {
  return path.basename(String(manifest.command ?? "")).replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
}

const IS_CONTAINER = (manifest: Manifest) => ["docker", "podman"].includes(commandName(manifest));
const IS_PYTHON = (manifest: Manifest) => ["uvx", "uv", "pipx", "python", "python3"].includes(commandName(manifest));

/**
 * Пакет из аргументов запуска: первый аргумент, похожий на имя пакета.
 * Флаги, пути, адреса, файлы скриптов и прокси пропускаются, версия отрезается.
 * Для контейнеров пакета нет — там смотрится образ.
 */
export function packageOf(manifest: Manifest): string | null {
  if (IS_CONTAINER(manifest)) return null;
  for (const arg of argsOf(manifest)) {
    if (arg.startsWith("-")) continue;
    const name = arg.replace(/(?<=.)[@=][^/]*$/, "");
    if (PROXIES.has(name)) continue;
    if (/\.(m?js|cjs|ts|py|json)$/i.test(name)) continue;
    if (/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name)) return name;
  }
  return null;
}

/** Хозяин образа контейнера: ghcr.io/github/github-mcp-server → github. */
function imageOwnerOf(manifest: Manifest): string | null {
  if (!IS_CONTAINER(manifest)) return null;
  for (const arg of argsOf(manifest)) {
    const match = arg.match(/^(?:(?:ghcr\.io|docker\.io|quay\.io)\/)?([a-z0-9][\w.-]*)\/[\w./-]+(?::[\w.-]+)?$/i);
    if (match && !arg.includes("=")) return match[1];
  }
  return null;
}

/** Имена сервисов из адресов удалённых серверов: https://mcp.sentry.dev → sentry. */
function hostsOf(manifest: Manifest): string[] {
  const names: string[] = [];
  for (const arg of argsOf(manifest)) {
    try {
      const labels = new URL(arg).hostname.split(".");
      // Отбрасываем зону и служебные поддомены вроде mcp., api., www.
      for (const label of labels.slice(0, -1)) names.push(label);
    } catch {
      // Не адрес.
    }
  }
  return names;
}

/** Кандидаты в имя бренда — от самого точного к самому общему. */
function candidates(manifest: Manifest): string[] {
  const list: string[] = [];
  const push = (value: unknown, allowGeneric = false) => {
    if (typeof value !== "string" || !value.trim()) return;
    const key = slug(value);
    if (!key || (!allowGeneric && GENERIC.has(key))) return;
    list.push(ALIASES[key] ?? key);
  };

  if (typeof manifest.icon === "string" && !IMAGE_TYPES[path.extname(manifest.icon).toLowerCase()]) {
    push(manifest.icon, true);
  }
  push(manifest.id);
  push(manifest.name);
  for (const host of hostsOf(manifest)) push(host);

  const pkg = packageOf(manifest);
  if (pkg) {
    const [scope, bare] = pkg.startsWith("@") ? pkg.slice(1).split("/") : [null, pkg];
    const core = bare
      .replace(/^(mcp-server-|server-|mcp-)/, "")
      .replace(/(-mcp-server|-mcp|-server)$/, "");
    push(core);
    for (const part of core.split("-")) push(part);
    if (scope) push(scope);
  }
  push(imageOwnerOf(manifest));
  return [...new Set(list)];
}

function brandBySlug(key: string): PluginIcon | null {
  const found = brandSet()[key];
  return found ? { kind: "brand", title: found[0], hex: found[1], path: found[2] } : null;
}

function brandFor(manifest: Manifest): PluginIcon | null {
  for (const key of candidates(manifest)) {
    const found = brandBySlug(key);
    if (found) return found;
  }
  return null;
}

function dataUri(file: string): string | null {
  const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
  if (!type) return null;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 512 * 1024) return null;
    return `data:${type};base64,${fs.readFileSync(file).toString("base64")}`;
  } catch {
    return null;
  }
}

/** Файл, который положил автор плагина, — только внутри папки плагина. */
function authorIcon(manifest: Manifest): PluginIcon | null {
  if (!manifest.dir) return null;
  const dir = path.resolve(manifest.dir);
  const named = typeof manifest.icon === "string" ? [manifest.icon] : [];
  for (const name of [...named, "icon.svg", "icon.png", "logo.svg", "logo.png"]) {
    const file = path.resolve(dir, name);
    if (!file.startsWith(dir + path.sep)) continue;
    const src = dataUri(file);
    if (src) return { kind: "image", src };
  }
  return null;
}

/* ── Аватар организации ─────────────────────────────────────────── */

const inFlight = new Set<string>();

function cacheBase(cacheDir: string, id: string): string {
  return path.join(cacheDir, id.replace(/[^\w.-]/g, "_"));
}

const ownerFromText = (text: string) => text.match(/github\.com[/:]([\w.-]+)/)?.[1] ?? null;

/** Организация на GitHub, которой принадлежит сервер. */
async function ownerOf(manifest: Manifest): Promise<string | null> {
  const image = imageOwnerOf(manifest);
  if (image) return image;

  const pkg = packageOf(manifest);
  if (!pkg) return null;
  const timeout = AbortSignal.timeout(6000);

  if (IS_PYTHON(manifest)) {
    const response = await fetch(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`, { signal: timeout });
    if (!response.ok) return null;
    const info = ((await response.json()) as { info?: Record<string, unknown> }).info ?? {};
    return ownerFromText(JSON.stringify([info.project_urls, info.home_page, info.download_url]));
  }

  const response = await fetch(`https://registry.npmjs.org/${pkg.replace("/", "%2F")}`, { signal: timeout });
  if (!response.ok) return null;
  const info = (await response.json()) as { repository?: { url?: string } | string; homepage?: string };
  const repo = typeof info.repository === "string" ? info.repository : (info.repository?.url ?? "");
  return ownerFromText(`${repo} ${info.homepage ?? ""}`);
}

/**
 * Находит хозяина и сохраняет его знак: официальный бренд, если организация
 * в наборе есть (например, modelcontextprotocol), иначе аватар с GitHub.
 */
async function fetchOwnerIcon(manifest: Manifest, base: string): Promise<boolean> {
  const owner = await ownerOf(manifest);
  if (!owner) return false;
  fs.mkdirSync(path.dirname(base), { recursive: true });

  const key = ALIASES[slug(owner)] ?? slug(owner);
  if (brandBySlug(key)) {
    fs.writeFileSync(`${base}.brand`, key);
    return true;
  }

  const avatar = await fetch(`https://github.com/${owner}.png?size=96`, { signal: AbortSignal.timeout(8000) });
  if (!avatar.ok || !(avatar.headers.get("content-type") ?? "").startsWith("image/")) return false;
  fs.writeFileSync(`${base}.png`, Buffer.from(await avatar.arrayBuffer()));
  return true;
}

/**
 * Логотип для плагина. Если его пока нет, но известно, откуда сервер,
 * знак ищется в фоне, а по готовности вызывается onUpdate — список
 * перечитывается и логотип появляется.
 */
export function resolvePluginIcon(
  manifest: Manifest,
  options: { cacheDir: string; onUpdate?: () => void },
): PluginIcon | null {
  const own = authorIcon(manifest);
  if (own) return own;

  const brand = brandFor(manifest);
  if (brand) return brand;

  const base = cacheBase(options.cacheDir, manifest.id);
  try {
    const cachedBrand = brandBySlug(fs.readFileSync(`${base}.brand`, "utf8").trim());
    if (cachedBrand) return cachedBrand;
  } catch {
    // Знака хозяина в кеше нет.
  }
  const src = dataUri(`${base}.png`);
  if (src) return { kind: "image", src };

  const knowable = Boolean(packageOf(manifest) || imageOwnerOf(manifest));
  if (knowable && !inFlight.has(manifest.id) && !fs.existsSync(`${base}.нет`)) {
    inFlight.add(manifest.id);
    fetchOwnerIcon(manifest, base)
      .then((ok) => {
        if (ok) options.onUpdate?.();
        // Не нашли — помечаем, чтобы не стучаться в сеть при каждом открытии.
        else fs.writeFileSync(`${base}.нет`, "");
      })
      .catch(() => {
        // Сети нет — попробуем в следующий раз.
      })
      .finally(() => inFlight.delete(manifest.id));
  }
  return null;
}
