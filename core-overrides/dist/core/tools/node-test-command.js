import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

async function exists(file) {
    try { await access(file); return true; } catch { return false; }
}

/** Only select a configured script or an already installed runner; never download one. */
export async function detectNodeTestCommand(cwd, file) {
    let pkg;
    try {
        pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw new Error(`Cannot read package.json: ${error.message}`);
    }
    if (typeof pkg.scripts?.test === "string" && pkg.scripts.test.trim()) {
        // Do not treat the npm-init placeholder as an actual test suite.
        if (!pkg.scripts.test.includes("Error: no test specified")) {
            let manager = /^(npm|pnpm|yarn|bun)@/.exec(pkg.packageManager ?? "")?.[1];
            if (!manager) {
                manager = await exists(join(cwd, "pnpm-lock.yaml")) ? "pnpm"
                    : await exists(join(cwd, "yarn.lock")) ? "yarn"
                    : await exists(join(cwd, "bun.lock")) || await exists(join(cwd, "bun.lockb")) ? "bun"
                    : "npm";
            }
            // A script can contain multiple commands; blindly appending a filename
            // could silently run a different scope from the one the user requested.
            if (file) {
                throw new Error("A test script is configured. Provide command explicitly to select a test file with that script's supported syntax.");
            }
            return { cmd: manager, args: ["run", "test"], priority: 10 };
        }
    }
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    const runners = Object.keys(dependencies).filter((name) => ["vitest", "jest", "mocha"].includes(name));
    if (runners.length > 1) {
        throw new Error("Multiple test runners found. Provide command explicitly to select the intended suite.");
    }
    const runner = runners[0];
    if (!runner) return null;
    const runnerRoot = join(cwd, "node_modules", runner);
    let installed;
    try { installed = JSON.parse(await readFile(join(runnerRoot, "package.json"), "utf8")); }
    catch { return null; }
    const bin = typeof installed.bin === "string" ? installed.bin : installed.bin?.[runner];
    if (typeof bin !== "string" || !bin) return null;
    // Run the JS entrypoint directly, including on Windows where spawn cannot
    // execute the .cmd shim without a shell.
    const executable = resolve(runnerRoot, bin);
    if (!await exists(executable)) return null;
    return {
        cmd: process.execPath,
        args: [executable, ...(runner === "vitest" ? ["run"] : runner === "jest" ? ["--runInBand"] : []), ...(file ? [resolve(cwd, file)] : [])],
        priority: 11,
    };
}
