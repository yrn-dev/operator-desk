import { useEffect, useState } from "react";
import type { LinkPreview } from "../types.ts";

const MAX_CARDS = 3;

/** Веб-адреса из ответа: localhost, IP и обычные сайты, без повторов. */
export function findLinks(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`()[\]{}]+/gi)) {
    // Точка или запятая в конце — это конец предложения, а не часть адреса.
    const url = match[0].replace(/[.,;:!?*_]+$/, "");
    try {
      found.add(new URL(url).toString());
    } catch {
      // Не адрес.
    }
    if (found.size >= MAX_CARDS) break;
  }
  return [...found];
}

/** Карточки ссылок под ответом. Клик открывает адрес в браузере системы. */
export function LinkCards({ text }: { text: string }) {
  const links = findLinks(text);
  if (links.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
      {links.map((url) => (
        <LinkCard key={url} url={url} />
      ))}
    </div>
  );
}

function LinkCard({ url }: { url: string }) {
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    window.operator
      .linkPreview(url)
      .then((result) => alive && setPreview(result))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [url]);

  const host = preview?.host ?? safeHost(url);
  const title = preview?.title && preview.title !== host ? preview.title : url;

  return (
    <a
      href={url}
      className="link-card"
      title={`Открыть в браузере: ${url}`}
      onClick={(event) => {
        event.preventDefault();
        void window.operator.openLink(url);
      }}
    >
      {loading ? (
        <div className="shimmer link-card-image" />
      ) : (
        preview?.image && <img className="link-card-image" src={preview.image} alt="" draggable={false} />
      )}
      <div style={{ padding: "12px 16px 14px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {preview?.icon ? (
            <img src={preview.icon} alt="" width={16} height={16} style={{ borderRadius: 3, flex: "none" }} />
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden style={{ flex: "none", color: "var(--text-faint)" }}>
              <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.2" />
              <path d="M1.8 8h12.4M8 1.7c1.8 1.9 2.6 4 2.6 6.3S9.8 12.4 8 14.3C6.2 12.4 5.4 10.3 5.4 8S6.2 3.6 8 1.7z" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          )}
          <span className="link-card-host">{host}</span>
        </div>
        <span className="link-card-title">{loading ? "Загружаю превью…" : title}</span>
      </div>
    </a>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
