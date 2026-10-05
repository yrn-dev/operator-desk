import type { PluginInfo, ToolRun } from "./types.ts";

export type ToolPresentation = {
  title: string;
  action: string;
  subject?: string;
  parameters: Array<{ label: string; value: string }>;
  resultKind: "time" | "list" | "code" | "terminal" | "fields" | "text" | "empty" | "file";
  resultTitle: string;
  primary?: string;
  details?: string;
  items?: string[];
  fields?: Array<{ label: string; value: string }>;
  links?: string[];
};

const LABELS: Record<string, string> = {
  timezone: "Часовой пояс", datetime: "Дата и время", day_of_week: "День недели",
  is_dst: "Летнее время", credits: "Кредиты", balance: "Баланс", plan: "Тариф",
  url: "Адрес", title: "Заголовок", status: "Статус", message: "Сообщение",
  name: "Имя", login: "Логин", count: "Количество", total: "Всего",
  remaining: "Осталось", path: "Путь", file_path: "Путь", query: "Запрос",
  command: "Команда", pattern: "Шаблон", error: "Ошибка", description: "Описание",
  email: "Электронная почта", html_url: "Профиль", date: "Дата", time: "Время",
};

function label(key: string): string {
  return LABELS[key] ?? key.replace(/[_-]/g, " ").replace(/^./, (char) => char.toUpperCase());
}

const OBJECTS: Record<string, string> = {
  image: "изображение", images: "изображения", video: "видео", videos: "видео",
  file: "файл", files: "файлы", folder: "папку", folders: "папки",
  project: "проект", projects: "проекты", user: "пользователя", users: "пользователей",
  account: "аккаунт", accounts: "аккаунты", profile: "профиль", status: "статус",
  usage: "расход", credits: "кредиты", balance: "баланс", model: "модель",
  models: "модели", task: "задачу", tasks: "задачи", result: "результат",
  results: "результаты", document: "документ", documents: "документы",
  page: "страницу", pages: "страницы", me: "профиль", info: "сведения",
};

function humanAction(name: string): string {
  const parts = name.split(/[_-]/).filter(Boolean);
  const verb = parts.shift() ?? "";
  const object = parts.map((part) => OBJECTS[part] ?? part).join(" ");
  const verbs: Record<string, string> = {
    get: "Запросил", read: "Прочитал", list: "Получил список", search: "Искал",
    find: "Искал", create: "Создал", add: "Добавил", update: "Обновил",
    edit: "Изменил", delete: "Удалил", remove: "Удалил", send: "Отправил",
    check: "Проверил", open: "Открыл", fetch: "Загрузил", download: "Скачал",
  };
  return verbs[verb] && object ? `${verbs[verb]} ${object}` : `Выполнил действие «${name.replace(/_/g, " ")}»`;
}

function scalar(value: unknown): string {
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(scalar).join(", ");
  return JSON.stringify(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseOutput(output: string): unknown {
  const clean = output.trim();
  if (/^<!doctype html|^<html[\s>]/i.test(clean)) return clean
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
  if (!clean || !/^[\[{]/.test(clean)) return clean;
  try {
    const parsed: unknown = JSON.parse(clean);
    const data = record(parsed);
    // MCP sometimes serializes a content envelope inside a text result.
    if (Array.isArray(data?.content)) {
      const texts = data.content.filter((item) => record(item)?.type === "text")
        .map((item) => String(record(item)?.text ?? ""));
      if (texts.length === 1) return parseOutput(texts[0]);
    }
    return parsed;
  } catch {
    return clean;
  }
}

function linksFrom(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s"'<>)\\]+/g) ?? [])].slice(0, 10);
}

function formatTime(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone, day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(date);
  } catch { return value; }
}

function resultFields(data: Record<string, unknown>): Array<{ label: string; value: string }> {
  return Object.entries(data).filter(([, value]) => value != null && !Array.isArray(value) &&
    (typeof value !== "object") && String(value).length < 500)
    .slice(0, 18).map(([key, value]) => ({ label: label(key), value: scalar(value) }));
}

function nestedFields(data: Record<string, unknown>): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = [];
  for (const [section, value] of Object.entries(data)) {
    const inner = record(value);
    if (!inner) continue;
    for (const [key, item] of Object.entries(inner)) {
      if (item == null || typeof item === "object" || String(item).length > 500) continue;
      fields.push({ label: `${label(section)} · ${label(key)}`, value: scalar(item) });
      if (fields.length >= 18) return fields;
    }
  }
  return fields;
}

function resultItems(value: unknown): string[] {
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => {
    const itemRecord = record(item);
    if (!itemRecord) return scalar(item);
    const main = itemRecord.title ?? itemRecord.name ?? itemRecord.path ?? itemRecord.url ?? itemRecord.message;
    return main != null ? scalar(main) : Object.entries(itemRecord).slice(0, 3).map(([key, value]) => `${label(key)}: ${scalar(value)}`).join(" · ");
  });
  if (typeof value === "string") return value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 80);
  return [];
}

