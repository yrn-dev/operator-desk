import type { Attachment } from "../types.ts";

/** Иконка по расширению: код, таблица, документ, архив, прочее. */
function glyph(name: string, folder: boolean) {
  if (folder) {
    return <path d="M2.4 4.4a1 1 0 011-1h2.8l1.4 1.6h4.9a1 1 0 011 1v5.6a1 1 0 01-1 1h-9.1a1 1 0 01-1-1V4.4z" />;
  }
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "c", "cpp", "sh", "rb", "php"].includes(ext)) {
    return (
      <>
        <path d="M5.6 5.4L3 8l2.6 2.6" />
        <path d="M10.4 5.4L13 8l-2.6 2.6" />
        <path d="M9 3.6l-2 8.8" />
      </>
    );
  }
  if (["csv", "xlsx", "xls", "tsv"].includes(ext)) {
    return (
      <>
        <rect x="2.6" y="3.2" width="10.8" height="9.6" rx="1.4" />
        <path d="M2.6 6.6h10.8M6.4 6.6v6.2M10 6.6v6.2" />
      </>
    );
  }
  if (["zip", "tar", "gz", "7z", "rar"].includes(ext)) {
    return (
      <>
        <rect x="3" y="2.8" width="10" height="10.4" rx="1.6" />
        <path d="M8 3v2.4M8 6.6V9" />
        <rect x="6.9" y="9.2" width="2.2" height="2.6" rx="0.7" />
      </>
    );
  }
  if (["pdf", "doc", "docx", "md", "txt", "rtf"].includes(ext)) {
    return (
      <>
        <path d="M4 2.8h4.6L12 6.2v7a1 1 0 01-1 1H4a1 1 0 01-1-1v-9.4a1 1 0 011-1z" />
        <path d="M8.4 2.9v3.4H12" />
        <path d="M5.4 9.2h5M5.4 11.4h3.4" />
      </>
    );
  }
  return (
    <>
      <path d="M4 2.8h4.6L12 6.2v7a1 1 0 01-1 1H4a1 1 0 01-1-1v-9.4a1 1 0 011-1z" />
      <path d="M8.4 2.9v3.4H12" />
    </>
  );
}

export function FileIcon({
  name,
  color = "var(--accent)",
  folder = false,
}: {
  name: string;
  color?: string;
  folder?: boolean;
}) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke={color}
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "none" }}
      aria-hidden
    >
      {glyph(name, folder)}
    </svg>
  );
}

/** Миниатюра картинки или карточка файла — и в поле ввода, и в отправленной реплике. */
export function AttachmentPreview({
  item,
  onRemove,
}: {
  item: Attachment;
  onRemove?: () => void;
}) {
  const remove = onRemove && (
    <button
      onClick={onRemove}
      title="Убрать"
      style={{
        position: "absolute",
        top: -6,
        right: -6,
        width: 18,
        height: 18,
        display: "grid",
        placeItems: "center",
        borderRadius: "50%",
        border: "1px solid var(--line)",
        background: "var(--bg-raised)",
        color: "var(--text-muted)",
        fontSize: 13,
        lineHeight: 1,
      }}
    >
      ×
    </button>
  );

  if (item.kind === "image") {
    return (
      <span style={{ position: "relative", display: "inline-block" }} title={item.name}>
        <img
          src={`data:${item.mimeType};base64,${item.data}`}
          alt={item.name}
          style={{
            display: "block",
            width: 58,
            height: 58,
            objectFit: "cover",
            borderRadius: 8,
            border: "1px solid var(--line)",
          }}
        />
        {remove}
      </span>
    );
  }

  return (
    <span
      title={item.path}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        maxWidth: 230,
        height: 34,
        padding: "0 11px",
        borderRadius: 8,
        border: "1px solid var(--line)",
        background: "var(--bg-raised)",
        fontSize: 12.5,
        color: "var(--text-muted)",
      }}
    >
      <FileIcon name={item.name} folder={item.kind === "folder"} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.name}
      </span>
      {remove}
    </span>
  );
}
