import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import https from "node:https";

const validName = name => typeof name === "string" && name.length <= 256 && /^[a-zA-Z0-9_.:/-]+$/.test(name);
function jsonFile(file) {
    try { return statSync(file).size <= 2 * 1024 * 1024 ? JSON.parse(readFileSync(file, "utf8")) : undefined; }
    catch { return undefined; }
}

export function ollamaEndpoint(configured, env = process.env) {
    const raw = configured || env.OLLAMA_HOST || "http://127.0.0.1:11434";
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid Ollama endpoint");
    if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
    url.pathname = url.pathname.replace(/\/v1\/?$/, "").replace(/\/$/, "");
    url.search = ""; url.hash = "";
    return url.href.replace(/\/$/, "");
}

export function ollamaDirectories(env = process.env, home = homedir(), platform = process.platform) {
    return [...new Set(env.OLLAMA_MODELS ? [env.OLLAMA_MODELS] : [join(home, ".ollama", "models"),
        ...(platform === "linux" ? ["/usr/share/ollama/.ollama/models", "/var/lib/ollama/.ollama/models", "/var/lib/ollama/models"] : [])])];
}

/** Read names/configuration only: never scan or load model weights. */
export function installedOllamaModels(endpoint, directories = ollamaDirectories()) {
    if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(new URL(endpoint).hostname)) return [];
    const models = new Map();
    for (const directory of directories) {
        const root = join(directory, "manifests");
        function visit(parts) {
            let entries;
            try { entries = readdirSync(join(root, ...parts), { withFileTypes: true }); } catch { return; }
            for (const entry of entries) {
                if (models.size >= 2000) return;
                if (entry.isDirectory() && parts.length < 6) { visit([...parts, entry.name]); continue; }
                if (!entry.isFile() || parts.length < 2) continue;
                const manifest = jsonFile(join(root, ...parts, entry.name));
                if (!manifest || !Array.isArray(manifest.layers) || !manifest.config) continue;
                const registry = parts[0], namespace = parts.slice(1);
                const model = registry === "registry.ollama.ai" && namespace[0] === "library" ? namespace.slice(1).join("/")
                    : registry === "registry.ollama.ai" ? namespace.join("/") : [registry, ...namespace].join("/");
                const name = `${model}:${entry.name}`;
                if (!model || !validName(name) || models.has(name)) continue;
                const digest = manifest.config.digest;
                const config = typeof digest === "string" && /^sha256:[a-f0-9]{64}$/.test(digest)
                    ? jsonFile(join(directory, "blobs", digest.replace(":", "-"))) : undefined;
                models.set(name, { name, config: config ?? {}, installed: true });
            }
        }
        visit([]);
    }
    return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function ollamaDefinition(entry, endpoint, running) {
    const config = entry.config ?? {}, details = entry.show ?? {};
    const capabilities = Array.isArray(details.capabilities) ? details.capabilities : Array.isArray(config.capabilities) ? config.capabilities : [];
    const source = config.remote_host || details.remote_host || /(?:^|[:-])cloud$/.test(entry.name) ? "cloud" : "local";
    const information = details.model_info ?? {};
    const contexts = [config.context_length, ...Object.entries(information).filter(([key]) => key.endsWith(".context_length")).map(([, value]) => value)].filter(value => Number.isFinite(value) && value > 0);
    const configuredContext = String(details.parameters ?? "").match(/(?:^|\n)num_ctx\s+(\d+)/)?.[1];
    const contextWindow = Number(configuredContext) || (contexts.length ? Math.max(...contexts) : 32768);
    const reasoning = capabilities.includes("thinking") || (!capabilities.length && /(?:deepseek-r1|qwen3|gpt-oss|reasoning)/i.test(entry.name));
    return {
        id: entry.name, name: entry.name, provider: "ollama", api: "openai-completions", baseUrl: `${endpoint}/v1`,
        reasoning, thinkingLevelMap: { off: "none" }, input: capabilities.includes("vision") ? ["text", "image"] : ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow,
        maxTokens: Math.min(16384, contextWindow),
        compat: { maxTokensField: "max_tokens", thinkingFormat: "openai", supportsReasoningEffort: true, supportsDeveloperRole: false },
        ollama: { source, running, installed: Boolean(entry.installed), capabilities },
    };
}

/** Native Node HTTP works in bundled Windows/macOS apps without curl/PATH. */
export function ollamaJson(url, { body, timeoutMs = 700 } = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(url), bytes = body === undefined ? undefined : JSON.stringify(body);
        let timer;
        const request = (target.protocol === "https:" ? https : http).request(target, {
            method: bytes ? "POST" : "GET", headers: bytes ? { "content-type": "application/json", "content-length": Buffer.byteLength(bytes) } : {},
        }, response => {
            if (response.statusCode !== 200) { response.resume(); request.destroy(new Error("Ollama discovery unavailable")); return; }
            const chunks = []; let size = 0;
            response.on("data", chunk => { size += chunk.length; if (size > 2 * 1024 * 1024) request.destroy(new Error("Ollama discovery response too large")); else chunks.push(chunk); });
            response.on("error", reject);
            response.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (error) { reject(error); } });
        });
        timer = setTimeout(() => request.destroy(new Error("Ollama discovery timed out")), timeoutMs);
        request.on("close", () => clearTimeout(timer));
        request.on("error", error => { clearTimeout(timer); reject(error); });
        request.end(bytes);
    });
}

export async function discoverOllamaModels(endpoint, directories) {
    const installed = installedOllamaModels(endpoint, directories);
    const byName = new Map(installed.map(entry => [entry.name, entry]));
    const deadline = Date.now() + 1800;
    try {
        const result = await ollamaJson(`${endpoint}/api/tags`);
        if (!Array.isArray(result.models)) throw new Error("Invalid Ollama model list");
        const entries = result.models.filter(entry => validName(entry.name ?? entry.model)).slice(0, 2000).map(entry => ({ ...byName.get(entry.name ?? entry.model), name: entry.name ?? entry.model }));
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
            while (next < entries.length && Date.now() < deadline) {
                const entry = entries[next++];
                try { entry.show = await ollamaJson(`${endpoint}/api/show`, { body: { model: entry.name }, timeoutMs: Math.min(450, deadline - Date.now()) }); } catch { /* Offline config remains useful. */ }
            }
        }));
        // The running server is authoritative; removed tags must disappear.
        return entries.map(entry => ollamaDefinition(entry, endpoint, true));
    } catch {
        return installed.map(entry => ollamaDefinition(entry, endpoint, false));
    }
}
