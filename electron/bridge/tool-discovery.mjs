/** Keep MCP catalogues out of every request; expose selected tools on demand. */
export function createToolDiscovery(operator) {
  const deferred = new Map();
  const catalog = new Map();
  const loaded = new Map();
  const MAX_LOADED = 6;
  const MAX_SCHEMA_CHARS = 32000;
  const remember = tool => {
    loaded.delete(tool.name);
    loaded.set(tool.name, JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }).length);
    while (loaded.size > 1 && (loaded.size > MAX_LOADED || [...loaded.values()].reduce((a, b) => a + b, 0) > MAX_SCHEMA_CHARS)) {
      loaded.delete(loaded.keys().next().value);
    }
  };
  const apply = () => {
    operator.setActiveTools(operator.getActiveTools().filter(name => !deferred.has(name) || loaded.has(name)));
  };
  operator.registerTool({
    name: "tool_search",
    label: "Поиск инструментов плагинов",
    description: "Find and load plugin tools by service, task keywords (prefer English), or exact tool name. Plugin schemas are loaded only when needed to save context. Search before using a tool absent from the current tools. Results become callable on your next turn.",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "Service and action, e.g. github search repositories, higgsfield generate video, or an exact tool name" },
      limit: { type: "integer", minimum: 1, maximum: 5, description: "Number of tools to load; default 1. Increase only when several tools are needed together." },
    }, required: ["query"], additionalProperties: false },
    async execute(_id, { query, limit = 1 }) {
      const words = query.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);
      const available = new Set(operator.getAllTools().map(t => t.name));
      const matches = [...deferred.values()].filter(t => available.has(t.name)).map(tool => {
        const name = tool.name.toLowerCase();
        const desc = tool.description.toLowerCase();
        const score = name === query.toLowerCase() ? 10000 : words.reduce((n, w) => n + (name.includes(w) ? 10 : desc.includes(w) ? 1 : 0), 0);
        return { tool, score };
      }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
        .slice(0, Math.max(1, Math.min(5, limit)));
      // Keep recently needed tools together; evict old schemas within a fixed budget.
      for (const { tool } of matches) remember(tool);
      const active = operator.getActiveTools().filter(name => !deferred.has(name));
      operator.setActiveTools([...active, ...loaded.keys()]);
      return { content: [{ type: "text", text: matches.length
        ? JSON.stringify(matches.filter(({ tool }) => loaded.has(tool.name)).map(({ tool }) => ({ name: tool.name, description: tool.description.slice(0, 400) })))
        : `No matching tools. Available services: ${[...catalog.keys()].join(", ")}. Try an English action or service name.` }] };
    },
  });
  return {
    register(server, tools) {
      catalog.set(server, tools.map(t => t.name));
      for (const tool of tools) deferred.set(tool.name, tool);
    },
    beforePrompt() {
      apply();
      return [...catalog].map(([server, names]) => `${server}: ${names.slice(0, 24).map(n => n.replace(`${server.replace(/[^a-zA-Z0-9_]/g, "_")}__`, "")).join(", ")}${names.length > 24 ? `; ${names.length} tools total — search by service and action` : ""}`).join("\n");
    },
  };
}
