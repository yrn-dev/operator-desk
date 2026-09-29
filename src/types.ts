export type Attachment =
  | { kind: "file"; path: string; name: string }
  | { kind: "folder"; path: string; name: string }
  | { kind: "image"; path: string; name: string; mimeType: string; data: string };

export type LampState = "off" | "ready" | "live";

export type ToolRun = {
  kind: "tool";
  id: string;
  name: string;
  args: Record<string, unknown>;
  output: string;
  done: boolean;
  failed: boolean;
  /** Время вызова и ответа — из них считается длительность в ленте. */
  startedAt?: number;
  endedAt?: number;
};

export type Say = {
  kind: "say";
  id: string;
  role: "user" | "operator";
  text: string;
  thinking: string;
  streaming: boolean;
  /** Что было прикреплено к реплике пользователя. */
  attachments?: Attachment[];
};

export type Note = {
  kind: "note";
  id: string;
  tone: "info" | "alarm";
  text: string;
};

export type Entry = Say | ToolRun | Note;

export type LineState = {
  id: string;
  label: string;
  cwd: string;
  lamp: LampState;
  entries: Entry[];
  model: { provider: string; id: string } | null;
  contextWindow: number;
  contextUsed: number;
  thinkingLevel: string;
  /** Файл сессии оператора: связывает открытую ленту со строкой истории. */
  sessionFile?: string;
  /** Лента ещё читается из файла сессии. */
  loading?: boolean;
  /** Сообщение отправлено, но модель ещё не начала отвечать. */
  sending?: boolean;
  /** Оператор сжимает контекст: сам по переполнению или по кнопке. */
  compacting?: boolean;
  /** Сообщения, написанные во время сжатия, — уйдут, как только оно закончится. */
  held?: { text: string; attachments: Attachment[] }[];
  autoCompaction: boolean;
  showThinking: boolean;
};

/** Карточка ссылки из ответа модели. Картинки — data: URL. */
export type LinkPreview = {
  url: string;
  host: string;
  title: string;
  image: string | null;
  icon: string | null;
};

export type SessionSummary = {
  path: string;
  cwd: string;
  title: string;
  updatedAt: string;
  origin: "desk" | "cli";
};

export type SlashCommand = {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
};

export type ReadinessItem = {
  id: string;
  required: boolean;
  ok: boolean;
  detail: string;
  fix: string | null;
};

export type ReadinessReport = { items: ReadinessItem[] };

export type ScreenEnv = { screenshot: string[]; input: string | null; missing: string[] };

export type Policy = {
  computerUse?: boolean;
  rules: Array<{ tool?: string; pattern?: string; action: "allow" | "ask" | "deny" }>;
};

export type PermissionAsk = {
  requestId: string;
  lineId: string;
  title: string;
  options: string[];
};

export type KeyEntry = { provider: string; type: string; hasKey: boolean; hint: string };

/** Плагин: свой код (tool) или внешний сервер по протоколу MCP. */
export type PluginInfo = {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  kind?: "tool" | "mcp";
  icon?: string;
  origin: "builtin" | "user";
  enabled: boolean;
  broken?: string;
  permissions?: string[];
  settings?: Array<{ key: string; label: string; hint?: string; secret?: boolean; default?: string }>;
  values: Record<string, unknown>;
  /** Для плагинов-серверов: чем он запускается. */
  command?: string;
  args?: string[];
  /** Найденный логотип: файл автора, официальный знак или аватар организации. */
  resolvedIcon?: PluginIcon | null;
};

export type PluginIcon =
  | { kind: "image"; src: string }
  | { kind: "brand"; title: string; hex: string; path: string };

/** Состояние плагина в работающей линии — приходит сигналом от моста. */
export type PluginStatus = {
  id: string;
  name: string;
  kind: string;
  status: "ready" | "error" | "off";
  tools: number;
  /** Инструменты известны из кеша, сам сервер ещё не запущен. */
  sleeping?: boolean;
  error?: string;
};

export type Job = { id: string; name: string; alive: boolean };

export type Checkpoint = {
  id: string;
  tool: string;
  file: string;
  existed: boolean;
  at: string;
  restored?: boolean;
};

export type ModelInfo = {
  provider: string;
  id: string;
  contextWindow: number;
  reasoning: boolean;
};

declare global {
  interface Window {
    operator: {
      open(args: { id: string; cwd: string; provider?: string; model?: string }): Promise<{ ok: boolean }>;
      send<T = unknown>(id: string, command: string, payload?: Record<string, unknown>): Promise<T>;
      close(id: string): Promise<{ ok: boolean }>;
      pickFolder(): Promise<string | null>;
      pickFiles(): Promise<Attachment[]>;
      listSessions(): Promise<SessionSummary[]>;
      markSession(sessionFile: string): Promise<{ ok: boolean }>;
      renameSession(path: string, name: string): Promise<{ ok: boolean }>;
      platform: NodeJS.Platform;
      listPlugins(): Promise<PluginInfo[]>;
      catalogIcons(manifests: Array<Record<string, unknown>>): Promise<Record<string, PluginIcon | null>>;
      onPluginIcons(listener: () => void): () => void;
      togglePlugin(id: string, enabled: boolean): Promise<{ ok: boolean }>;
      savePluginSettings(id: string, values: Record<string, unknown>): Promise<{ ok: boolean }>;
      installPlugin(): Promise<{ ok: boolean; id?: string; name?: string; error?: string; cancelled?: boolean }>;
      addPlugin(manifest: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>;
      removePlugin(id: string, name: string): Promise<{ ok: boolean; error?: string; cancelled?: boolean }>;
      revealPlugins(): Promise<{ ok: boolean }>;
      deleteSession(
        path: string,
        title: string,
      ): Promise<{ ok: boolean; cancelled?: boolean; closed?: string[] }>;
      exportSession(
        path: string,
        title: string,
        format: "html" | "json",
      ): Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>;
      reveal(path: string): Promise<void>;
      linkPreview(url: string): Promise<LinkPreview | null>;
      openLink(url: string): Promise<void>;
      generateTitle(firstMessage: string, cwd: string): Promise<string | null>;
      attachPaths(paths: string[]): Promise<Attachment[]>;
      pathForFile(file: File): string;
      home(): Promise<string>;
      initialPrompt(): Promise<string | null>;
      initialAttachments(): Promise<Attachment[]>;
      onEvent(listener: (payload: { id: string; event: Record<string, any> }) => void): () => void;
      onBridgeSignal(
        listener: (payload: { id: string; signal: Record<string, any> }) => void,
      ): () => void;
      onBridgeAsk(
        listener: (payload: { id: string; request: Record<string, any> }) => void,
      ): () => void;
      respondUI(id: string, requestId: string, payload: Record<string, unknown>): Promise<unknown>;
      checkReadiness(): Promise<ReadinessReport>;
      takeShot(file: string): Promise<string | null>;
      getPolicy(): Promise<Policy>;
      listKeys(): Promise<KeyEntry[]>;
      setKey(provider: string, key: string): Promise<{ ok: boolean; error?: string }>;
      removeKey(provider: string): Promise<{ ok: boolean }>;
      setPolicy(policy: Partial<Policy>): Promise<Policy>;
      rememberRule(tool: string, subject: string): Promise<Policy>;
      restoreCheckpoint(id: string, file: string, existed: boolean): Promise<{ ok: boolean }>;
      onFatal(listener: (payload: { id: string; message: string }) => void): () => void;
      onExit(listener: (payload: { id: string; code: number | null; stderr: string }) => void): () => void;
    };
  }
}
