"use client";

import * as React from "react";
import { CheckIcon, ChevronDownIcon, PencilIcon } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

const cn = (...values: ClassValue[]) => twMerge(clsx(values));
const spring = { type: "spring" as const, stiffness: 420, damping: 32 };

export type AiModelEffort = "high" | "medium" | "low";
export type AiModel = {
  id: string;
  label: string;
  description?: string;
  efforts?: AiModelEffort[];
  contexts?: Array<string | number>;
  supportsFast?: boolean;
  supportsThinking?: boolean;
  defaultEffort?: AiModelEffort;
  defaultContext?: string | number;
  defaultFast?: boolean;
  defaultThinking?: boolean;
  disabled?: boolean;
};
export type AiModelSelection = {
  id: string;
  effort?: AiModelEffort;
  context?: string;
  fast?: boolean;
  thinking?: boolean;
};
export const DEFAULT_AI_MODELS: AiModel[] = [
  { id: "opus-4.5", label: "Opus 4.5", description: "Powerful reasoning for complex coding and agentic tasks.", efforts: ["high", "medium", "low"], contexts: ["200K", "1M"], supportsFast: true, supportsThinking: true, defaultEffort: "high", defaultContext: "200K", defaultFast: true },
  { id: "cursor-grok-4.5", label: "Cursor Grok 4.5", description: "Fast, capable model tuned for coding workflows.", efforts: ["high", "medium", "low"], contexts: ["128K", "256K"], supportsFast: true, supportsThinking: true, defaultEffort: "high", defaultContext: "128K", defaultFast: true },
  { id: "gpt-5", label: "GPT-5", description: "General-purpose reasoning with strong code generation.", efforts: ["high", "medium", "low"], contexts: ["128K", "400K"], supportsFast: true, supportsThinking: true, defaultEffort: "medium", defaultContext: "128K" },
  { id: "gemini-2.5", label: "Gemini 2.5", description: "Long-context model for large files and repositories.", efforts: ["high", "medium", "low"], contexts: ["1M"], supportsFast: true, defaultEffort: "low", defaultContext: "1M", defaultFast: true },
];

