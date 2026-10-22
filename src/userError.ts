export type UserErrorKind = "offline" | "timeout" | "connection" | "disconnected" | "key" | "quota" | "rate-limit" | "access" | "model" | "server" | "context" | "agent" | "error";
export type UserError = { kind: UserErrorKind; message: string };

/** Explain failures without exposing provider responses, stack traces or request internals. */
export function describeUserError(error: unknown, offline = typeof navigator !== "undefined" && navigator.onLine === false): UserError {
  const message = typeof error === "string" ? error
    : error && typeof error === "object" && "message" in error ? String(error.message)
    : "";

  if (/no api key|api key (?:not found|missing)|missing.*api.?key/i.test(message)) {
    return { kind: "key", message: "Не указан ключ доступа к ИИ-сервису. Добавьте его в настройках ключей." };
  }
  if (/invalid.*(?:api.?key|authentication)|(?:api.?key|token).*(?:invalid|expired)|incorrect api key|authentication.?error|unauthorized|\b401\b/i.test(message)) {
    return { kind: "key", message: "ИИ-сервис не принял ключ доступа. Проверьте или замените его в настройках ключей." };
  }
  if (/insufficient.?quota|quota.*(?:exceeded|exhausted)|exceeded.*quota|out of credits|insufficient.*(?:balance|credit)|billing|payment required|\b402\b/i.test(message)) {
    return { kind: "quota", message: "Закончился доступный лимит ИИ-сервиса. Проверьте баланс и лимиты у провайдера." };
  }
  if (/rate.?limit|too many requests|\b429\b/i.test(message)) {
    return { kind: "rate-limit", message: "Слишком много запросов к ИИ-сервису. Подождите немного и попробуйте снова." };
  }
  if (/forbidden|permission.?denied|access.?denied|\b403\b/i.test(message)) {
    return { kind: "access", message: "Нет доступа к этому действию. Проверьте разрешения и доступ к выбранной модели." };
  }
  if (/model.*(?:not found|does not exist|unavailable)|\b404\b/i.test(message)) {
    return { kind: "model", message: "Выбранная модель недоступна. Попробуйте выбрать другую модель." };
  }
  // An RPC timeout concerns the local agent, not necessarily the internet.
  if (/Оператор не ответил на|\brpc\b.*(?:timeout|timed out)/i.test(message)) {
    return { kind: "agent", message: "Агент долго не отвечает. Действие могло выполниться — проверьте результат перед повтором." };
  }

  const timedOut = /time.?out|timed?\s*out|ETIMEDOUT|UND_ERR_(?:CONNECT|HEADERS|BODY)_TIMEOUT|превышено время ожидания/i.test(message);
  const connection = /connection.?error|network.?error|network request failed|failed to fetch|fetch failed|load failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ERR_(?:INTERNET_DISCONNECTED|NETWORK_CHANGED|NAME_NOT_RESOLVED|CONNECTION_\w+)|нет подключения к интернету/i.test(message);
  const interrupted = /ECONNRESET|EPIPE|socket hang up|connection (?:reset|closed|lost|terminated)|UND_ERR_SOCKET|соединение.*(?:прервалось|разорвано)/i.test(message);
  if (((timedOut || connection || interrupted) && offline) || /ERR_INTERNET_DISCONNECTED|нет подключения к интернету/i.test(message)) {
    return { kind: "offline", message: "Нет подключения к интернету. Подключитесь к сети и повторите запрос." };
  }
  if (timedOut) {
    return { kind: "timeout", message: "ИИ-сервис не ответил вовремя. Попробуйте ещё раз чуть позже." };
  }
  if (interrupted) {
    return { kind: "disconnected", message: "Соединение с ИИ-сервисом прервалось. Проверьте интернет и повторите запрос." };
  }
  if (connection) {
    return { kind: "connection", message: "Не удалось подключиться к ИИ-сервису. Проверьте интернет и попробуйте ещё раз." };
  }
  if (/\b50[0234]\b|service unavailable|server.?error|overloaded|bad gateway|internal server error/i.test(message)) {
    return { kind: "server", message: "ИИ-сервис временно недоступен. Попробуйте ещё раз через несколько минут." };
  }
  if (/context length|context window|ContextWindowExceeded|too many tokens|prompt is too long/i.test(message)) {
    return { kind: "context", message: "Переписка стала слишком длинной. Сожмите её через меню диалога или начните новый диалог." };
  }
  if (/линия (?:не подключена|не найдена|оборвалась|закрыта)|сессия остановлена/i.test(message)) {
    return { kind: "agent", message: "Связь с агентом прервалась. Перезапустите приложение и откройте этот диалог снова." };
  }
  if (/не удалось запустить|spawn.*ENOENT/i.test(message)) {
    return { kind: "agent", message: "Не удалось запустить агент. Перезапустите приложение. Если ошибка повторится, переустановите Operator." };
  }
  // Keep already readable Russian messages; unknown technical failures get a plain fallback.
  if (/[а-яё]/i.test(message) && !/[{}\n]|\bat\s|\b(?:Error|Exception|ERR_|ENOENT)/i.test(message)) {
    return { kind: "error", message: message.length > 400 ? `${message.slice(0, 400)}…` : message };
  }
  return { kind: "error", message: "Не удалось выполнить запрос. Попробуйте ещё раз. Если ошибка повторяется, перезапустите приложение." };
}

export function userError(error: unknown, offline?: boolean): string {
  return describeUserError(error, offline).message;
}
