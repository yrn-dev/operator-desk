/**
 * Иконка на каждый инструмент. Штрих один и тот же, чтобы набор
 * читался как одно семейство; неизвестные инструменты получают точки.
 */
const paths: Record<string, React.ReactNode> = {
  bash: (
    <>
      <path d="M3.2 4.6l3 3.4-3 3.4" />
      <path d="M8.4 11.6h4.4" />
    </>
  ),
  read: (
    <>
      <path d="M3.4 3.6h5.2a2 2 0 012 2v6.8H5.4a2 2 0 01-2-2V3.6z" />
      <path d="M10.6 12.4V5.6a2 2 0 012-2" />
    </>
  ),
  write: (
    <>
      <path d="M11.2 2.9l1.9 1.9-7 7-2.5.6.6-2.5 7-7z" />
      <path d="M3.2 13.6h9.6" />
    </>
  ),
  edit: (
    <>
      <path d="M10.8 3.1l2.1 2.1-6.6 6.6-2.8.7.7-2.8 6.6-6.6z" />
      <path d="M9.3 4.6l2.1 2.1" />
    </>
  ),
  ls: (
    <>
      <path d="M2.6 4.4h2M2.6 8h2M2.6 11.6h2" />
      <path d="M6.4 4.4h7M6.4 8h7M6.4 11.6h7" />
    </>
  ),
  find: (
    <>
      <circle cx="7.2" cy="7.2" r="3.8" />
      <path d="M10.2 10.2l3 3" />
    </>
  ),
  grep: (
    <>
      <circle cx="6.8" cy="6.8" r="3.4" />
      <path d="M9.4 9.4l3.4 3.4" />
      <path d="M5.3 6.8h3" />
    </>
  ),
  memory: (
    <>
      <path d="M8 2.8c2.4 0 4.2 1.7 4.2 3.9 0 2.6-2 4.1-2 6.1H5.8c0-2-2-3.5-2-6.1C3.8 4.5 5.6 2.8 8 2.8z" />
      <path d="M6.4 10.6h3.2" />
    </>
  ),
  research: (
    <>
      <circle cx="8" cy="8" r="5.2" />
      <path d="M2.9 8h10.2" />
      <path d="M8 2.8c1.5 1.6 2.2 3.3 2.2 5.2S9.5 11.6 8 13.2c-1.5-1.6-2.2-3.3-2.2-5.2S6.5 4.4 8 2.8z" />
    </>
  ),
  app: (
    <>
      <rect x="2.8" y="2.8" width="4.4" height="4.4" rx="1" />
      <rect x="8.8" y="2.8" width="4.4" height="4.4" rx="1" />
      <rect x="2.8" y="8.8" width="4.4" height="4.4" rx="1" />
      <rect x="8.8" y="8.8" width="4.4" height="4.4" rx="1" />
    </>
  ),
  fetch: (
    <>
      <path d="M6.2 9.8l3.6-3.6" />
      <path d="M8.8 4.4l1-1a2.6 2.6 0 013.7 3.7l-1 1" />
      <path d="M7.2 11.6l-1 1a2.6 2.6 0 01-3.7-3.7l1-1" />
    </>
  ),
  task: (
    <>
      <path d="M3 4.6l1.5 1.5L7.2 3.4" />
      <path d="M3 11l1.5 1.5 2.7-2.7" />
      <path d="M9.4 5h3.8M9.4 11.4h3.8" />
    </>
  ),
  unknown: (
    <>
      <circle cx="4" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
};

/** Сопоставляет имя инструмента (в том числе из расширений) с иконкой. */
function pick(name: string): React.ReactNode {
  const key = name.toLowerCase();
  if (paths[key]) return paths[key];
  if (key.includes("bash") || key.includes("shell") || key.includes("exec")) return paths.bash;
  if (key.includes("memory") || key.includes("recall")) return paths.memory;
  if (key.includes("research") || key.includes("search") || key.includes("web")) return paths.research;
  if (key.includes("app") || key.includes("control")) return paths.app;
  if (key.includes("fetch") || key.includes("http") || key.includes("url")) return paths.fetch;
  if (key.includes("todo") || key.includes("task") || key.includes("plan")) return paths.task;
  if (key.includes("write") || key.includes("create")) return paths.write;
  if (key.includes("edit") || key.includes("patch")) return paths.edit;
  if (key.includes("read") || key.includes("cat")) return paths.read;
  if (key.includes("grep")) return paths.grep;
  if (key.includes("find") || key.includes("glob")) return paths.find;
  if (key.includes("ls") || key.includes("list") || key.includes("tree")) return paths.ls;
  return paths.unknown;
}

export function ToolIcon({ name, color }: { name: string; color: string }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke={color}
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "none" }}
      aria-hidden
    >
      {pick(name)}
    </svg>
  );
}
