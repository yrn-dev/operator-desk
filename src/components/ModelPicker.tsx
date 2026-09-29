import { useMemo } from "react";
import { KeyRoundIcon } from "lucide-react";
import type { LineState, ModelInfo } from "../types.ts";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorTrigger,
  ModelSelectorValue,
  type AiModel,
  type AiModelEffort,
  type AiModelSelection,
} from "./ui/ai-model-select.tsx";

const modelKey = (model: Pick<ModelInfo, "provider" | "id">) => `${model.provider}\u001f${model.id}`;
const efforts: AiModelEffort[] = ["high", "medium", "low"];

/** Выбор модели рядом с полем ввода. Источник списка и настроек — Operator RPC. */
export function ModelPicker({ line, models, onSetModel, onSetThinking, onOpenKeys }: {
  line: LineState | undefined;
  models: ModelInfo[];
  onSetModel: (provider: string, id: string) => void;
  onSetThinking: (level: string) => void;
  onOpenKeys: () => void;
}) {
  const options = useMemo<AiModel[]>(() => models.map((model) => ({
    id: modelKey(model),
    label: model.id,
    description: model.provider === "alem-ai" ? "Alem AI" : model.provider,
    contexts: model.contextWindow > 0 ? [model.contextWindow] : undefined,
    efforts: model.reasoning ? efforts : undefined,
    supportsThinking: model.reasoning,
  })), [models]);

  const selected = line?.model ? modelKey(line.model) : "";
  const currentModel = models.find((model) => modelKey(model) === selected);
  const level = line?.thinkingLevel;
  const selection: AiModelSelection = {
    id: selected,
    context: currentModel ? `${Math.round(currentModel.contextWindow / 1000)}K` : undefined,
    effort: currentModel?.reasoning && efforts.includes(level as AiModelEffort) ? level as AiModelEffort : undefined,
    thinking: currentModel?.reasoning && level !== "off",
  };

  const change = (next: AiModelSelection) => {
    const model = models.find((item) => modelKey(item) === next.id);
    if (!model) return;
    if (next.id !== selected) {
      onSetModel(model.provider, model.id);
      return;
    }
    if (model.reasoning && (next.effort !== selection.effort || next.thinking !== selection.thinking)) {
      onSetThinking(next.effort ?? "off");
    }
  };

  return <div className="flex min-w-0 items-center gap-1">
    <ModelSelector models={options} value={selection} onValueChange={change} disabled={!line} aria-label="Модели">
      <ModelSelectorTrigger className="control max-w-[min(250px,42vw)] rounded-xl border-2 border-border bg-muted px-3 text-foreground" title="Выбрать модель">
        <ModelSelectorValue className="text-xs" />
      </ModelSelectorTrigger>
      <ModelSelectorContent side="top" />
    </ModelSelector>
    <button type="button" onClick={onOpenKeys} title="Ключи доступа" aria-label="Ключи доступа" className="control control-ghost" style={{ padding: "0 7px" }}><KeyRoundIcon size={14} aria-hidden /></button>
  </div>;
}
