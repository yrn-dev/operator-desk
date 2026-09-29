import { useEffect, useMemo, useRef } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { highlighter } from "../highlight.ts";

marked.setOptions({ gfm: true, breaks: true });

/**
 * Ответ модели — markdown. Содержимое чистится, код подсвечивается,
 * к каждому блоку кода добавляется кнопка копирования.
 */
export function Markdown({ text }: { text: string }) {
  const host = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    const raw = marked.parse(text, { async: false }) as string;
    return DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
  }, [text]);

  useEffect(() => {
    const root = host.current;
    if (!root) return;

    const blocks = [...root.querySelectorAll<HTMLElement>("pre > code")];

    // Грамматики подгружаются один раз и только если код в ответе есть.
    if (blocks.some((block) => !block.dataset.highlighted)) {
      void highlighter().then((hljs) => {
        for (const block of blocks) {
          if (block.dataset.highlighted) continue;
          const language = [...block.classList]
            .find((name) => name.startsWith("language-"))
            ?.slice("language-".length);
          try {
            block.innerHTML =
              language && hljs.getLanguage(language)
                ? hljs.highlight(block.textContent ?? "", { language }).value
                : hljs.highlightAuto(block.textContent ?? "").value;
          } catch {
            // Подсветка не критична — оставляем текст как есть.
          }
          block.dataset.highlighted = "1";
        }
      });
    }

    for (const block of blocks) {
      const pre = block.parentElement as HTMLPreElement;
      if (pre.querySelector(".copy-code")) continue;

      const button = document.createElement("button");
      button.className = "copy-code";
      button.textContent = "копировать";
      button.onclick = async () => {
        await navigator.clipboard.writeText(block.textContent ?? "");
        button.textContent = "скопировано";
        setTimeout(() => (button.textContent = "копировать"), 1400);
      };
      pre.appendChild(button);
    }
  }, [html]);

  return <div ref={host} className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
