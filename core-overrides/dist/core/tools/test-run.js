import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { waitForChildProcess } from "../../utils/child-process.js";
import { getShellEnv } from "../../utils/shell.js";
import { resolveToCwd } from "./path-utils.js";
import { getTextOutput, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "./truncate.js";
import { detectNodeTestCommand } from "./node-test-command.js";
const testRunSchema = Type.Object({
    command: Type.Optional(Type.String({ description: "Explicit test command to run (overrides auto-detection)" })),
    file: Type.Optional(Type.String({ description: "Specific test file to run; used to infer command if command is omitted" })),
    timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 120)" })),
}, { additionalProperties: false });
async function fileExistsAt(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
async function detectTestCommand(cwd, file) {
    const candidates = [];
    // Node / JS
    if (await fileExistsAt(join(cwd, "package.json"))) {
        const detected = await detectNodeTestCommand(cwd, file);
        if (detected) candidates.push(detected);
    }
    // Python
    if (await fileExistsAt(join(cwd, "pyproject.toml")) ||
        await fileExistsAt(join(cwd, "setup.py")) ||
        await fileExistsAt(join(cwd, "pytest.ini"))) {
        candidates.push({ cmd: "pytest", args: ["-q"], priority: 20 });
    }
    if (await fileExistsAt(join(cwd, "requirements.txt"))) {
        candidates.push({ cmd: "pytest", args: ["-q"], priority: 25 });
    }
    // Rust
    if (await fileExistsAt(join(cwd, "Cargo.toml"))) {
        candidates.push({ cmd: "cargo", args: ["test"], priority: 30 });
    }
    // Go
    if (await fileExistsAt(join(cwd, "go.mod"))) {
        candidates.push({ cmd: "go", args: ["test", "./..."], priority: 40 });
    }
    // Ruby
    if (await fileExistsAt(join(cwd, "Gemfile"))) {
        candidates.push({ cmd: "bundle", args: ["exec", "rspec"], priority: 50 });
    }
    // Java / Gradle / Maven
    if (await fileExistsAt(join(cwd, "pom.xml"))) {
        candidates.push({ cmd: "mvn", args: ["test"], priority: 60 });
    }
    if (await fileExistsAt(join(cwd, "build.gradle")) || await fileExistsAt(join(cwd, "build.gradle.kts"))) {
        candidates.push({ cmd: "./gradlew", args: ["test"], priority: 61 });
    }
    // C# / .NET
    if ((await fileExistsAt(join(cwd, "*.csproj"))) || (await fileExistsAt(join(cwd, "*.sln")))) {
        candidates.push({ cmd: "dotnet", args: ["test"], priority: 70 });
    }
    // If file is provided, prepend it to the args when possible
    if (file) {
        const resolved = resolveToCwd(file, cwd);
        for (const c of candidates) {
            if (c.cmd === "pytest" || c.cmd === "npx") {
                c.args = [...c.args, resolved];
            }
            else if (c.cmd === "go") {
                c.args = ["test", resolved];
            }
            else if (c.cmd === "cargo") {
                c.args = ["test", "--", resolved];
            }
            else if (c.cmd === "mvn") {
                c.args = ["-Dtest=" + resolved, "test"];
            }
        }
    }
    candidates.sort((a, b) => a.priority - b.priority);
    return candidates[0] || null;
}
function truncateOutput(text) {
    const allLines = text.split("\n");
    const totalLines = allLines.length;
    const truncated = truncateHead(text);
    if (truncated.truncated) {
        const startLine = totalLines - truncated.outputLines + 1;
        const endLine = totalLines;
        const notice = `\n\n[Showing lines ${startLine}-${endLine} of ${totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit / ${DEFAULT_MAX_LINES} line limit)]`;
        return truncated.content + notice;
    }
    return text;
}
export function createTestRunToolDefinition(cwd, options) {
    const env = options?.env ?? getShellEnv();
    const shellPath = options?.shellPath;
    return {
        name: "test_run",
        label: "test_run",
        description: "Run tests for the current project. Auto-detects the test framework from project files (package.json, pyproject.toml, Cargo.toml, go.mod, etc.) unless an explicit command is provided. Reports stdout, stderr, and exit code.",
        promptSnippet: "Run project tests",
        promptGuidelines: [
            "Use test_run after making changes to verify they work",
            "Pass command explicitly when auto-detection is uncertain",
            "If tests fail, read the error and fix before continuing",
        ],
        parameters: testRunSchema,
        async execute(_toolCallId, input, signal, _onUpdate, _ctx) {
            const { command, file, timeout = 120 } = input;
            let cmd;
            let args;
            if (command) {
                // Parse simple shell command. We use a small splitter; for complex cases user should use bash.
                const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
                if (parts.length === 0) {
                    throw new Error("Empty command provided.");
                }
                cmd = parts[0].replace(/^["']|["']$/g, "");
                args = parts.slice(1).map((p) => p.replace(/^["']|["']$/g, ""));
            }
            else {
                const detected = await detectTestCommand(cwd, file);
                if (!detected) {
                    throw new Error("Could not auto-detect test command. Provide `command` explicitly or use bash.");
                }
                cmd = detected.cmd;
                args = detected.args;
            }
            const child = spawn(cmd, args, {
                cwd,
                env,
                shell: false,
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
            });
            let stdout = "";
            let stderr = "";
            let timedOut = false;
            let timeoutHandle;
            const onAbort = () => {
                if (child.pid) {
                    try {
                        process.kill(child.pid, "SIGTERM");
                    }
                    catch { }
                }
            };
            if (signal) {
                if (signal.aborted)
                    onAbort();
                else
                    signal.addEventListener("abort", onAbort, { once: true });
            }
            if (timeout > 0) {
                timeoutHandle = setTimeout(() => {
                    timedOut = true;
                    onAbort();
                }, timeout * 1000);
            }
            try {
                child.stdout?.on("data", (d) => { stdout += d.toString("utf-8"); });
                child.stderr?.on("data", (d) => { stderr += d.toString("utf-8"); });
                const exitCode = await waitForChildProcess(child);
                if (signal?.aborted) {
                    throw new Error("Operation aborted");
                }
                const combined = [stdout, stderr].filter(Boolean).join("\n");
                const output = truncateOutput(combined || "(no output)");
                if (timedOut) {
                    throw new Error(`Tests timed out after ${timeout}s.\n\n${output}`);
                }
                const passed = exitCode === 0;
                return {
                    content: [
                        {
                            type: "text",
                            text: passed
                                ? `Tests passed (exit ${exitCode}).\n\n${output}`
                                : `Tests failed (exit ${exitCode}).\n\n${output}`,
                        },
                    ],
                    details: { exitCode, command: `${cmd} ${args.join(" ")}`, passed },
                };
            }
            finally {
                if (timeoutHandle)
                    clearTimeout(timeoutHandle);
                if (signal)
                    signal.removeEventListener("abort", onAbort);
            }
        },
        renderCall(args, theme, _context) {
            const text = new Text("", 0, 0);
            const command = str(args?.command);
            text.setText(theme.fg("toolTitle", theme.bold("test_run")) +
                (command ? theme.fg("accent", ` ${command}`) : theme.fg("toolOutput", " auto-detect")));
            return text;
        },
        renderResult(result, _options, _theme, _context) {
            const text = new Text("", 0, 0);
            text.setText(getTextOutput(result, false));
            return text;
        },
    };
}
export function createTestRunTool(cwd, options) {
    return wrapToolDefinition(createTestRunToolDefinition(cwd, options));
}
//# sourceMappingURL=test-run.js.map
