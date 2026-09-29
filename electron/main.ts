import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, net, protocol, screen, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { OperatorLine, pathWithBin } from "./rpc.ts";
import { bundledOperator, locateBinary, locateOpr, type OperatorLauncher } from "./locate-opr.ts";
import { listSessions } from "./sessions.ts";
import { linkPreview } from "./link-preview.ts";
import {
  deleteSession,
  exportSessionJson,
  isSessionFile,
  renameSession,
  suggestedName,
} from "./session-ops.ts";
import { IS_LINUX, IS_MAC, spawnPortable } from "./portable.ts";
import { configureBrandIcons, resolvePluginIcon } from "./plugin-icons.ts";

const dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(dirname, "..");
const DEV_SERVER = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

// ES-модули не грузятся по file:// из-за CORS — отдаём сборку через свой протокол.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const lines = new Map<string, OperatorLine>();

/** Приложение закрывается: отказы линий на этом этапе — не ошибка. */
let quitting = false;

/**
 * Диагностика включается через OPERATOR_DESK_DEBUG=1 и пишется в temp:
 * в собранном приложении консоли нет, а разбирать чужие сбои как-то надо.
 */
const DEBUG = process.env.OPERATOR_DESK_DEBUG === "1";
const LOG_FILE = path.join(os.tmpdir(), "operator-desk.log");

function trace(text: string): void {
  if (!DEBUG) return;
  try {
    fs.appendFileSync(LOG_FILE, `${text}\n`);
  } catch {
    // Некуда писать — не мешаем работе.
  }
}

/**
 * Чем запускать оператор. Сначала встроенная копия — тогда ничего ставить не
 * нужно; если её нет (запуск из исходников без vendor), берём системный opr.
 */
function operatorLauncher(): OperatorLauncher | null {
  const bundled = bundledOperator(process.resourcesPath, process.execPath);
  if (bundled) return bundled;

  const bin = locateOpr();
  return bin ? { command: bin, prefixArgs: [], env: {}, bundled: false } : null;
}

/**
 * Откуда копировать мост и встроенные плагины. В сборке они распакованы рядом
 * с архивом приложения (app.asar.unpacked): рекурсивное копирование по пути
 * внутри app.asar на чистой машине молча падало, и линия не запускалась —
 * у разработчика это скрывали копии, оставшиеся от прошлых запусков.
 */
function runtimeSource(folder: string): string {
  const packed = path.join(dirname, folder);
  const unpacked = packed.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  return unpacked !== packed && fs.existsSync(unpacked) ? unpacked : packed;
}

/** Копирует папку из сборки в настройки и сообщает, если не вышло. */
function copyRuntime(folder: string, target: string): void {
  const source = runtimeSource(folder);
  try {
    fs.cpSync(source, target, { recursive: true, force: true });
  } catch (error) {
    // Копия от прошлого запуска может подойти, но молчать об этом нельзя.
    trace(`[copy-failed] ${source} → ${target}: ${(error as Error).message}`);
    console.error(`не удалось скопировать ${folder}:`, error);
  }
}

function bridgePath(): string {
  const target = path.join(app.getPath("userData"), "bridge");
  // Мост состоит из нескольких модулей — копируем папку целиком.
  copyRuntime("bridge", target);
  return path.join(target, "desk-bridge.mjs");
}

/** Дополнение к системному промпту: рассказывает агенту про эту среду. */
function promptPath(): string {
  return path.join(app.getPath("userData"), "bridge", "desk-prompt.md");
}

function policyPath(): string {
  return path.join(app.getPath("userData"), "policy.json");
}

/** Плагины, которые едут с приложением: копируем рядом с настройками. */
function builtinPluginsDir(): string {
  const target = path.join(app.getPath("userData"), "plugins-builtin");
  copyRuntime("plugins", target);
  return target;
}