export function formatContext(value: string | number | undefined): string | null {
  if (value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

export function defaultSelectionFor(model: AiModel): AiModelSelection {
  return {
    id: model.id,
    effort: model.defaultEffort ?? model.efforts?.[0],
    context: formatContext(model.defaultContext ?? model.contexts?.[0]) ?? undefined,
    fast: model.defaultFast ?? false,
    thinking: model.defaultThinking ?? false,
  };
}

type SelectorContext = {
  models: AiModel[];
  selection: AiModelSelection;
  choose: (selection: AiModelSelection) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  disabled: boolean;
  trigger: React.RefObject<HTMLButtonElement | null>;
  content: React.RefObject<HTMLDivElement | null>;
  listId: string;
  side: "top" | "bottom";
  setSide: (side: "top" | "bottom") => void;
  reducedMotion: boolean;
  ariaLabel: string;
};
const Context = React.createContext<SelectorContext | null>(null);
function useSelector() {
  const value = React.useContext(Context);
  if (!value) throw new Error("ModelSelector components must be inside ModelSelector");
  return value;
}

export type ModelSelectorProps = {
  children: React.ReactNode;
  models?: AiModel[];
  value?: AiModelSelection;
  defaultValue?: AiModelSelection;
  onValueChange?: (value: AiModelSelection) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

export function ModelSelector({ children, models = DEFAULT_AI_MODELS, value, defaultValue, onValueChange, open: controlledOpen, defaultOpen = false, onOpenChange, disabled = false, className, "aria-label": ariaLabel = "AI models" }: ModelSelectorProps) {
  const [ownValue, setOwnValue] = React.useState<AiModelSelection>(() => defaultValue ?? (models[0] ? defaultSelectionFor(models[0]) : { id: "" }));
  const [ownOpen, setOwnOpen] = React.useState(defaultOpen);
  const selection = value ?? ownValue;
  const open = controlledOpen ?? ownOpen;
  const trigger = React.useRef<HTMLButtonElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();
  const [side, setSide] = React.useState<"top" | "bottom">("top");
  const [reducedMotion, setReducedMotion] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const setOpen = React.useCallback((next: boolean) => {
    if (next && disabled) return;
    if (controlledOpen === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  }, [controlledOpen, disabled, onOpenChange]);

  const choose = React.useCallback((next: AiModelSelection) => {
    if (value === undefined) setOwnValue(next);
    onValueChange?.(next);
  }, [value, onValueChange]);

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent | TouchEvent) => {
      const node = event.target as Node;
      if (!trigger.current?.contains(node) && !content.current?.contains(node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  return <Context.Provider value={{ models, selection, choose, open, setOpen, disabled, trigger, content, listId, side, setSide, reducedMotion, ariaLabel }}>
    <div data-slot="model-selector" data-state={open ? "open" : "closed"} className={cn("relative inline-flex", className)}>{children}</div>
  </Context.Provider>;
}

export type ModelSelectorTriggerProps = Omit<React.ComponentProps<typeof motion.button>, "children"> & { children?: React.ReactNode };
export const ModelSelectorTrigger = React.forwardRef<HTMLButtonElement, ModelSelectorTriggerProps>(function ModelSelectorTrigger({ children, className, onClick, ...props }, ref) {
  const { open, setOpen, disabled, trigger, listId } = useSelector();
  return <motion.button {...props} ref={(node) => { trigger.current = node; if (typeof ref === "function") ref(node); else if (ref) ref.current = node; }} type="button" disabled={disabled || props.disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} data-slot="model-selector-trigger" onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) setOpen(!open); }} whileTap={{ scale: 0.97 }} transition={spring} className={cn("flex min-h-9 max-w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40", open && "bg-muted text-foreground", className)}>
    {children ?? <ModelSelectorValue />}
    <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="flex shrink-0"><ChevronDownIcon size={14} aria-hidden /></motion.span>
  </motion.button>;
});

export function ModelSelectorValue({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  const { models, selection, reducedMotion } = useSelector();
  const model = models.find((item) => item.id === selection.id);
  return <span data-slot="model-selector-value" className={cn("flex min-w-0 items-center", className)} {...props}>
    <AnimatePresence mode="wait" initial={false}><motion.span key={`${selection.id}-${selection.effort}-${selection.thinking}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.15 }} className="flex min-w-0 items-baseline gap-1.5">
      <span className="truncate font-medium text-foreground">{model?.label ?? "Выбрать модель"}</span>
      {selection.effort && <span className="shrink-0 text-muted-foreground">{selection.effort}</span>}
      {selection.fast && <span className="shrink-0 text-muted-foreground">Fast</span>}
      {selection.thinking && <span className="shrink-0 text-muted-foreground">Thinking</span>}
    </motion.span></AnimatePresence>
  </span>;
}

export type ModelSelectorContentProps = Omit<React.ComponentProps<typeof motion.div>, "children"> & { children?: React.ReactNode; side?: "top" | "bottom" };
export const ModelSelectorContent = React.forwardRef<HTMLDivElement, ModelSelectorContentProps>(function ModelSelectorContent({ children, side = "top", className, style, ...props }, ref) {
  const { open, trigger, content, listId, models, selection, choose, setOpen, setSide, reducedMotion, ariaLabel } = useSelector();
  const [mounted, setMounted] = React.useState(false);
  const [coords, setCoords] = React.useState<{ top?: number; bottom?: number; left: number }>({ left: 0 });
  const listRef = React.useRef<HTMLDivElement>(null);
  const [panelId, setPanelId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [focusIndex, setFocusIndex] = React.useState(0);
  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => setSide(side), [side, setSide]);
  React.useEffect(() => { if (!open) { setPanelId(null); setEditing(false); } }, [open]);
  React.useEffect(() => { if (open) listRef.current?.focus(); }, [open]);
  React.useEffect(() => {
    if (open) setFocusIndex(Math.max(0, models.findIndex((model) => model.id === selection.id)));
  }, [open, models, selection.id]);
  React.useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const box = trigger.current?.getBoundingClientRect();
      if (box) setCoords({
        top: side === "bottom" ? box.bottom + 8 : undefined,
        bottom: side === "top" ? window.innerHeight - box.top + 8 : undefined,
        left: Math.max(8, Math.min(box.left, window.innerWidth - (panelId ? 500 : 280))),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open, side, trigger, panelId]);
  const panel = models.find((model) => model.id === panelId);
  if (!mounted) return null;
  return createPortal(<AnimatePresence>{open && <motion.div {...props} ref={(node) => { content.current = node; if (typeof ref === "function") ref(node); else if (ref) ref.current = node; }} data-slot="model-selector-content" initial={{ opacity: 0, y: reducedMotion ? 0 : 6, scale: reducedMotion ? 1 : 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reducedMotion ? 0 : 4, scale: reducedMotion ? 1 : 0.98 }} transition={{ duration: reducedMotion ? 0.1 : 0.2 }} style={{ position: "fixed", top: coords.top, bottom: coords.bottom, left: coords.left, zIndex: 50, ...style }} className={cn("flex max-w-[calc(100vw-16px)] items-start gap-3 max-[520px]:flex-col", className)}>
    <div ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} aria-activedescendant={models[focusIndex] ? `${listId}-${focusIndex}` : undefined} tabIndex={-1} onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && models.length) { event.preventDefault(); const direction = event.key === "ArrowDown" ? 1 : -1; setFocusIndex((index) => (index + direction + models.length) % models.length); }
      if (event.key === "Enter" && models[focusIndex] && !models[focusIndex].disabled) { choose(defaultSelectionFor(models[focusIndex])); setOpen(false); trigger.current?.focus(); }
    }}>
      {children ?? <LayoutGroup><motion.ul role="presentation" className="flex max-h-[min(380px,60vh)] min-w-64 flex-col gap-0.5 overflow-y-auto rounded-2xl border-2 border-border bg-popover p-1.5 text-popover-foreground shadow-[0_8px_30px_-8px_rgba(0,0,0,.45)]" onMouseLeave={() => { if (!editing) setPanelId(null); }}>
        {models.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">Список пуст — проверьте ключ провайдера.</li>}
        {models.map((model, index) => <li key={model.id} role="none" className={cn("group relative flex items-center rounded-xl hover:bg-muted", index === focusIndex && "bg-muted/70")} onMouseEnter={() => { setFocusIndex(index); if (!editing) setPanelId(model.id); }}>
          <button id={`${listId}-${index}`} type="button" role="option" aria-selected={selection.id === model.id} disabled={model.disabled} onFocus={() => { setFocusIndex(index); if (!editing) setPanelId(model.id); }} onClick={() => { choose(defaultSelectionFor(model)); setOpen(false); trigger.current?.focus(); }} className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring", selection.id === model.id && "bg-muted text-foreground")}>
            <span className="min-w-0 flex-1 truncate font-medium">{model.label}</span>
            {selection.id === model.id && <CheckIcon size={14} className="shrink-0" aria-hidden />}
          </button>
          {(!!model.efforts?.length || (model.contexts?.length ?? 0) > 1 || model.supportsFast || model.supportsThinking) && <button type="button" aria-label={`Настроить ${model.label}`} onClick={() => { setPanelId(model.id); setEditing(true); if (selection.id !== model.id) choose(defaultSelectionFor(model)); }} className={cn("mr-1 flex size-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100 focus-visible:opacity-100", editing && panelId === model.id && "opacity-100")}><PencilIcon size={14} aria-hidden /></button>}
        </li>)}
      </motion.ul></LayoutGroup>}
    </div>
    <AnimatePresence>{panel && <motion.aside key={panel.id + editing} initial={{ opacity: 0, x: reducedMotion ? 0 : -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="w-52 shrink-0 rounded-2xl border-2 border-border bg-popover p-3 text-popover-foreground shadow-[0_8px_30px_-8px_rgba(0,0,0,.45)]">
      <div className="text-sm font-semibold">{panel.label}</div>
      {panel.description && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{panel.description}</p>}
      {!!panel.contexts?.length && <div className="mt-3 text-xs text-muted-foreground"><div className="mb-1 text-[10px] font-semibold uppercase">Context</div>{panel.contexts.map(formatContext).join(" · ")}</div>}
      {editing && !!panel.efforts?.length && <div className="mt-3"><div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Effort</div>{panel.efforts.map((effort) => <button key={effort} type="button" onClick={() => choose({ ...selection, id: panel.id, effort, thinking: true })} className={cn("flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-muted", selection.effort === effort && "bg-muted")}>{effort[0].toUpperCase() + effort.slice(1)}{selection.effort === effort && <CheckIcon size={14} />}</button>)}<button type="button" onClick={() => choose({ ...selection, id: panel.id, effort: undefined, thinking: false })} className={cn("flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-muted", !selection.thinking && "bg-muted")}>Off{!selection.thinking && <CheckIcon size={14} />}</button></div>}
      {editing && (panel.contexts?.length ?? 0) > 1 && <div className="mt-3"><div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Context</div>{panel.contexts?.map((context) => { const formatted = formatContext(context) ?? ""; return <button key={formatted} type="button" onClick={() => choose({ ...selection, id: panel.id, context: formatted })} className={cn("flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-muted", selection.context === formatted && "bg-muted")}>{formatted}{selection.context === formatted && <CheckIcon size={14} />}</button>; })}</div>}
      {editing && panel.supportsFast && <button type="button" aria-pressed={!!selection.fast} onClick={() => choose({ ...selection, id: panel.id, fast: !selection.fast })} className="mt-3 flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-muted">Fast{selection.fast && <CheckIcon size={14} />}</button>}
      {editing && panel.supportsThinking && !panel.efforts?.length && <button type="button" aria-pressed={!!selection.thinking} onClick={() => choose({ ...selection, id: panel.id, thinking: !selection.thinking })} className="mt-1 flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-muted">Thinking{selection.thinking && <CheckIcon size={14} />}</button>}
    </motion.aside>}</AnimatePresence>
  </motion.div>}</AnimatePresence>, document.body);
});

export type ModelSelectorKitProps = Omit<ModelSelectorProps, "children">;
export function ModelSelectorKit(props: ModelSelectorKitProps) {
  return <ModelSelector {...props}><ModelSelectorTrigger><ModelSelectorValue /></ModelSelectorTrigger><ModelSelectorContent /></ModelSelector>;
}
export default ModelSelectorKit;
