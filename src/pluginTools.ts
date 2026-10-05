import type { PluginInfo, PluginStatus } from "./types.ts";

function mcpPrefix(id: string): string {
  return `${id}__`.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Точные имена приходят от загрузчика; префикс MCP помогает старым сессиям. */
export function indexPluginTools(plugins: PluginInfo[], statuses: PluginStatus[]) {
  const available = plugins.filter((plugin) => plugin.enabled && !plugin.broken);
  const byId = new Map(available.map((plugin) => [plugin.id, plugin]));
  const exact = new Map<string, PluginInfo | null>();
  for (const status of statuses) {
    if (status.status !== "ready") continue;
    const plugin = byId.get(status.id);
    if (!plugin) continue;
    for (const name of status.toolNames ?? []) {
      if (exact.has(name) && exact.get(name)?.id !== plugin.id) exact.set(name, null);
      else if (!exact.has(name)) exact.set(name, plugin);
    }
  }

  const mcp = available
    .filter((plugin) => plugin.kind === "mcp")
    .map((plugin) => ({ plugin, prefix: mcpPrefix(plugin.id) }));

  return (toolName: string): PluginInfo | undefined => {
    if (exact.has(toolName)) return exact.get(toolName) ?? undefined;
    const matches = mcp.filter(({ prefix }) => toolName.startsWith(prefix));
    return matches.length === 1 ? matches[0].plugin : undefined;
  };
}

export function pluginToolLabel(toolName: string, plugin: PluginInfo): string {
  const prefix = plugin.kind === "mcp" ? mcpPrefix(plugin.id) : "";
  const name = prefix && toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName;
  return name.replaceAll("_", " ");
}