/** Плагины, установленные пользователем. */
function userPluginsDir(): string {
  const dir = path.join(app.getPath("userData"), "plugins");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Что включено и с какими настройками. */
function pluginsRegistryPath(): string {
  return path.join(app.getPath("userData"), "plugins.json");
}

function pluginsDataDir(): string {
  return path.join(app.getPath("userData"), "plugins-data");
}

function mcpConfigPath(): string {
  return path.join(app.getPath("userData"), "mcp.json");
}

function checkpointDir(): string {
  return path.join(app.getPath("userData"), "checkpoints");
}

const DEFAULT_POLICY = { rules: [] as Array<Record<string, unknown>> };

function readPolicy(): Record<string, unknown> {
  try {
    return { ...DEFAULT_POLICY, ...JSON.parse(fs.readFileSync(policyPath(), "utf8")) };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

function writePolicy(policy: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(policyPath()), { recursive: true });
  fs.writeFileSync(policyPath(), JSON.stringify(policy, null, 2), "utf8");
}
let win: BrowserWindow | null = null;

function installMenu(): void {
  // На macOS меню всегда на экране, и без appMenu не работали бы ни Cmd+Q,
  // ни «О программе». На Windows и Linux меню нет вовсе: скрытая полоса
  // всплывала от одного Alt (и Shift+Alt при смене раскладки) и уводила фокус из поля ввода.
  if (!IS_MAC) {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(IS_MAC ? [{ role: "appMenu" as const }] : []),
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Иконка окна нужна в разработке; в сборке её прописывает electron-builder. */
function windowIcon(): { icon?: string } {
  const file = path.join(process.env.APP_ROOT!, "build", "icon.png");
  return fs.existsSync(file) ? { icon: file } : {};
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    ...windowIcon(),
    backgroundColor: "#141311",
    titleBarStyle: IS_MAC ? "hiddenInset" : "default",
    // Кнопки окна на macOS лежат поверх интерфейса — опускаем их к шапке.
    ...(IS_MAC ? { trafficLightPosition: { x: 14, y: 14 } } : {}),
    webPreferences: {
      preload: path.join(dirname, "preload.cjs"),
      sandbox: false,
    },
  });

  trace(`--- запуск ${new Date().toISOString()} · dist=${RENDERER_DIST}`);

  if (!IS_MAC) {
    win.removeMenu();
    // Без меню пропали его ускорители — масштаб и инструменты разработчика
    // возвращаем вручную. Копирование и вставка работают и без меню.
    win.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || !input.control || input.alt) return;
      const contents = win?.webContents;
      if (!contents) return;
      const key = input.key.toLowerCase();
      if (key === "=" || key === "+") contents.setZoomLevel(contents.getZoomLevel() + 0.5);
      else if (key === "-") contents.setZoomLevel(contents.getZoomLevel() - 0.5);
      else if (key === "0") contents.setZoomLevel(0);
      else if (input.shift && key === "i") contents.toggleDevTools();
      else return;
      event.preventDefault();
    });
  }

  win.once("ready-to-show", () => win?.show());
  win.webContents.on("console-message", (event: any) => {
    trace(`[console:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });
  win.webContents.on("did-fail-load", (_e, code, description, url) => {
    trace(`[load-failed] ${code} ${description} ${url}`);
  });
  win.webContents.on("did-finish-load", () => trace("[load-ok]"));
  win.webContents.on("preload-error", (_e, preloadPath, error) => {
    trace(`[preload-error] ${preloadPath}: ${error.message}`);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: "deny" };
  });
  // Клик по обычной ссылке в ответе уводил бы само окно на чужой сайт.
  const ownPage = (url: string) => url.startsWith("app://") || Boolean(DEV_SERVER && url.startsWith(DEV_SERVER));
  win.webContents.on("will-navigate", (event, url) => {
    if (ownPage(url)) return;
    event.preventDefault();
    openInBrowser(url);
  });
  // Страховка на переходы, которые will-navigate не видит: окно не должно
  // оставаться на чужой странице — там нет выхода назад, а preload открыт ей.
  win.webContents.on("did-navigate", (_event, url) => {
    if (ownPage(url)) return;
    trace(`[escaped] ${url}`);
    openInBrowser(url);
    if (DEV_SERVER) void win?.loadURL(DEV_SERVER);
    else void win?.loadURL("app://bundle/index.html");
  });

  if (DEV_SERVER) win.loadURL(DEV_SERVER);
  else win.loadURL("app://bundle/index.html");
}

/** Ссылки открываются в браузере системы — только веб-адреса, не file: и не схемы приложений. */
function openInBrowser(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

ipcMain.handle("link:preview", (_e, args: { url: string }) => linkPreview(args.url));
ipcMain.handle("link:open", (_e, args: { url: string }) => openInBrowser(args.url));

function forward(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

ipcMain.handle("line:open", (_e, args: { id: string; cwd: string; provider?: string; model?: string }) => {
  const existing = lines.get(args.id);
  if (existing) existing.stop();

  const launcher = operatorLauncher();
  trace(
    launcher
      ? `[line:open] ${args.id} cwd=${args.cwd} команда=${launcher.command} ` +
          `аргументы=${launcher.prefixArgs.join(" ")} встроенный=${launcher.bundled}`
      : `[line:open] ${args.id}: ядро не найдено (resources=${process.resourcesPath})`,
  );
  if (!launcher) {
    forward("line:fatal", {
      id: args.id,
      message:
        "Ядро operator не найдено. Переустановите приложение или поставьте operator вручную: npm i -g pzero-operator",
    });
    return { ok: false };
  }

  const line = new OperatorLine(args.id, {
    cwd: args.cwd,
    provider: args.provider,
    model: args.model,
    bin: launcher.command,
    prefixArgs: launcher.prefixArgs,
    extensions: [bridgePath()],
    appendPrompt: promptPath(),
    env: {
      ...launcher.env,
      OPERATOR_DESK_CONFIG: policyPath(),
      OPERATOR_DESK_CHECKPOINTS: checkpointDir(),
      OPERATOR_DESK_PLUGINS_BUILTIN: builtinPluginsDir(),
      OPERATOR_DESK_PLUGINS_USER: userPluginsDir(),
      OPERATOR_DESK_PLUGINS_REGISTRY: pluginsRegistryPath(),
      OPERATOR_DESK_PLUGINS_DATA: pluginsDataDir(),
      OPERATOR_DESK_JOBS: path.join(app.getPath("userData"), "jobs"),
      // Пустое значение означает: снимок делает сам мост внешней программой.
      OPERATOR_DESK_SHOTS: canCaptureInApp() ? path.join(app.getPath("userData"), "shots") : "",
      OPERATOR_DESK_BIN: launcher.bundled ? "" : launcher.command,
    },
  });

  line.on("event", (event) => {
    if (event.type === "extension_ui_request") {
      const message = typeof event.message === "string" ? event.message : "";
      if (event.method === "notify" && message.startsWith("@@desk@@")) {
        // Служебный канал моста: события разрешений, чекпоинтов и снимков.
        try {
          const signal = JSON.parse(message.slice(8));
          if (signal.kind === "capture") {
            void serveCapture(String(signal.id));
            return;
          }
          forward("bridge:signal", { id: args.id, signal });
        } catch {
          // Битый сигнал игнорируем.
        }
        return;
      }
      forward("bridge:ask", { id: args.id, request: event });
      return;
    }
    forward("line:event", { id: args.id, event });
  });
  line.on("fatal", (message: string) => {
    trace(`[line:fatal] ${args.id}: ${message}`);
    forward("line:fatal", { id: args.id, message });
  });
  line.on("exit", (code: number | null, stderr: string) => {
    trace(`[line:exit] ${args.id} код=${code} stderr=${stderr.slice(-600)}`);
    // Мёртвая линия не должна оставаться в карте: иначе следующая отправка
    // уйдёт в уничтоженный stdin вместо честного «линия не подключена».
    if (lines.get(args.id) === line) lines.delete(args.id);
    forward("line:exit", { id: args.id, code, stderr });
  });

  line.start();
  lines.set(args.id, line);
  return { ok: true };
});

ipcMain.handle(
  "line:send",
  async (_e, args: { id: string; command: string; payload?: Record<string, unknown> }) => {
    const line = lines.get(args.id);
    if (!line) {
      if (quitting) return null;
      throw new Error("линия не найдена");
    }
    try {
      return await line.send(args.command, args.payload ?? {});
    } catch (error) {
      // На выходе окно уже уничтожено — показывать отказ некому и незачем.
      if (quitting) return null;
      throw error;
    }
  },
);

ipcMain.handle("line:close", (_e, args: { id: string }) => {
  lines.get(args.id)?.stop();
  lines.delete(args.id);
  return { ok: true };
});

/** Пути сессий, начатых из десктопа: по ним история отличает desk от cli. */
function registryFile(): string {
  return path.join(app.getPath("userData"), "desk-sessions.json");
}

async function readRegistry(): Promise<string[]> {
  try {
    return JSON.parse(await fs.promises.readFile(registryFile(), "utf8"));
  } catch {
    return [];
  }
}

ipcMain.handle("sessions:list", async () => {
  const own = await readRegistry();
  return listSessions(new Set(own));
});

/**
 * Снимок экрана средствами Electron: не нужны ни grim, ни spectacle,
 * ни PowerShell — работает одинаково во всех системах.
 */
/**
 * В сеансах Wayland запрос экрана уходит в портал и каждый раз показывает
 * системное окно «выберите экран» — для автоматизации это не годится,
 * поэтому там снимок делает внешняя программа.
 */
function canCaptureInApp(): boolean {
  return !(IS_LINUX && process.env.XDG_SESSION_TYPE === "wayland");
}

async function captureScreen(maxWidth = 1280): Promise<string | null> {
  if (!canCaptureInApp()) return null;
  try {
    const display = screen.getPrimaryDisplay();
    // Физические пиксели: на экранах с масштабом 1.5–2 размер в точках даёт мыльный снимок.
    const width = Math.round(display.size.width * display.scaleFactor);
    const height = Math.round(display.size.height * display.scaleFactor);
    const scale = Math.min(1, maxWidth / width);

    const capture = desktopCapturer
      .getSources({
        types: ["screen"],
        thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
        fetchWindowIcons: false,
      })
      .then((sources) => {
        const source = sources[0];
        if (!source || source.thumbnail.isEmpty()) return null;
        return source.thumbnail.toPNG().toString("base64");
      });

    // В сеансах Wayland запрос может уйти в портал и не вернуться никогда,
    // поэтому ждём недолго и отдаём работу внешней программе.
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500));
    return await Promise.race([capture, timeout]);
  } catch {
    return null;
  }
}

ipcMain.handle("screen:capture", () => captureScreen());

/** Чтение готового снимка: файл удаляется сразу после прочтения. */
ipcMain.handle("screen:takeShot", async (_e, args: { file: string }) => {
  try {
    const data = await fs.promises.readFile(args.file);
    await fs.promises.rm(args.file, { force: true });
    return data.toString("base64");
  } catch {
    return null;
  }
});

/** Готовность: что уже работает, чего не хватает и как это поставить. */
ipcMain.handle("app:readiness", async () => {
  const launcher = operatorLauncher();
  const auth = readAuth();
  const shot = canCaptureInApp()
    ? await captureScreen(320)
    : Boolean(locateBinary("spectacle") || locateBinary("grim") || locateBinary("import"));

  const linux = IS_LINUX;
  const wayland = linux && process.env.XDG_SESSION_TYPE === "wayland";
  const inputTool = wayland ? "ydotool" : linux ? "xdotool" : null;
  const hasInput =
    process.platform === "darwin"
      ? Boolean(locateBinary("cliclick"))
      : process.platform === "win32"
        ? true
        : Boolean(inputTool && locateBinary(inputTool));

  const installHint = (pkg: string) =>
    linux
      ? `sudo pacman -S ${pkg}   # или: sudo apt install ${pkg}`
      : process.platform === "darwin"
        ? `brew install ${pkg}`
        : `winget install ${pkg}`;

  return {
    items: [
      {
        id: "core",
        required: true,
        ok: Boolean(launcher),
        detail: launcher
          ? launcher.bundled
            ? "встроено в приложение — ничего ставить не нужно"
            : `используется установленный operator: ${launcher.command}`
          : "не найдено",
        fix: launcher ? null : "npm i -g pzero-operator",
      },
      {
        id: "key",
        required: true,
        ok: Object.keys(auth).length > 0,
        detail:
          Object.keys(auth).length > 0
            ? `ключ есть: ${Object.keys(auth).join(", ")}`
            : "без ключа провайдера модель не ответит",
        fix: null,
      },
      {
        id: "screen",
        required: false,
        ok: Boolean(shot),
        detail: shot
          ? canCaptureInApp()
            ? "работает средствами приложения"
            : "работает через системную программу снимков"
          : "нечем снять экран — автопилот не сможет смотреть",
        fix: Boolean(shot) ? null : "sudo pacman -S grim   # или: sudo apt install grim",
      },
      {
        id: "input",
        required: false,
        ok: hasInput,
        detail: hasInput
          ? "автопилот сможет кликать и печатать"
          : wayland
            ? "в сеансе Wayland нужен ydotool со службой ydotoold"
            : "нужна программа ввода для вашей системы",
        fix: hasInput
          ? null
          : wayland
            ? "sudo pacman -S ydotool && sudo systemctl enable --now ydotool"
            : inputTool
              ? installHint(inputTool)
              : process.platform === "darwin"
                ? "brew install cliclick"
                : null,
      },
      {
        id: "gh",
        required: false,
        ok: Boolean(locateBinary("gh")),
        detail: locateBinary("gh") ? "пул-реквесты доступны" : "нужен для работы с GitHub",
        fix: locateBinary("gh") ? null : installHint("github-cli"),
      },
      {
        id: "npx",
        required: false,
        ok: Boolean(locateBinary("npx")),
        detail: locateBinary("npx")
          ? "MCP-серверы можно запускать"
          : "без Node.js большинство MCP-серверов не запустится",
        fix: locateBinary("npx") ? null : installHint("nodejs npm"),
      },
    ],
  };
});

/** Мост попросил снимок — кладём его в общую папку под тем же идентификатором. */
async function serveCapture(id: string): Promise<void> {
  const dir = path.join(app.getPath("userData"), "shots");
  // Снимок для модели: 2000px по ширине, мельче она путает текст интерфейса.
  const data = await captureScreen(2000);
  if (!data) return;
  // Мост переводит клики модели в точки экрана. macOS (cliclick) считает в точках,
  // X11 и Windows — в физических пикселях.
  const display = screen.getPrimaryDisplay();
  const factor = process.platform === "darwin" ? 1 : display.scaleFactor;
  const size = {
    width: Math.round(display.size.width * factor),
    height: Math.round(display.size.height * factor),
  };
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    // Размер пишем раньше снимка: мост читает его, как только появился PNG.
    await fs.promises.writeFile(path.join(dir, `${id}.png.json`), JSON.stringify(size));
    await fs.promises.writeFile(path.join(dir, `${id}.png`), Buffer.from(data, "base64"));
  } catch {
    // Не записали — мост возьмёт внешнюю программу.
  }
}

