import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";

type Listener<T> = (payload: T) => void;

function subscribe<T>(channel: string, listener: Listener<T>): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}

contextBridge.exposeInMainWorld("operator", {
  /** Система: на macOS шапке нужен отступ под кнопки окна. */
  platform: process.platform,
  open: (args: { id: string; cwd: string; provider?: string; model?: string }) =>
    ipcRenderer.invoke("line:open", args),
  send: <T>(id: string, command: string, payload?: Record<string, unknown>): Promise<T> =>
    ipcRenderer.invoke("line:send", { id, command, payload }),
  close: (id: string) => ipcRenderer.invoke("line:close", { id }),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("dialog:pickFolder"),
  pickFiles: () => ipcRenderer.invoke("dialog:pickFiles"),
  listSessions: () => ipcRenderer.invoke("sessions:list"),
  markSession: (sessionFile: string) => ipcRenderer.invoke("sessions:mark", { sessionFile }),
  renameSession: (path: string, name: string) => ipcRenderer.invoke("sessions:rename", { path, name }),
  deleteSession: (path: string, title: string) => ipcRenderer.invoke("sessions:delete", { path, title }),
  exportSession: (path: string, title: string, format: "html" | "json") =>
    ipcRenderer.invoke("sessions:export", { path, title, format }),
  reveal: (path: string) => ipcRenderer.invoke("shell:reveal", { path }),
  linkPreview: (url: string) => ipcRenderer.invoke("link:preview", { url }),
  openLink: (url: string) => ipcRenderer.invoke("link:open", { url }),
  generateTitle: (firstMessage: string, cwd: string): Promise<string | null> =>
    ipcRenderer.invoke("session:title", { firstMessage, cwd }),
  attachPaths: (paths: string[]) => ipcRenderer.invoke("files:attach", { paths }),
  // Путь перетащенного файла достаётся только так: File.path из Electron убран.
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  home: (): Promise<string> => ipcRenderer.invoke("app:home"),
  initialPrompt: (): Promise<string | null> => ipcRenderer.invoke("app:initialPrompt"),
  initialAttachments: () => ipcRenderer.invoke("app:initialAttachments"),
  onEvent: (listener: Listener<{ id: string; event: Record<string, unknown> }>) =>
    subscribe("line:event", listener),
  onBridgeSignal: (listener: Listener<{ id: string; signal: Record<string, unknown> }>) =>
    subscribe("bridge:signal", listener),
  onBridgeAsk: (listener: Listener<{ id: string; request: Record<string, unknown> }>) =>
    subscribe("bridge:ask", listener),
  respondUI: (id: string, requestId: string, payload: Record<string, unknown>) =>
    ipcRenderer.invoke("line:respondUI", { id, requestId, payload }),
  checkReadiness: () => ipcRenderer.invoke("app:readiness"),
  takeShot: (file: string): Promise<string | null> => ipcRenderer.invoke("screen:takeShot", { file }),
  getPolicy: () => ipcRenderer.invoke("policy:get"),
  listKeys: () => ipcRenderer.invoke("keys:list"),
  setKey: (provider: string, key: string) => ipcRenderer.invoke("keys:set", { provider, key }),
  removeKey: (provider: string) => ipcRenderer.invoke("keys:remove", { provider }),
  listPlugins: () => ipcRenderer.invoke("plugins:list"),
  catalogIcons: (manifests: Array<Record<string, unknown>>) =>
    ipcRenderer.invoke("plugins:catalogIcons", { manifests }),
  onPluginIcons: (listener: () => void) => subscribe("plugins:icons", listener),
  togglePlugin: (id: string, enabled: boolean) =>
    ipcRenderer.invoke("plugins:toggle", { id, enabled }),
  savePluginSettings: (id: string, values: Record<string, unknown>) =>
    ipcRenderer.invoke("plugins:settings", { id, values }),
  installPlugin: () => ipcRenderer.invoke("plugins:install"),
  addPlugin: (manifest: Record<string, unknown>) => ipcRenderer.invoke("plugins:add", { manifest }),
  removePlugin: (id: string, name: string) => ipcRenderer.invoke("plugins:remove", { id, name }),
  revealPlugins: () => ipcRenderer.invoke("plugins:reveal"),
  setPolicy: (policy: Record<string, unknown>) => ipcRenderer.invoke("policy:set", policy),
  rememberRule: (tool: string, subject: string) =>
    ipcRenderer.invoke("policy:remember", { tool, subject }),
  restoreCheckpoint: (id: string, file: string, existed: boolean) =>
    ipcRenderer.invoke("checkpoint:restore", { id, file, existed }),
  onFatal: (listener: Listener<{ id: string; message: string }>) => subscribe("line:fatal", listener),
  onExit: (listener: Listener<{ id: string; code: number | null; stderr: string }>) =>
    subscribe("line:exit", listener),
});
