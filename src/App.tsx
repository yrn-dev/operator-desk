import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { Transcript } from "./components/Transcript.tsx";
import { Composer } from "./components/Composer.tsx";
import { PermissionDialog } from "./components/PermissionDialog.tsx";
import { Plugins } from "./components/Plugins.tsx";
import { KeysDialog } from "./components/KeysDialog.tsx";
import { Readiness } from "./components/Readiness.tsx";
import { UsageDialog } from "./components/UsageDialog.tsx";
import { SubagentPanel } from "./components/SubagentPanel.tsx";
import { SoundSettings } from "./components/SoundSettings.tsx";
import { NotificationEvents } from "./notificationEvents.ts";
import { playNotificationSound } from "./notificationSounds.ts";
import { applyEvent, entriesFromMessages, errorNote, note, speak } from "./lineReducer.ts";
import { indexPluginTools } from "./pluginTools.ts";
import type {
  Attachment,
  Checkpoint,
  LineState,
  ModelInfo,
  Job,
  PluginInfo,
  PluginStatus,
  PermissionAsk,
  Policy,
  ScreenEnv,
  SessionSummary,
  SlashCommand,
  ToolRun,
} from "./types.ts";

const MAX_SESSIONS = 8;

export function App() {
  const [lines, setLines] = useState<Map<string, LineState>>(new Map());
  const [order, setOrder] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeLineId = useRef(activeId);
  activeLineId.current = activeId;
  const modelRefresh = useRef<Promise<void> | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [history, setHistory] = useState<SessionSummary[]>([]);
  const [historyBusy, setHistoryBusy] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<Attachment[]>([]);
  const [policy, setPolicy] = useState<Policy>({ rules: [] });
  const [screenEnv, setScreenEnv] = useState<ScreenEnv | null>(null);
  const [asks, setAsks] = useState<PermissionAsk[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [pluginStatuses, setPluginStatuses] = useState<PluginStatus[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [readyOpen, setReadyOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [soundsOpen, setSoundsOpen] = useState(false);
  const [notifications] = useState(() => new NotificationEvents());
  const openSounds = useCallback(() => setSoundsOpen(true), []);
  const closeSounds = useCallback(() => setSoundsOpen(false), []);
  const [latestVersion, setLatestVersion] = useState<{ version: string; url: string; sha512: string; kind: "nsis" | "appimage" | "deb" | "pacman"; notes?: string } | null>(null);
  const [updateProgress, setUpdateProgress] = useState<{ received: number; total: number } | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<{ lineId: string; toolId: string } | null>(null);
  const [inspectionRevision, setInspectionRevision] = useState(0);
  const [subagentPanelOpen, setSubagentPanelOpen] = useState(true);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);
  const previousSubagentCount = useRef(0);
  const counter = useRef(0);
  const kickoff = useRef(false);
  const homeDir = useRef("");
  const pluginForTool = useMemo(() => indexPluginTools(plugins, pluginStatuses), [plugins, pluginStatuses]);

  useEffect(() => {
    let live = true;
    const refresh = () => {
      void window.operator.listPlugins().then((items) => {
        if (live) setPlugins(items);
      }).catch(() => {});
    };
    const off = window.operator.onPluginIcons(refresh);
    refresh();
    return () => { live = false; off(); };
  }, [mcpOpen]);

  const patch = useCallback((id: string, change: (line: LineState) => LineState) => {
    setLines((prev) => {
      const line = prev.get(id);
      if (!line) return prev;
      const changed = change(line);
      if (changed === line) return prev;
      const next = new Map(prev);
      next.set(id, changed);
      return next;
    });
  }, []);

  const refreshHistory = useCallback(() => {
    setHistoryBusy(true);
    window.operator
      .listSessions()
      .then((items) => setHistory(items))
      .finally(() => setHistoryBusy(false));
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    window.operator.getPolicy().then(setPolicy);
    window.operator.checkReadiness().then((report) => {
      if (report.items.some((item) => item.required && !item.ok)) setReadyOpen(true);
    });
  }, []);

  useEffect(() => {
    void window.operator.usagePreference().then((pref) => {
      if (pref.configured && pref.enabled === null) setUsageOpen(true);
    });
    void window.operator.latestVersion().then(setLatestVersion);
    const offProgress = window.operator.onUpdateProgress(setUpdateProgress);
    return offProgress;
  }, []);

  const installUpdate = useCallback(() => {
    setUpdateError(null);
    setUpdateProgress({ received: 0, total: 0 });
    void window.operator.installUpdate().catch((error) => {
      setUpdateError(error instanceof Error ? error.message : String(error));
      setUpdateProgress(null);
    });
  }, []);

  // Запросы разрешений и служебные сигналы моста.
  useEffect(() => {
    const offAsk = window.operator.onBridgeAsk(({ id, request }) => {
      if (request.method !== "select" && request.method !== "confirm") return;
      const cue = notifications.question(id, request.id);
      if (cue) void playNotificationSound(cue);
      setAsks((prev) => prev.some(ask => ask.lineId === id && ask.requestId === request.id) ? prev : [
        ...prev,
        {
          requestId: request.id,
          lineId: id,
          title: String(request.title ?? "Разрешить действие?"),
          options: Array.isArray(request.options)
            ? request.options
            : ["Разрешить", "Отклонить"],
        },
      ]);
    });

    const offSignal = window.operator.onBridgeSignal(({ signal }) => {
      if (signal.kind === "file-inspection") setInspectionRevision((value) => value + 1);
      if (signal.kind === "checkpoint") {
        setCheckpoints((prev) => [
          { id: signal.id, tool: signal.tool, file: signal.file, existed: signal.existed, at: signal.at },
          ...prev,
        ].slice(0, 50));
      }
      if (signal.kind === "ready" && signal.screen) {
        setScreenEnv(signal.screen as ScreenEnv);
      }
      if (signal.kind === "plugins" && Array.isArray(signal.plugins)) {
        setPluginStatuses(signal.plugins as PluginStatus[]);
      }
      if (signal.kind === "job") {
        setJobs((prev) => {
          if (signal.action === "start") {
            return [...prev, { id: signal.id, name: signal.name, alive: true }];
          }
          return prev.map((job) => (job.id === signal.id ? { ...job, alive: false } : job));
        });
      }
      if (signal.kind === "remember") {
        window.operator.rememberRule(signal.tool, signal.subject).then(setPolicy);
      }
    });

    return () => {
      offAsk();
      offSignal();
    };
  }, [notifications]);

  /**
   * Файл сессии у новой ленты появляется не при открытии, а когда оператор
   * впервые пишет на диск, — поэтому путь переспрашиваем после каждого хода.
   */
  const syncSessionFile = useCallback(
    async (id: string) => {
      try {
        const state = await window.operator.send<any>(id, "get_state");
        const file = state?.sessionFile;
        if (!file) return;
        window.operator.markSession(file);
        patch(id, (line) => (line.sessionFile === file ? line : { ...line, sessionFile: file }));
      } catch {
        // Линия закрыта — обновлять нечего.
      }
    },
    [patch],
  );

  // Поток событий из процессов operator.
  useEffect(() => {
    const pendingUpdates = new Map<string, Record<string, any>>();
    let updateFrame = 0;
    const flushUpdates = () => {
      if (updateFrame) cancelAnimationFrame(updateFrame);
      updateFrame = 0;
      for (const [id, event] of pendingUpdates) patch(id, (line) => applyEvent(line, event));
      pendingUpdates.clear();
    };
    const offEvent = window.operator.onEvent(({ id, event }) => {
      if (event.type === "message_update") {
        pendingUpdates.set(id, event);
        if (!updateFrame) updateFrame = requestAnimationFrame(flushUpdates);
        return;
      }
      flushUpdates();
      const cue = notifications.event(id, event);
      if (cue) void playNotificationSound(cue);
      patch(id, (line) => applyEvent(line, event));
      if (event.type === "agent_end") {
        refreshHistory();
        void syncSessionFile(id);
      }
    });
    const offFatal = window.operator.onFatal(({ id, message }) => {
      notifications.cancel(id);
      patch(id, (line) => errorNote({ ...line, lamp: "off", sending: false, loading: false }, message));
    });
    const offExit = window.operator.onExit(({ id }) => {
      notifications.cancel(id);
      patch(id, (line) =>
        errorNote(
          { ...line, lamp: "off", sending: false, loading: false },
          "линия оборвалась",
        ),
      );
    });
    return () => {
      if (updateFrame) cancelAnimationFrame(updateFrame);
      offEvent();
      offFatal();
      offExit();
    };
  }, [patch, refreshHistory, syncSessionFile, notifications]);

  const openSession = useCallback(
    async (cwd: string, restore?: SessionSummary) => {
      // Opening history replaces an unused blank tab instead of keeping a
      // second idle agent (and its plugins) in memory. Busy tabs stay alive.
      const blankId = restore ? order.find((id) => {
        const line = lines.get(id);
        return line && line.entries.length === 0 && line.lamp === "ready" &&
          !line.loading && !line.sending && !line.compacting && !line.held?.length;
      }) : undefined;
      if (order.length >= MAX_SESSIONS && !blankId) return;
      if (blankId) {
        void window.operator.close(blankId);
        setLines((prev) => { const next = new Map(prev); next.delete(blankId); return next; });
        setOrder((prev) => prev.filter((id) => id !== blankId));
      }
      const id = `session-${++counter.current}`;
      const fresh: LineState = {
        id,
        label: restore ? restore.title : "Новый диалог",
        sessionFile: restore?.path,
        loading: Boolean(restore),
        cwd,
        lamp: "ready",
        entries: [],
        model: null,
        contextWindow: 258000,
        contextUsed: 0,
        thinkingLevel: "off",
        autoCompaction: true,
        showThinking: true,
      };
      setLines((prev) => new Map(prev).set(id, fresh));
      setOrder((prev) => [...prev, id]);
      setActiveId(id);

      await window.operator.open({ id, cwd });

      try {
        const state = await window.operator.send<any>(id, "get_state");
        if (state?.sessionFile) window.operator.markSession(state.sessionFile);
        patch(id, (line) => ({
          ...line,
          sessionFile: state?.sessionFile ?? line.sessionFile,
          model: state?.model ? { provider: state.model.provider, id: state.model.id } : line.model,
          contextWindow: state?.model?.contextWindow ?? line.contextWindow,
          thinkingLevel: state?.thinkingLevel ?? line.thinkingLevel,
        }));
        if (restore) {
          await window.operator.send(id, "switch_session", { sessionPath: restore.path });
          const payload = await window.operator.send<any>(id, "get_messages");
          patch(id, (line) => ({
            ...line,
            entries: entriesFromMessages(payload),
            loading: false,
          }));
        }

        if (models.length === 0) {
          // RPC отдаёт объект со списком, а не сам массив.
          const payload = await window.operator.send<any>(id, "get_available_models");
          const list = Array.isArray(payload) ? payload : payload?.models;
          setModels(Array.isArray(list) ? list : []);
        }

        if (commands.length === 0) {
          const payload = await window.operator.send<any>(id, "get_commands");
          const list = Array.isArray(payload) ? payload : payload?.commands;
          setCommands(Array.isArray(list) ? list : []);
        }

      } catch (error) {
        patch(id, (line) => errorNote({ ...line, loading: false }, error));
      }
    },
    [order, lines, models.length, commands.length, patch],
  );

  // Первая сессия — домашняя папка.
  useEffect(() => {
    let cancelled = false;
    window.operator.home().then((home) => {
      homeDir.current = home;
      if (!cancelled) openSession(home);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = activeId ? lines.get(activeId) : undefined;
  const refreshModels = useCallback(() => {
    if (!activeId || modelRefresh.current) return;
    const id = activeId;
    modelRefresh.current = window.operator.send<any>(id, "get_available_models").then(payload => {
      const list = Array.isArray(payload) ? payload : payload?.models;
      if (activeLineId.current === id && Array.isArray(list)) setModels(list);
    }).catch(() => {}).finally(() => { modelRefresh.current = null; });
  }, [activeId]);
  const selectTool = useCallback((run: ToolRun) => {
    if (run.name === "subagent") {
      setSelectedSubagentId(run.id);
      setSubagentPanelOpen(true);
    } else if (activeId) {
      setSelectedTool((current) => current?.lineId === activeId && current.toolId === run.id ? null : { lineId: activeId, toolId: run.id });
    }
  }, [activeId]);
  const closeTool = useCallback(() => setSelectedTool(null), []);
  const subagentRuns = useMemo(
    () => active?.entries.filter((entry): entry is ToolRun => entry.kind === "tool" && entry.name === "subagent") ?? [],
    [active?.entries],
  );

  useEffect(() => {
    if (subagentRuns.length > previousSubagentCount.current) setSubagentPanelOpen(true);
    previousSubagentCount.current = subagentRuns.length;
  }, [activeId, subagentRuns.length]);

  useEffect(() => { setSelectedSubagentId(null); }, [activeId]);
  const call = useCallback(
    async (command: string, payload?: Record<string, unknown>) => {
      if (!activeId) return null;
      try {
        return await window.operator.send(activeId, command, payload);
      } catch (error) {
        const message = String((error as Error).message);
        if (/nothing to compact|already compacted/i.test(message)) {
          patch(activeId, (line) => note(line, "Сжимать пока нечего: диалог ещё короткий."));
          return null;
        }
        if (command === "compact" && /compaction cancel(?:led|ed)|AbortError/i.test(message)) return null;
        // Ответа не будет — значит, «отправляется» снимать больше некому.
        patch(activeId, (line) => errorNote({ ...line, sending: false }, error));
        return null;
      }
    },
    [activeId, patch],
  );

  const nameSession = useCallback(
    async (id: string, cwd: string, firstMessage: string) => {
      const title = await window.operator.generateTitle(firstMessage, cwd);
      if (!title) return;
      patch(id, (line) => ({ ...line, label: title }));
      try {
        await window.operator.send(id, "set_session_name", { name: title });
      } catch {
        // Имя в ленте уже стоит; в файл сессии оно не попало — не критично.
      }
      refreshHistory();
    },
    [patch, refreshHistory],
  );

  const send = useCallback(
    (text: string, attachments: Attachment[] = []) => {
      if (!activeId || !active || active.lamp === "off") return;

      const files = attachments.filter((item) => item.kind === "file");
      const folders = attachments.filter((item) => item.kind === "folder");
      const images = attachments.filter((item) => item.kind === "image");

      // Картинки уходят модели напрямую, файлы и папки — путями: агент прочитает сам.
      const listed = [
        files.length ? `Прикреплённые файлы:\n${files.map((f) => f.path).join("\n")}` : "",
        folders.length ? `Прикреплённые папки:\n${folders.map((f) => f.path).join("\n")}` : "",
      ].filter(Boolean);
      const message = listed.length ? `${text}\n\n${listed.join("\n\n")}`.trim() : text;

      // Во время сжатия запрос оператор не примет — держим его до конца сжатия.
      if (active.compacting) {
        patch(activeId, (line) => ({
          ...speak(line, text, attachments),
          held: [...(line.held ?? []), { text: message, attachments: images }],
        }));
        return;
      }

      const first = active.entries.length === 0;
      const busy = active.lamp === "live";
      patch(activeId, (line) => ({ ...speak(line, text, attachments), sending: true }));
      if (first && text.trim()) {
        nameSession(activeId, active.cwd, text);
        // Файл сессии появляется на диске с первой записью — показываем её в списке.
        setTimeout(refreshHistory, 1500);
      }
      call(busy ? "steer" : "prompt", {
        message,
        images: images.map((item) => ({ type: "image", data: item.data, mimeType: item.mimeType })),
      });
    },
    [activeId, active, call, patch, nameSession, refreshHistory],
  );

  // Сжатие закончилось и линия свободна — отправляем то, что написали во время него.
  useEffect(() => {
    for (const [id, line] of lines) {
      if (!line.held?.length || line.compacting || line.lamp !== "ready" || line.sending) continue;
      const held = line.held;
      patch(id, (current) => ({ ...current, held: [], sending: true }));
      window.operator
        .send(id, "prompt", {
          message: held.map((item) => item.text).join("\n\n"),
          images: held
            .flatMap((item) => item.attachments)
            .flatMap((item) => (item.kind === "image" ? [{ type: "image", data: item.data, mimeType: item.mimeType }] : [])),
        })
        .catch((error: Error) => {
          patch(id, (current) => errorNote({ ...current, sending: false }, error));
        });
    }
  }, [lines, patch]);

  const closeSession = useCallback(
    (id: string) => {
      notifications.close(id);
      window.operator.close(id);
      setLines((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      setOrder((prev) => {
        const next = prev.filter((item) => item !== id);
        setActiveId((current) => (current === id ? (next[next.length - 1] ?? null) : current));
        return next;
      });
    },
    [notifications],
  );

  // Задание из OPERATOR_DESK_PROMPT уходит, как только первая сессия готова.
  useEffect(() => {
    if (kickoff.current || !activeId || !active?.model) return;
    kickoff.current = true;
    Promise.all([window.operator.initialPrompt(), window.operator.initialAttachments()]).then(
      ([text, attachments]) => {
        if (text || attachments.length) send(text ?? "", attachments);
      },
    );
  }, [activeId, active?.model, send]);

  return (
    <div
      style={{ display: "flex", height: "100%", background: "var(--bg)", position: "relative" }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setDragging(false);
        const paths = [...e.dataTransfer.files].map((file) => window.operator.pathForFile(file));
        if (paths.length === 0) return;
        const attachments = await window.operator.attachPaths(paths.filter(Boolean));
        setDropped((prev) => [...prev, ...attachments]);
      }}
    >
      {mcpOpen && <Plugins statuses={pluginStatuses} onClose={() => setMcpOpen(false)} />}

      {keysOpen && <KeysDialog models={models} onClose={() => setKeysOpen(false)} />}

      {readyOpen && <Readiness onClose={() => setReadyOpen(false)} />}

      {usageOpen && <UsageDialog onClose={() => setUsageOpen(false)} />}
      {soundsOpen && <SoundSettings onClose={closeSounds} />}

      {toast && (
        <div
          className="enter"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 28,
            transform: "translateX(-50%)",
            zIndex: 180,
            padding: "9px 14px",
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "var(--bg-raised)",
            boxShadow: "0 12px 30px rgba(0,0,0,.5)",
            fontSize: 12.5,
            color: "var(--text-muted)",
          }}
        >
          {toast}
        </div>
      )}

      {asks.length > 0 && (
        <PermissionDialog
          ask={asks[0]}
          onAnswer={(choice) => {
            const ask = asks[0];
            window.operator.respondUI(ask.lineId, ask.requestId, { value: choice });
            setAsks((prev) => prev.slice(1));
          }}
        />
      )}

      {dragging && (
        <div
          style={{
            position: "absolute",
            inset: 8,
            zIndex: 50,
            display: "grid",
            placeItems: "center",
            pointerEvents: "none",
            borderRadius: 14,
            border: "2px dashed var(--accent)",
            background: "rgba(247,244,240,.05)",
            color: "var(--accent)",
            fontSize: 14,
          }}
        >
          Отпустите файлы — прикреплю к сообщению
        </div>
      )}
      <Sidebar
        lines={lines}
        order={order}
        activeId={activeId}
        collapsed={sidebarCollapsed}
        history={history}
        historyBusy={historyBusy}
        onClose={closeSession}
        onOpenPlugins={() => setMcpOpen(true)}
        pluginCount={pluginStatuses.filter((item) => item.status === "ready").length}
        onRename={async (session, name) => {
          await window.operator.renameSession(session.path, name);
          // Открытая лента этой сессии тоже меняет заголовок.
          const opened = order.find((id) => lines.get(id)?.sessionFile === session.path);
          if (opened) patch(opened, (line) => ({ ...line, label: name }));
          refreshHistory();
        }}
        onDelete={async (session) => {
          const result = await window.operator.deleteSession(session.path, session.title);
          if (!result.ok) return;
          // Какие линии писали в этот файл, знает главный процесс: путь сессии
          // у новой ленты появляется уже после её открытия.
          const gone = new Set(result.closed ?? []);
          const opened = order.find((id) => lines.get(id)?.sessionFile === session.path);
          if (opened) gone.add(opened);
          for (const id of gone) closeSession(id);
          refreshHistory();
        }}
        onCopied={(message) => {
          setToast(message);
          setTimeout(() => setToast(null), 2600);
        }}
        onExport={async (session, format) => {
          const result = await window.operator.exportSession(session.path, session.title, format);
          if (result.ok && result.path) window.operator.reveal(result.path);
        }}
        onOpenHistory={(session) => {
          // Уже открытую сессию просто показываем, второй процесс не нужен.
          const opened = order.find((id) => lines.get(id)?.sessionFile === session.path);
          if (opened) setActiveId(opened);
          else openSession(session.cwd || homeDir.current, session);
        }}
        onNew={() => {
          // Пустая сессия уже открыта — просто показываем её.
          const blank = order.find((id) => lines.get(id)?.entries.length === 0);
          if (blank) setActiveId(blank);
          else openSession(active?.cwd ?? homeDir.current);
        }}
        onOpenFolder={async () => {
          const folder = await window.operator.pickFolder();
          if (folder) openSession(folder);
        }}
      />

      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar
          line={active}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          jobs={jobs}
          mcpCount={pluginStatuses.filter((item) => item.status === "ready").length}
          onOpenMcp={() => setMcpOpen(true)}
          onOpenReadiness={() => setReadyOpen(true)}
          onOpenUsage={() => setUsageOpen(true)}
          onOpenSounds={openSounds}
          subagentCount={subagentRuns.length}
          subagentsOpen={subagentPanelOpen}
          onToggleSubagents={() => setSubagentPanelOpen((open) => !open)}
          onCompact={() => call("compact")}
          onNewSession={async () => {
            if (activeId) patch(activeId, (line) => ({ ...line, entries: [], contextUsed: 0 }));
            await call("new_session");
            if (!activeId) return;
            const state = await call("get_state");
            const file = (state as any)?.sessionFile;
            if (file) {
              window.operator.markSession(file);
              patch(activeId, (line) => ({ ...line, sessionFile: file, label: "Новый диалог" }));
            }
            refreshHistory();
          }}
        />

        {latestVersion && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: "1px solid var(--line)", background: "var(--bg-raised)", color: "var(--text-muted)", fontSize: 12.5 }}>
            <span style={{ flex: 1 }}>Вышел Operator {latestVersion.version}{latestVersion.notes ? ` · ${latestVersion.notes}` : ""}{updateError ? ` · ${updateError}` : ""}</span>
            <button disabled={Boolean(updateProgress)} onClick={installUpdate} style={{ color: "var(--text)", textDecoration: "underline", opacity: updateProgress ? 0.6 : 1 }}>
              {updateProgress ? updateProgress.total ? `Загружаю ${Math.min(100, Math.round(updateProgress.received / updateProgress.total * 100))}%` : "Готовлю обновление…" : "Обновить сейчас"}
            </button>
            <button onClick={() => setLatestVersion(null)} aria-label="Скрыть уведомление" style={{ color: "var(--text-faint)", fontSize: 17 }}>×</button>
          </div>
        )}

        <Transcript
          key={activeId}
          pluginForTool={pluginForTool}
          onSelectTool={selectTool}
          selectedToolId={selectedTool?.lineId === activeId ? selectedTool.toolId : null}
          inspectionRevision={inspectionRevision}
          onCloseTool={closeTool}
          sending={active?.sending === true}
          compacting={active?.compacting === true}
          loading={active?.loading === true}
          entries={active?.entries ?? []}
          showThinking={active?.showThinking ?? true}
          cwd={active?.cwd}
        />

        <Composer
          busy={active?.lamp === "live"}
          incoming={dropped}
          onIncomingTaken={() => setDropped([])}
          commands={commands}
          line={active}
          models={models}
          onRefreshModels={refreshModels}
          onSetModel={(provider, id) => {
            if (activeId) {
              patch(activeId, (line) => ({
                ...line,
                model: { provider, id },
                contextWindow:
                  models.find((m) => m.id === id && m.provider === provider)?.contextWindow ??
                  line.contextWindow,
              }));
            }
            call("set_model", { provider, modelId: id });
          }}
          onSetThinking={(level) => {
            if (activeId) patch(activeId, (line) => ({ ...line, thinkingLevel: level }));
            call("set_thinking_level", { level });
          }}
          onOpenKeys={() => setKeysOpen(true)}
          autopilot={policy.computerUse === true}
          screenEnv={screenEnv}
          onAutopilotChange={(enabled) =>
            window.operator.setPolicy({ computerUse: enabled }).then(setPolicy)
          }
          checkpoints={checkpoints}
          onRestore={async (checkpoint) => {
            const result = await window.operator.restoreCheckpoint(
              checkpoint.id,
              checkpoint.file,
              checkpoint.existed,
            );
            if (result.ok) {
              setCheckpoints((prev) =>
                prev.map((item) => (item.id === checkpoint.id ? { ...item, restored: true } : item)),
              );
            }
          }}
          onSend={send}
          onAbort={() => { if (activeId) notifications.cancel(activeId); void call("abort"); }}
        />
      </main>
      {subagentRuns.length > 0 && subagentPanelOpen && (
        <SubagentPanel key={activeId ?? ""} runs={subagentRuns} selectedId={selectedSubagentId}
          onSelect={setSelectedSubagentId} onClose={() => setSubagentPanelOpen(false)} />
      )}
    </div>
  );
}