/* ── Плагины ───────────────────────────────────────────────────────
   Плагин — папка с plugin.json: либо свой код (kind: "tool"), либо внешний
   сервер MCP (kind: "mcp"). Здесь только хозяйство: список, включение,
   настройки, установка и удаление. Поднимает их мост внутри агента. */

type PluginManifest = Record<string, unknown> & { id: string; dir: string; origin: string };

function readManifests(folder: string, origin: string): PluginManifest[] {
  const found: PluginManifest[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(folder, entry.name);
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "plugin.json"), "utf8"));
      found.push({ ...manifest, id: manifest.id ?? entry.name, dir, origin });
    } catch (error) {
      found.push({
        id: entry.name,
        name: entry.name,
        dir,
        origin,
        broken: `манифест не читается: ${(error as Error).message}`,
      });
    }
  }
  return found;
}

function readPluginRegistry(): { disabled: string[]; settings: Record<string, Record<string, unknown>> } {
  try {
    const data = JSON.parse(fs.readFileSync(pluginsRegistryPath(), "utf8"));
    return { disabled: data.disabled ?? [], settings: data.settings ?? {} };
  } catch {
    return { disabled: [], settings: {} };
  }
}

function writePluginRegistry(data: { disabled: string[]; settings: Record<string, Record<string, unknown>> }): void {
  fs.mkdirSync(path.dirname(pluginsRegistryPath()), { recursive: true });
  fs.writeFileSync(pluginsRegistryPath(), JSON.stringify(data, null, 2), "utf8");
}

