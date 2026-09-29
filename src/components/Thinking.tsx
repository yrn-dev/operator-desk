import { useEffect, useLayoutEffect, useRef, useState } from "react";

/*
 * Размышление модели: пока идёт — строки проявляются одна за другой и лента
 * уползает вверх под мягкой растушёвкой; когда закончилось — сворачивается
 * в «Думал N с» и раскрывается обратно по клику.
 *
 * Механика взята из компонента ThinkingReasoning (21st.dev) один в один:
 * та же геометрия окна, та же маска, тот же расчёт сдвига. Отличие одно —
 * строки не выдуманы заранее, а приходят потоком от самой модели.
 */

/** Геометрия — держать в согласии со стилями .trr-* в theme.css. */
const MAX_H = 180; // окно растёт вместе с содержимым до этой высоты, дальше прокрутка
const FADE = 16; // растушёвка сверху и снизу, когда окно упёрлось в предел

/** Поток размышления делится на фразы: по точкам, переносам и многоточию. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function plural(seconds: number): string {
  const tail = seconds % 10;
  const teen = seconds % 100 >= 11 && seconds % 100 <= 14;
  if (!teen && tail === 1) return "секунду";
  if (!teen && tail >= 2 && tail <= 4) return "секунды";
  return "секунд";
}

export function Thinking({ text, live }: { text: string; live: boolean }) {
  // Пока думает — раскрыто всегда; после — свёрнуто, пока не откроют.
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [fade, setFade] = useState({ top: false, bottom: true });
  const [contentH, setContentH] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const stream = useRef<HTMLDivElement>(null);
  const startedAt = useRef<number | null>(null);

  const lines = sentences(text);
  const has = lines.length > 0;

  // Засекаем время от первой мысли до последней — его показываем в заголовке.
  useEffect(() => {
    if (live && has && startedAt.current === null) startedAt.current = Date.now();
    if (!live && startedAt.current !== null) {
      setElapsed(Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)));
      startedAt.current = null;
    }
  }, [live, has]);

  // Высота потока меряется по факту: мысли бывают и в строку, и в абзац.
  useLayoutEffect(() => {
    const el = stream.current;
    if (!el) return;
    const measure = () => setContentH(el.scrollHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, open, live]);

  if (!has) return null;

  const done = !live;
  const expanded = done ? open : true;
  const capped = contentH > MAX_H;
  const viewH = capped ? MAX_H : contentH;
  // Раскрытое размышление листается, идущее — само подтягивается к последней мысли.
  const scrollable = done && open;
  const translate = scrollable ? 0 : capped ? MAX_H - FADE - contentH : 0;

  const showTop = scrollable ? fade.top : capped;
  const showBottom = scrollable ? fade.bottom : capped;
  const mask = capped
    ? `linear-gradient(to bottom, transparent 0, #000 ${showTop ? FADE : 0}px, #000 calc(100% - ${
        showBottom ? FADE : 0
      }px), transparent 100%)`
    : "none";

  const onScroll = () => {
    const el = viewport.current;
    if (!el) return;
    setFade({
      top: el.scrollTop > 1,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    });
  };

  const toggle = () => {
    const next = !open;
    if (next) {
      setFade({ top: false, bottom: true });
      if (viewport.current) viewport.current.scrollTop = 0;
    }
    setOpen(next);
  };

  return (
    <div className="trr-root">
      <button
        type="button"
        className={`trr-header${done ? " trr-clickable" : ""}`}
        aria-expanded={expanded}
        aria-label={done ? "Показать размышление" : "Размышление"}
        onClick={done ? toggle : undefined}
      >
        {done ? (
          <span className="trr-label">
            <span className="trr-verb">Думал</span>
            {elapsed !== null ? ` ${elapsed} ${plural(elapsed)}` : " над ответом"}
          </span>
        ) : (
          <span className="trr-label trr-shimmer">Думает…</span>
        )}
        {done && (
          <svg
            className={`trr-chevron${open ? " trr-chevron-open" : ""}`}
            viewBox="0 0 24 24"
            width="12"
            height="12"
            aria-hidden
          >
            <path
              d="m4.5 15.75 7.5-7.5 7.5 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      <div className={`trr-collapsible${expanded ? "" : " trr-collapsed"}`}>
        <div className="trr-inner">
          <div
            ref={viewport}
            className={`trr-viewport${scrollable ? " trr-scroll" : ""}`}
            style={{
              height: `${viewH}px`,
              WebkitMaskImage: mask,
              maskImage: mask,
            }}
            onScroll={scrollable ? onScroll : undefined}
          >
            <div ref={stream} className="trr-stream" style={{ transform: `translateY(${translate}px)` }}>
              {lines.map((line, index) => (
                <p key={index} className="trr-sentence">
                  {line}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
