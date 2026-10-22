import { BrowserWindow } from "electron";
import crypto from "node:crypto";
import { browserPage } from "./browser-page.ts";

export type BrowserRequest = { action: string; tab?: string; url?: string; snapshot?: string; ref?: number; text?: string; value?: string; direction?: string };

export function browserURL(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192) throw new Error("A valid HTTP(S) URL is required.");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only HTTP(S) URLs without embedded credentials are supported.");
  return url.href;
}

/** Windows belong to one agent line, never to the user's existing browser profile. */
export class AgentBrowser {
  private tabs = new Map<string, BrowserWindow>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private partition = `operator-browser-${crypto.randomUUID()}`;
  private loadErrors = new Map<string, string>();
  constructor(private enabled: () => boolean) {}

  execute(input: BrowserRequest, active: () => boolean = () => true) {
    const result = this.queue.then(() => {
      if (this.closed) throw new Error("Browser session is closed.");
      if (!active()) throw new Error("Browser request expired or was cancelled.");
      if (!this.enabled()) throw new Error("Автопилот выключен. Включите его рядом с полем ввода.");
      return this.run(input);
    });
    this.queue = result.catch(() => {});
    return result;
  }

  close() {
    this.closed = true;
    for (const win of this.tabs.values()) if (!win.isDestroyed()) win.destroy();
    this.tabs.clear();
  }

  private list() {
    return [...this.tabs].filter(([, w]) => !w.isDestroyed()).map(([tab, w]) => ({ tab, title: w.webContents.getTitle(), url: w.webContents.getURL() }));
  }

  private async page(win: BrowserWindow, input: BrowserRequest) {
    // Renderer crypto.randomUUID is unavailable on non-local HTTP origins.
    // Generate observation IDs in Node, without exposing Node to the page.
    const snapshotId = crypto.randomUUID();
    // JSON encoding prevents field values from becoming executable source code.
    const result = await win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `(() => { try { return (${browserPage.toString()})(${JSON.stringify(input)}, ${JSON.stringify(snapshotId)}); } catch (error) { return { __operatorError: String(error.message || error) }; } })()` }], ["click", "fill", "select"].includes(input.action));
    if (result?.__operatorError) throw new Error(result.__operatorError);
    return result;
  }

  private async observe(tab: string, win: BrowserWindow, wait = 15000) {
    // Yield one task so a click-triggered navigation can enter loading state.
    await new Promise(resolve => setTimeout(resolve, 0));
    const deadline = Date.now() + wait;
    while (!win.isDestroyed() && win.webContents.isLoadingMainFrame() && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (win.isDestroyed()) throw new Error("Browser window was closed.");
    if (win.webContents.isLoadingMainFrame()) return { tab, loading: true, url: win.webContents.getURL(), message: "Page is still loading. Call snapshot before interacting." };
    if (this.loadErrors.has(tab)) return { tab, error: this.loadErrors.get(tab), url: win.webContents.getURL() };
    return { tab, loading: false, ...await this.page(win, { action: "snapshot" }) };
  }

  private async navigation(win: BrowserWindow, start: () => void) {
    await new Promise<void>(resolve => {
      const contents = win.webContents;
      const done = () => {
        clearTimeout(timer);
        contents.removeListener("did-stop-loading", done);
        contents.removeListener("did-navigate-in-page", done);
        contents.removeListener("destroyed", done);
        resolve();
      };
      const timer = setTimeout(done, 15000);
      contents.once("did-stop-loading", done);
      contents.once("did-navigate-in-page", done);
      contents.once("destroyed", done);
      start();
    });
  }

  private async run(input: BrowserRequest): Promise<unknown> {
    if (input.action === "tabs") return { tabs: this.list() };
    if (input.action === "open") {
      const url = browserURL(input.url);
      if (this.tabs.size >= 8) throw new Error("Close an existing browser tab before opening another (limit 8).");
      const tab = crypto.randomUUID();
      const win = new BrowserWindow({ width: 1200, height: 850, title: "Operator · Browser", webPreferences: {
        partition: this.partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      } });
      win.removeMenu();
      const browserSession = win.webContents.session;
      win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      win.webContents.session.setPermissionCheckHandler(() => false);
      const blockDownload = (event: Electron.Event) => event.preventDefault();
      win.webContents.session.on("will-download", blockDownload);
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event, next) => { try { browserURL(next); } catch { event.preventDefault(); } });
      win.webContents.on("will-redirect", (event, next) => { try { browserURL(next); } catch { event.preventDefault(); } });
      win.webContents.on("did-start-navigation", (_event, _url, _inPlace, mainFrame) => { if (mainFrame) this.loadErrors.delete(tab); });
      win.webContents.on("did-fail-load", (_event, code, message, _url, mainFrame) => { if (mainFrame && code !== -3) this.loadErrors.set(tab, message); });
      win.on("closed", () => {
        browserSession.removeListener("will-download", blockDownload);
        this.tabs.delete(tab);
        this.loadErrors.delete(tab);
      });
      this.tabs.set(tab, win);
      // Do not wait indefinitely for a site; observe reports a still-loading page.
      await this.navigation(win, () => { void win.loadURL(url).catch(() => {}); });
      return this.observe(tab, win, 0);
    }
    const win = this.tabs.get(input.tab ?? "");
    if (!win || win.isDestroyed()) throw new Error("Unknown tab. Use tabs or open first.");
    const tab = input.tab!;
    if (input.action === "close") { win.destroy(); return { closed: tab, tabs: this.list() }; }
    if (input.action === "navigate") {
      const url = browserURL(input.url);
      await this.navigation(win, () => { void win.loadURL(url).catch(() => {}); });
    } else if (input.action === "back") {
      if (win.webContents.navigationHistory.canGoBack()) await this.navigation(win, () => win.webContents.navigationHistory.goBack());
    } else if (input.action !== "snapshot") {
      if (!["click", "fill", "select", "scroll"].includes(input.action)) throw new Error("Unsupported browser action.");
      if (!this.enabled()) throw new Error("Автопилот выключен.");
      try { await this.page(win, input); }
      catch (error) {
        // Never repeat an action after a navigation/context error: it may have succeeded.
        return { error: String(error), actionOutcome: "Check the refreshed page before retrying.", ...await this.observe(tab, win) };
      }
    }
    return this.observe(tab, win, ["navigate", "back"].includes(input.action) ? 0 : 15000);
  }
}