/**
 * Прежние MCP-серверы из mcp.json становятся плагинами вида «mcp»:
 * настройки пользователя не должны пропасть из-за смены модели.
 */
function migrateMcpServers(): void {
  const legacy = mcpConfigPath();
  if (!fs.existsSync(legacy)) return;
  try {
    const config = JSON.parse(fs.readFileSync(legacy, "utf8"));
    const servers = (config?.servers ?? {}) as Record<string, Record<string, unknown>>;
    for (const [id, server] of Object.entries(servers)) {
      const dir = path.join(userPluginsDir(), id);
      if (fs.existsSync(path.join(dir, "plugin.json"))) continue;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "plugin.json"),
        JSON.stringify(
          {
            id,
            name: id,
            description: "Перенесён из прежних настроек MCP.",
            version: "1.0.0",
            kind: "mcp",
            command: server.command,
            args: server.args ?? [],
            env: server.env ?? {},
          },
          null,
          2,
        ),
        "utf8",
      );
    }
    fs.renameSync(legacy, `${legacy}.перенесён`);
  } catch {
    // Старый конфиг битый — переносить нечего.
  }
}

/** Логотипы плагинов: набор знаков собран при сборке, аватары лежат в кеше. */
configureBrandIcons(path.join(dirname, "brand-icons.json"));

