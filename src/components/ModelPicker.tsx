import { useCallback, useMemo } from "react";
import { KeyRoundIcon } from "lucide-react";
import type { LineState, ModelInfo } from "../types.ts";
import { ProviderLogo, hasProviderLogo } from "./ProviderLogo.tsx";
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
export function ModelPicker({ line, models, onSetModel, onSetThinking, onOpenKeys, onRefreshModels }: {
  line: LineState | undefined;
  models: ModelInfo[];
  onSetModel: (provider: string, id: string) => void;
  onSetThinking: (level: string) => void;
  onOpenKeys: () => void;
  onRefreshModels: () => void;
}) {
  const options = useMemo<AiModel[]>(() => models
    .filter((model) => !(model.provider === "alem-ai" && model.id === "gemma4"))
    .map((model) => ({
      id: modelKey(model),
      label: model.provider === "alem-ai" && /^(qwen3-8|qwen3\.8)$/i.test(model.id) ? "qwen3.8"
        : model.provider === "alem-ai" && model.id === "gpt-oss" ? "gpt-oss:120b(medium)"
        : model.id,
      providerId: model.provider,
      providerLogo: hasProviderLogo(model.provider) ? <ProviderLogo provider={model.provider} /> : undefined,
      providerLogoCompact: hasProviderLogo(model.provider) ? <ProviderLogo provider={model.provider} compact /> : undefined,
      description: model.provider === "alem-ai" ? "Alem AI" : model.provider === "ollama"
        ? `Ollama · ${model.ollama?.source === "cloud" ? "облачная" : "на устройстве"}${model.ollama?.running === false ? " · сервер выключен" : ""}` : model.provider,
      disabled: model.ollama?.running === false,
      contexts: model.contextWindow > 0 ? [model.contextWindow] : undefined,
      efforts: model.reasoning && model.provider !== "ollama" && !(model.provider === "alem-ai" && /^(qwen3-8|qwen3\.8)$/i.test(model.id)) ? efforts : undefined,
      supportsThinking: model.reasoning,
    })), [models]);

  const selected = line?.model ? modelKey(line.model) : "";
  const opened = useCallback((open: boolean) => { if (open) onRefreshModels(); }, [onRefreshModels]);
  const currentModel = models.find((model) => modelKey(model) === selected);
  const level = line?.thinkingLevel;
  const selection: AiModelSelection = {
    id: selected,
    context: currentModel ? `${Math.round(currentModel.contextWindow / 1000)}K` : undefined,
    effort: currentModel?.reasoning && options.find(item => item.id === selected)?.efforts && efforts.includes(level as AiModelEffort) ? level as AiModelEffort : undefined,
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
      onSetThinking(next.thinking ? next.effort ?? "medium" : "off");
    }
  };

  return <div className="flex min-w-0 max-w-full items-center gap-1">
    <ModelSelector className="min-w-0" models={options} value={selection} onValueChange={change} onOpenChange={opened} disabled={!line} aria-label="Модели">
      <ModelSelectorTrigger className="control min-w-0 max-w-[min(250px,42vw)] rounded-xl border-2 border-border bg-muted px-3 text-foreground" title="Выбрать модель">
        <ModelSelectorValue className="text-xs" />
      </ModelSelectorTrigger>
      <ModelSelectorContent side="top" />
    </ModelSelector>
    <button type="button" onClick={onOpenKeys} title="Ключи доступа" aria-label="Ключи доступа" className="control control-ghost shrink-0" style={{ padding: "0 7px" }}><KeyRoundIcon size={14} aria-hidden /></button>
  </div>;
}
