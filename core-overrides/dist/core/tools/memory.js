import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getAgentDir } from "../../config.js";
import { stripFrontmatter } from "../../utils/frontmatter.js";
import { getTextOutput, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
const memoryStoreSchema = Type.Object({
    name: Type.String({ description: "Short kebab-case slug / title for the memory" }),
    description: Type.String({ description: "One-line summary of what this memory records" }),
    content: Type.String({ description: "The actual fact, decision, or context to remember" }),
    type: Type.Optional(Type.String({
        description: "Category: user | feedback | project | reference (default: project)",
        pattern: "^(user|feedback|project|reference)$",
    })),
    related: Type.Optional(Type.Array(Type.String({ description: "Names/slugs of related memories" }))),
}, { additionalProperties: false });
const memoryRecallSchema = Type.Object({
    query: Type.String({ description: "Search query: name slug, description keywords, or arbitrary text" }),
    limit: Type.Optional(Type.Number({ description: "Maximum results (default: 5, max: 20); read the returned file path for full details" })),
}, { additionalProperties: false });
function getMemoryDir() {
    return join(getAgentDir(), "memory");
}
function toKebabSlug(name) {
    return name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9_-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64);
}
function ensureAgentDir() {
    return mkdir(getMemoryDir(), { recursive: true });
}
function buildMemoryMarkdown({ name, description, content, type = "project", related = [] }) {
    const slug = toKebabSlug(name);
    const relatedYaml = related.length
        ? related.map((r) => `  - ${r}`).join("\n")
        : "  ";
    return `---\nname: ${slug}\ndescription: ${description}\nmetadata:\n  type: ${type}\nrelated:\n${relatedYaml}\n---\n\n${content}\n`;
}
function parseFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match)
        return null;
    const lines = match[1].split(/\r?\n/);
    const body = match[2].trim();
    const meta = {};
    let currentKey = null;
    for (const line of lines) {
        const topLevel = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
        if (topLevel) {
            currentKey = topLevel[1];
            meta[currentKey] = topLevel[2].trim();
            continue;
        }
        const indented = line.match(/^\s+-\s+(.*)$/);
        if (indented && currentKey === "related") {
            meta.related = meta.related || [];
            meta.related.push(indented[1].trim());
        }
    }
    return { meta, body };
}
async function listMemories() {
    await ensureAgentDir();
    const entries = await readdir(getMemoryDir(), { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
            files.push(entry.name);
        }
    }
    return files;
}
async function loadMemory(fileName) {
    const raw = await readFile(join(getMemoryDir(), fileName), "utf-8");
    const parsed = parseFrontmatter(raw);
    if (!parsed)
        return null;
    return {
        fileName,
        name: parsed.meta.name || fileName.replace(/\.md$/, ""),
        description: parsed.meta.description || "",
        type: parsed.meta.type || "project",
        related: parsed.meta.related || [],
        content: parsed.body,
    };
}
function scoreMemory(memory, query) {
    const q = query.toLowerCase();
    const haystack = [
        memory.name,
        memory.description,
        memory.content,
        memory.type,
        ...(memory.related || []),
    ]
        .join(" ")
        .toLowerCase();
    if (memory.name.toLowerCase() === q)
        return 100;
    if (memory.name.toLowerCase().includes(q))
        return 80;
    if (memory.description.toLowerCase().includes(q))
        return 60;
    if (haystack.includes(q))
        return 40;
    const words = q.split(/\s+/).filter(Boolean);
    const matches = words.filter((w) => haystack.includes(w)).length;
    if (matches > 0)
        return 10 + matches;
    return 0;
}
export function createMemoryStoreToolDefinition(_cwd, _options) {
    return {
        name: "memory_store",
        label: "memory_store",
        description: "Persist a fact, decision, architecture note, or project context to long-term memory. Stored as markdown files in ~/.opr/agent/memory/ and can be recalled later with memory_recall.",
        promptSnippet: "Save important facts, patterns, and decisions to long-term memory",
        promptGuidelines: [
            "Use memory_store after solving a tricky bug or making an architectural decision",
            "Keep name short and kebab-case; description one line; content the full fact",
            "Type should be one of: user, feedback, project, reference",
        ],
        parameters: memoryStoreSchema,
        async execute(_toolCallId, input, _signal, _onUpdate, _ctx) {
            const { name, description, content, type = "project", related = [] } = input;
            const slug = toKebabSlug(name);
            if (!slug) {
                throw new Error("Invalid memory name. Use letters, numbers, spaces, or hyphens.");
            }
            await ensureAgentDir();
            const filePath = join(getMemoryDir(), `${slug}.md`);
            const markdown = buildMemoryMarkdown({ name, description, content, type, related });
            await writeFile(filePath, markdown, "utf-8");
            return {
                content: [
                    { type: "text", text: `Memory saved: ${slug}.md` },
                ],
                details: { slug, file: filePath },
            };
        },
        renderCall(args, theme, _context) {
            const text = new Text("", 0, 0);
            const name = str(args?.name);
            text.setText(theme.fg("toolTitle", theme.bold("memory_store")) +
                (name ? theme.fg("accent", ` ${name}`) : ""));
            return text;
        },
        renderResult(result, _options, _theme, _context) {
            const text = new Text("", 0, 0);
            text.setText(getTextOutput(result, false));
            return text;
        },
    };
}
export function createMemoryRecallToolDefinition(_cwd, _options) {
    return {
        name: "memory_recall",
        label: "memory_recall",
        description: "Search long-term memory by query. Returns matching memories ranked by relevance, including their content and metadata.",
        promptSnippet: "Recall previously stored memories",
        promptGuidelines: [
            "Use memory_recall at the start of a complex task to check for saved context",
            "Query can be a slug, keyword, or phrase",
        ],
        parameters: memoryRecallSchema,
        async execute(_toolCallId, input, _signal, _onUpdate, _ctx) {
            const { query, limit = 5 } = input;
            const files = await listMemories();
            const memories = [];
            for (const file of files) {
                const mem = await loadMemory(file);
                if (mem) {
                    const score = scoreMemory(mem, query);
                    if (score > 0) {
                        memories.push({ ...mem, score });
                    }
                }
            }
            memories.sort((a, b) => b.score - a.score);
            const top = memories.slice(0, Math.min(20, Math.max(1, Math.floor(limit))));
            if (top.length === 0) {
                return {
                    content: [{ type: "text", text: `No memories found for query: "${query}"` }],
                    details: { results: [] },
                };
            }
            const lines = top.map((m) => {
                const file = join(getMemoryDir(), m.fileName);
                const excerpt = m.content.length > 1200 ? `${m.content.slice(0, 1200)}\n[Excerpt; read the file for full details.]` : m.content;
                return `[${m.name}] ${m.description}\nFile: ${file}\n${excerpt}`;
            });
            return {
                content: [{ type: "text", text: lines.join("\n\n---\n\n") }],
                details: { results: top },
            };
        },
        renderCall(args, theme, _context) {
            const text = new Text("", 0, 0);
            const query = str(args?.query);
            text.setText(theme.fg("toolTitle", theme.bold("memory_recall")) +
                (query ? theme.fg("accent", ` "${query}"`) : ""));
            return text;
        },
        renderResult(result, _options, _theme, _context) {
            const text = new Text("", 0, 0);
            text.setText(getTextOutput(result, false));
            return text;
        },
    };
}
export function createMemoryStoreTool(_cwd, options) {
    return wrapToolDefinition(createMemoryStoreToolDefinition(_cwd, options));
}
export function createMemoryRecallTool(_cwd, options) {
    return wrapToolDefinition(createMemoryRecallToolDefinition(_cwd, options));
}
//# sourceMappingURL=memory.js.map