function pluginIcon(manifest: Record<string, unknown> & { id: string }) {
  return resolvePluginIcon(manifest, {
    cacheDir: path.join(app.getPath("userData"), "plugin-icons"),
    // Аватар докачался в фоне — пусть окно перечитает список.
    onUpdate: () => forward("plugins:icons", null),
  });
}

ipcMain.handle(
  "plugins:catalogIcons",
  (_e, args: { manifests: Array<Record<string, unknown> & { id: string }> }) =>
    Object.fromEntries(args.manifests.map((manifest) => [manifest.id, pluginIcon(manifest)])),
);

ipcMain.handle("plugins:list", () => {
  migrateMcpServers();
  const registry = readPluginRegistry();
  const disabled = new Set(registry.disabled);
  const all = [
    ...readManifests(builtinPluginsDir(), "builtin"),
    ...readManifests(userPluginsDir(), "user"),
  ];
  const byId = new Map<string, PluginManifest>();
  for (const plugin of all) byId.set(plugin.id, plugin);

  return [...byId.values()]
    .map((plugin) => ({
      ...plugin,
      enabled: !disabled.has(plugin.id),
      values: registry.settings[plugin.id] ?? {},
      // Встроенные плагины — наши, у них свои нарисованные знаки.
      resolvedIcon: plugin.origin === "user" ? pluginIcon(plugin) : null,
    }))
    .sort((a, b) =>
      String((a as { name?: string }).name ?? a.id).localeCompare(
        String((b as { name?: string }).name ?? b.id),
        "ru",
      ),
    );
});