export function presentTool(run: ToolRun, plugin?: PluginInfo): ToolPresentation {
  const leaf = run.name.split("__").at(-1) ?? run.name;
  const name = leaf.toLowerCase();
  const args = run.args ?? {};
  const output = parseOutput(run.output);
  const data = record(output);
  const arg = (key: string) => typeof args[key] === "string" ? String(args[key]) : "";
  const path = arg("path") || arg("file_path") || arg("file");
  const url = arg("url") || arg("uri") || arg("link");
  const query = arg("query") || arg("q") || arg("search_query") || arg("pattern");
  const parameters = Object.entries(args).filter(([key, value]) => !["content", "edits", "oldText", "newText", "command"].includes(key) &&
    value != null && scalar(value).length < 220).slice(0, 8)
    .map(([key, value]) => ({ label: label(key), value: scalar(value) }));
  const base: ToolPresentation = {
    title: humanAction(name),
    action: plugin ? `${humanAction(name)} через ${plugin.name ?? plugin.id}` : humanAction(name),
    parameters,
    resultKind: "empty",
    resultTitle: "Результат",
  };

  if (name === "bash") {
    Object.assign(base, { title: "Выполнил команду", action: "Запустил команду в терминале", subject: arg("command"), resultKind: "terminal", resultTitle: "Вывод команды" });
  } else if (name === "background_run") {
    Object.assign(base, { title: "Запустил фоновую задачу", action: "Запустил команду в фоне", subject: arg("command"), resultKind: "text", resultTitle: "Состояние задачи" });
  } else if (name === "background_check" || name === "background_stop") {
    Object.assign(base, { title: name === "background_check" ? "Проверил фоновую задачу" : "Остановил фоновую задачу", action: name === "background_check" ? "Проверил выполнение фоновой команды" : "Остановил выполнение фоновой команды", resultKind: "text", resultTitle: "Состояние задачи" });
  } else if (name === "computer") {
    const action = arg("action");
    const actions: Record<string, string> = { screenshot: "Сделал снимок экрана", click: "Нажал на экран", type: "Ввёл текст", key: "Нажал клавиши", scroll: "Прокрутил экран", open: "Открыл приложение", windows: "Получил список окон", wait: "Подождал" };
    Object.assign(base, { title: actions[action] ?? "Управлял компьютером", action: actions[action] ?? `Выполнил действие ${action || "на компьютере"}`, subject: arg("app") || arg("text"), resultKind: "text", resultTitle: "Что произошло" });
  } else if (name === "subagent") {
    Object.assign(base, { title: "Запустил помощника", action: "Передал подзадачу отдельному агенту", subject: arg("task") || arg("prompt"), resultKind: "text", resultTitle: "Ответ помощника" });
  } else if (name === "github") {
    const action = arg("action");
    const actions: Record<string, string> = { pr_create: "Создал пул-реквест", pr_list: "Посмотрел пул-реквесты", pr_view: "Открыл пул-реквест", pr_checks: "Проверил статусы PR", pr_diff: "Посмотрел изменения PR" };
    Object.assign(base, { title: actions[action] ?? "Работал с GitHub", action: actions[action] ?? "Выполнил действие в GitHub", subject: arg("title") || (args.number != null ? `PR №${args.number}` : ""), resultKind: "text", resultTitle: "Ответ GitHub" });
  } else if (name === "clipboard_read" || name === "clipboard_write") {
    Object.assign(base, { title: name === "clipboard_read" ? "Прочитал буфер обмена" : "Скопировал текст", action: name === "clipboard_read" ? "Получил скопированный текст" : "Положил текст в буфер обмена", resultKind: "text", resultTitle: name === "clipboard_read" ? "Скопированный текст" : "Результат" });
  } else if (name === "note_add" || name === "note_list") {
    Object.assign(base, { title: name === "note_add" ? "Сохранил заметку" : "Прочитал заметки", action: name === "note_add" ? "Добавил заметку проекта" : "Получил заметки проекта", subject: name === "note_add" ? arg("text") : arg("cwd"), resultKind: "text", resultTitle: name === "note_add" ? "Где сохранено" : "Заметки" });
  } else if (name === "notify") {
    Object.assign(base, { title: "Показал уведомление", action: "Вывел уведомление на рабочем столе", subject: arg("title") || "Operator", resultKind: "text", resultTitle: "Результат" });
  } else if (name === "read") {
    Object.assign(base, { title: "Прочитал файл", action: "Открыл содержимое файла", subject: path, resultKind: "code", resultTitle: "Содержимое файла" });
  } else if (/^(write|edit|patch|write_file|edit_file|patch_file|create_file)$/.test(name)) {
    const writes = /^(write|write_file|create_file)$/.test(name);
    Object.assign(base, { title: writes ? "Записал файл" : "Изменил файл", action: writes ? "Записал содержимое в файл" : "Изменил содержимое файла", subject: path, resultKind: "file", resultTitle: "Изменения" });
  } else if (name === "grep" || name === "find" || name === "ls" || /list_allowed_directories/.test(name)) {
    Object.assign(base, { title: name === "grep" ? "Нашёл строки" : name === "find" ? "Нашёл файлы" : /allowed_directories/.test(name) ? "Проверил доступные папки" : "Посмотрел папку", action: name === "grep" ? "Искал совпадения в файлах" : name === "find" ? "Искал файлы по шаблону" : /allowed_directories/.test(name) ? "Запросил папки, доступные плагину" : "Получил список файлов и папок", subject: query || path, resultKind: "list", resultTitle: /allowed_directories/.test(name) ? "Доступные папки" : "Найденное" });
  } else if (/current_time|^time$/.test(name)) {
    const timezone = String(data?.timezone ?? args.timezone ?? "");
    const datetime = String(data?.datetime ?? data?.time ?? output ?? "");
    Object.assign(base, { title: "Узнал текущее время", action: "Запросил местное время", subject: timezone, resultKind: "time", resultTitle: "Местное время", primary: formatTime(datetime, timezone), details: timezone });
  } else if (/balance|credits|quota/.test(name)) {
    Object.assign(base, { title: "Проверил баланс", action: `Запросил баланс в ${plugin?.name ?? "сервисе"}`, resultKind: "fields", resultTitle: "Баланс" });
  } else if (/get_me|profile|current_user/.test(name)) {
    Object.assign(base, { title: "Получил профиль", action: `Запросил данные аккаунта в ${plugin?.name ?? "сервисе"}`, resultKind: "fields", resultTitle: "Профиль" });
  } else if (/fetch|open_url|read_url|web_page|browse/.test(name)) {
    Object.assign(base, { title: "Открыл страницу", action: "Загрузил содержимое страницы", subject: url, resultKind: "text", resultTitle: "Что найдено" });
  } else if (/search/.test(name)) {
    Object.assign(base, { title: "Выполнил поиск", action: "Искал информацию", subject: query, resultKind: "list", resultTitle: "Результаты поиска" });
  } else if (/task_update|todo|plan/.test(name)) {
    Object.assign(base, { title: "Обновил план", action: "Записал шаги работы", resultKind: "fields", resultTitle: "План" });
  } else if (/^get_|^read_/.test(name)) {
    Object.assign(base, { title: humanAction(name), action: `${humanAction(name)} через ${plugin?.name ?? "инструмент"}`, resultKind: "fields" });
  } else if (/^create_|^add_|^update_|^edit_|^delete_|^remove_/.test(name)) {
    Object.assign(base, { title: humanAction(name), action: `${humanAction(name)} через ${plugin?.name ?? "инструмент"}`, resultKind: "fields" });
  }

  if (base.subject) base.parameters = base.parameters.filter((item) => item.value !== base.subject);

  if (base.resultKind === "file") return base;
  if (!run.done && !run.output) return { ...base, resultKind: "empty", details: "Инструмент ещё работает." };
  if (!run.output.trim()) return { ...base, resultKind: "empty", details: run.failed ? "Инструмент завершился с ошибкой без текстового ответа." : "Инструмент завершился без текстового ответа." };

  const links = linksFrom(`${JSON.stringify(args)} ${run.output.slice(0, 15000)}`);
  if (base.resultKind === "time") return { ...base, links };
  if (base.resultKind === "terminal" || base.resultKind === "code") return { ...base, links: /fetch|web/.test(name) ? links : [] };

  if (base.resultKind === "list") {
    const source = data?.results ?? data?.items ?? data?.files ?? data?.directories ?? data?.matches ?? output;
    const items = resultItems(source).filter((item) => !/^allowed directories:$/i.test(item));
    return { ...base, resultKind: items.length ? "list" : "text", items, details: items.length ? `${items.length} ${items.length === 1 ? "элемент" : "элементов"}` : scalar(output), links };
  }
  if (data) {
    const nested = record(data.data) ?? record(data.result);
    const fields = [...resultFields(data), ...(nested ? resultFields(nested) : [])];
    const content = data.text ?? data.content ?? data.body ?? data.summary;
    const collection = data.results ?? data.items ?? data.files ?? data.directories ?? data.matches;
    if (Array.isArray(collection)) return { ...base, resultKind: "list", items: resultItems(collection), links };
    if (fields.length) return { ...base, resultKind: "fields", fields, details: typeof content === "string" && content.length > 200 ? content : undefined, links };
    if (Array.isArray(content)) return { ...base, resultKind: "list", items: resultItems(content), links };
    if (typeof content === "string") return { ...base, resultKind: "text", details: content, links };
    const nestedSummary = nestedFields(data);
    if (nestedSummary.length) return { ...base, resultKind: "fields", fields: nestedSummary, links };
    return { ...base, resultKind: "empty", details: "Инструмент вернул данные без текстового описания.", links };
  }
  if (Array.isArray(output)) return { ...base, resultKind: "list", items: resultItems(output), links };
  return { ...base, resultKind: "text", details: scalar(output), links };
}