ipcMain.handle("plugins:toggle", (_e, args: { id: string; enabled: boolean }) => {
  const registry = readPluginRegistry();
  const disabled = new Set(registry.disabled);
  if (args.enabled) disabled.delete(args.id);
  else disabled.add(args.id);
  writePluginRegistry({ ...registry, disabled: [...disabled] });
  return { ok: true };
});

ipcMain.handle("plugins:settings", (_e, args: { id: string; values: Record<string, unknown> }) => {
  const registry = readPluginRegistry();
  registry.settings[args.id] = args.values;
  writePluginRegistry(registry);
  return { ok: true };
});

/** Установка из папки: копируем её к пользовательским плагинам. */
ipcMain.handle("plugins:install", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Папка плагина (с файлом plugin.json)",
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };

  const source = result.filePaths[0];
  const manifestFile = path.join(source, "plugin.json");
  if (!fs.existsSync(manifestFile)) {
    return { ok: false, error: "В папке нет plugin.json — это не плагин." };
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    const id = String(manifest.id ?? path.basename(source));
    const target = path.join(userPluginsDir(), id);
    fs.cpSync(source, target, { recursive: true });
    return { ok: true, id, name: manifest.name ?? id };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
});

/** Установка готового плагина из каталога: свой манифест на сервер MCP. */
ipcMain.handle("plugins:add", (_e, args: { manifest: Record<string, unknown> }) => {
  const id = String(args.manifest.id ?? "");
  if (!id) return { ok: false, error: "у плагина нет идентификатора" };
  const dir = path.join(userPluginsDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify(args.manifest, null, 2), "utf8");
  return { ok: true };
});

ipcMain.handle("plugins:remove", async (_e, args: { id: string; name: string }) => {
  const dir = path.join(userPluginsDir(), args.id);
  if (!fs.existsSync(dir)) {
    // Встроенный плагин не удаляем — его можно только выключить.
    return { ok: false, error: "встроенный плагин можно только выключить" };
  }
  const choice = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Удалить", "Отмена"],
    defaultId: 1,
    cancelId: 1,
    message: "Удалить плагин?",
    detail: `«${args.name}»\n\nПапка плагина будет удалена.`,
  });
  if (choice.response !== 0) return { ok: false, cancelled: true };
  await fs.promises.rm(dir, { recursive: true, force: true });
  return { ok: true };
});

ipcMain.handle("plugins:reveal", () => {
  shell.openPath(userPluginsDir());
  return { ok: true };
});

ipcMain.handle("policy:get", () => readPolicy());

/** Ключи провайдеров лежат в хранилище оператора, а не в настройках десктопа. */
function authPath(): string {
  return path.join(os.homedir(), ".opr", "agent", "auth.json");
}

function readAuth(): Record<string, { type: string; key?: string }> {
  try {
    return JSON.parse(fs.readFileSync(authPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeAuth(data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(authPath()), { recursive: true });
  fs.writeFileSync(authPath(), JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
}

/** Наружу отдаём только факт наличия ключа и хвост — сам ключ не покидает машину. */
ipcMain.handle("keys:list", () => {
  const auth = readAuth();
  return Object.entries(auth).map(([provider, credential]) => ({
    provider,
    type: credential?.type ?? "api_key",
    hasKey: Boolean(credential?.key),
    hint: credential?.key ? `…${String(credential.key).slice(-4)}` : "",
  }));
});

ipcMain.handle("keys:set", (_e, args: { provider: string; key: string }) => {
  const auth = readAuth();
  const key = args.key.trim();
  if (!key) return { ok: false, error: "пустой ключ" };
  auth[args.provider] = { ...(auth[args.provider] ?? {}), type: "api_key", key };
  writeAuth(auth);
  return { ok: true };
});

ipcMain.handle("keys:remove", (_e, args: { provider: string }) => {
  const auth = readAuth();
  delete auth[args.provider];
  writeAuth(auth);
  return { ok: true };
});

ipcMain.handle("policy:set", (_e, policy: Record<string, unknown>) => {
  writePolicy({ ...readPolicy(), ...policy });
  return readPolicy();
});

/** Правило «разрешать всегда» для конкретного инструмента и команды. */
ipcMain.handle("policy:remember", (_e, args: { tool: string; subject: string }) => {
  const policy = readPolicy();
  const rules = Array.isArray(policy.rules) ? [...(policy.rules as any[])] : [];
  // Для bash запоминаем первое слово команды, для остальных — весь инструмент.
  const head = args.subject.trim().split(/\s+/)[0];
  const pattern = args.tool === "bash" && head ? `^${head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b` : undefined;
  rules.unshift({ tool: args.tool, pattern, action: "allow" });
  writePolicy({ ...policy, rules });
  return readPolicy();
});

/** Ответ на диалог расширения (разрешения). */
ipcMain.handle(
  "line:respondUI",
  (_e, args: { id: string; requestId: string; payload: Record<string, unknown> }) => {
    lines.get(args.id)?.respondUI(args.requestId, args.payload);
    return { ok: true };
  },
);

/** Откат правки файла к снимку, снятому перед вызовом инструмента. */
ipcMain.handle(
  "checkpoint:restore",
  async (_e, args: { id: string; file: string; existed: boolean }) => {
    const snapshot = path.join(checkpointDir(), args.id);
    try {
      if (args.existed) await fs.promises.copyFile(snapshot, args.file);
      else await fs.promises.rm(args.file, { force: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  },
);

ipcMain.handle("sessions:rename", async (_e, args: { path: string; name: string }) => {
  if (!isSessionFile(args.path) || !args.name.trim()) return { ok: false };
  try {
    await renameSession(args.path, args.name);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
});

ipcMain.handle("sessions:delete", async (_e, args: { path: string; title: string }) => {
  if (!isSessionFile(args.path)) return { ok: false };

  const choice = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Удалить", "Отмена"],
    defaultId: 1,
    cancelId: 1,
    message: "Удалить сессию?",
    detail: `«${args.title}»\n\nФайл будет удалён безвозвратно.`,
  });
  if (choice.response !== 0) return { ok: false, cancelled: true };

  // Живой процесс держит сессию в памяти и при следующем запросе создаст
  // файл заново — поэтому сначала гасим линии, которые пишут в этот файл.
  const closed: string[] = [];
  for (const [id, line] of [...lines]) {
    let file: string | undefined;
    try {
      const state = (await line.send("get_state")) as { sessionFile?: string } | null;
      file = state?.sessionFile;
    } catch {
      // Линия уже оборвалась — её и закрывать нечего.
    }
    if (file && file === args.path) {
      line.stop();
      lines.delete(id);
      closed.push(id);
    }
  }

  try {
    await deleteSession(args.path);
    const own = await readRegistry();
    await fs.promises.writeFile(
      registryFile(),
      JSON.stringify(own.filter((item) => item !== args.path)),
      "utf8",
    );
    return { ok: true, closed };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
});

ipcMain.handle(
  "sessions:export",
  async (_e, args: { path: string; title: string; format: "html" | "json" }) => {
    if (!isSessionFile(args.path)) return { ok: false };

    const result = await dialog.showSaveDialog({
      title: "Сохранить сессию",
      defaultPath: path.join(app.getPath("downloads"), suggestedName(args.title, args.format)),
      filters:
        args.format === "html"
          ? [{ name: "HTML", extensions: ["html"] }]
          : [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };

    try {
      if (args.format === "json") {
        await exportSessionJson(args.path, result.filePath);
        return { ok: true, path: result.filePath };
      }

      // HTML умеет делать сам operator — запускаем его разовым процессом.
      const launcher = operatorLauncher();
      if (!launcher) return { ok: false, error: "ядро operator не найдено" };

      const devNull = fs.openSync(os.devNull, "r");
      const code = await new Promise<number>((resolve) => {
        const child = spawnPortable(
          launcher.command,
          [...launcher.prefixArgs, "--export", args.path, result.filePath!],
          {
            env: { ...process.env, ...launcher.env, NO_COLOR: "1", PATH: pathWithBin(launcher.command) },
            stdio: [devNull, "ignore", "pipe"],
          },
        );
        child.on("error", () => resolve(-1));
        child.on("close", (value) => resolve(value ?? -1));
      });
      try {
        fs.closeSync(devNull);
      } catch {
        // Уже закрыт.
      }

      return code === 0
        ? { ok: true, path: result.filePath }
        : { ok: false, error: "operator не смог собрать HTML" };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  },
);

ipcMain.handle("shell:reveal", (_e, args: { path: string }) => {
  shell.showItemInFolder(args.path);
});

ipcMain.handle("sessions:mark", async (_e, args: { sessionFile: string }) => {
  if (!args.sessionFile) return { ok: false };
  const own = await readRegistry();
  if (!own.includes(args.sessionFile)) {
    own.push(args.sessionFile);
    // Реестр не должен расти бесконечно.
    const trimmed = own.slice(-2000);
    await fs.promises.writeFile(registryFile(), JSON.stringify(trimmed), "utf8");
  }
  return { ok: true };
});

/** Короткое название диалога — отдельный однократный запуск operator. */
ipcMain.handle("session:title", async (_e, args: { firstMessage: string; cwd: string }) => {
  const launcher = operatorLauncher();
  if (!launcher) return null;

  const ask =
    "Придумай короткое название (максимум 4 слова) для диалога, который начинается с сообщения: " +
    `«${args.firstMessage.slice(0, 400)}». ` +
    "Ответь только названием на языке сообщения, без кавычек, пояснений и точки в конце.";

  // print-режим ждёт ввода, если stdin — закрытый дескриптор: подставляем /dev/null.
  const devNull = fs.openSync(os.devNull, "r");
  const child = spawnPortable(launcher.command, [...launcher.prefixArgs, "--print", "--no-session", ask], {
    cwd: args.cwd,
    env: { ...process.env, ...launcher.env, NO_COLOR: "1", PATH: pathWithBin(launcher.command) },
    stdio: [devNull, "pipe", "pipe"],
  });

  return new Promise<string | null>((resolve) => {
    let out = "";
    const stop = setTimeout(() => child.kill(), 120_000);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => (out += chunk));

    const done = (value: string | null) => {
      clearTimeout(stop);
      try {
        fs.closeSync(devNull);
      } catch {
        // Уже закрыт — не страшно.
      }
      resolve(value);
    };

    child.on("error", () => done(null));
    child.on("close", (code) => {
      if (code !== 0) return done(null);
      const title = out
        .trim()
        .split("\n")
        .pop()
        ?.replace(/^["«»']+|["«»'.]+$/g, "")
        .trim();
      done(title && title.length > 0 && title.length <= 80 ? title : null);
    });
  });
});

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * Картинки читаются в base64 — их видит модель. Остальные файлы передаются
 * путём: operator прочитает их сам, целиком или нужными частями.
 */
async function readAttachments(filePaths: string[]) {
  const attachments = [];
  for (const filePath of filePaths) {
    const name = path.basename(filePath);

    // Папку агент обходит сам — передаём путь и честно помечаем, что это папка.
    try {
      if ((await fs.promises.stat(filePath)).isDirectory()) {
        attachments.push({ kind: "folder" as const, path: filePath, name });
        continue;
      }
    } catch {
      // Не прочитали — дальше разберёмся по расширению.
    }

    const mimeType = IMAGE_TYPES[path.extname(filePath).toLowerCase()];
    if (!mimeType) {
      attachments.push({ kind: "file" as const, path: filePath, name });
      continue;
    }

    try {
      const bytes = await fs.promises.readFile(filePath);
      attachments.push({
        kind: "image" as const,
        path: filePath,
        name,
        mimeType,
        data: bytes.toString("base64"),
      });
    } catch {
      attachments.push({ kind: "file" as const, path: filePath, name });
    }
  }
  return attachments;
}

ipcMain.handle("dialog:pickFiles", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    defaultPath: os.homedir(),
    title: "Прикрепить файлы",
  });
  return result.canceled ? [] : readAttachments(result.filePaths);
});

ipcMain.handle("files:attach", (_e, args: { paths: string[] }) =>
  readAttachments(args.paths ?? []),
);

// Файлы, прикреплённые при запуске: OPERATOR_DESK_ATTACH="a.png:b.md"
ipcMain.handle("app:initialAttachments", () => {
  const raw = process.env.OPERATOR_DESK_ATTACH;
  if (!raw) return [];
  return readAttachments(raw.split(path.delimiter).filter(Boolean));
});

ipcMain.handle("dialog:pickFolder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    defaultPath: os.homedir(),
    title: "Рабочая папка линии",
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("app:home", () => os.homedir());

// Стартовое задание из окружения: OPERATOR_DESK_PROMPT="..." operator-desk
ipcMain.handle("app:initialPrompt", () => process.env.OPERATOR_DESK_PROMPT ?? null);

function stopAllLines(): void {
  quitting = true;
  for (const line of lines.values()) line.stop();
  lines.clear();
}

app.on("window-all-closed", () => {
  stopAllLines();
  if (!IS_MAC) app.quit();
});

// Ctrl+C в терминале разработки и обычное завершение системой.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopAllLines();
    app.quit();
  });
}

// Перед выходом линии тоже гасим: закрытие окна — не единственный путь.
app.on("before-quit", stopAllLines);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.whenReady().then(() => {
  protocol.handle("app", async (request) => {
    const { pathname } = new URL(request.url);
    const target = path.join(RENDERER_DIST, decodeURIComponent(pathname));
    if (!target.startsWith(RENDERER_DIST)) {
      return new Response("forbidden", { status: 403 });
    }
    const response = await net.fetch(`file://${target}`);
    const headers = new Headers(response.headers);
    headers.set(
      "Content-Security-Policy",
      "default-src 'self' app:; style-src 'self' app: 'unsafe-inline'; " +
        "img-src 'self' app: data:; font-src 'self' app: data:;",
    );
    return new Response(response.body, { status: response.status, headers });
  });
  installMenu();
  createWindow();
});
