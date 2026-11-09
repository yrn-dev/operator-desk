/**
 * Кладёт operator внутрь приложения, чтобы пользователю не требовалось
 * ставить его отдельно. Запускается перед сборкой дистрибутивов.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve("vendor");
const marker = path.join(root, "node_modules", "pzero-operator", "package.json");

// Версия ядра закреплена: сборки на разных машинах должны быть одинаковыми.
const PINNED = "1.2.3";
const wanted = process.env.OPERATOR_VERSION ?? PINNED;

// Reviewed runtime fixes travel with the source archive. Match the exact upstream
// bytes before applying them, so a different core is never patched silently.
export function applyCoreOverrides(packageRoot, overrideRoot = fileURLToPath(new URL("../core-overrides/", import.meta.url))) {
  const file = path.join(overrideRoot, "manifest.json");
  if (!fs.existsSync(file)) throw new Error("Reviewed core-overrides/manifest.json is missing.");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  if (pkg.name !== manifest.package || pkg.version !== manifest.version) throw new Error("Core overrides require the pinned Operator version.");
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const changes = manifest.files.map(entry => {
    if (typeof entry.path !== "string" || entry.path.includes("\\") || entry.path.split("/").some(part => !part || part === "." || part === "..") || path.isAbsolute(entry.path)) throw new Error("Invalid override path.");
    const target = path.join(packageRoot, "dist", entry.path);
    const source = path.join(overrideRoot, "dist", entry.path);
    const bytes = fs.readFileSync(source);
    if (hash(bytes) !== entry.sha256) throw new Error(`Core override checksum mismatch: ${entry.path}`);
    const actual = fs.existsSync(target) ? hash(fs.readFileSync(target)) : null;
    if (actual !== entry.sha256 && actual !== entry.baseSha256) throw new Error(`Core changed outside the reviewed patch: ${entry.path}. Use an explicit OPERATOR_SOURCE for a local build.`);
    return { target, bytes, needed: actual !== entry.sha256 };
  });
  for (const {target,bytes,needed} of changes) if (needed) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  console.log(`проверены исправления ядра: ${changes.length} файлов`);
}

// Explicit local source builds keep Desktop and CLI changes together. Dependencies
// must match the installed core; copying source must not silently change them.
function stageLocalSource() {
  if (!process.env.OPERATOR_SOURCE) return;
  const source = path.resolve(process.env.OPERATOR_SOURCE);
  const pkg = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
  const installed = JSON.parse(fs.readFileSync(marker, "utf8"));
  if (pkg.name !== "pzero-operator" || pkg.version !== installed.version ||
      JSON.stringify(pkg.dependencies) !== JSON.stringify(installed.dependencies) ||
      JSON.stringify(pkg.optionalDependencies) !== JSON.stringify(installed.optionalDependencies) ||
      !fs.existsSync(path.join(source, "dist", "cli.js"))) {
    throw new Error("Local Operator source must match the bundled package version and dependencies and contain dist/cli.js.");
  }
  fs.cpSync(path.join(source, "dist"), path.join(path.dirname(marker), "dist"), { recursive: true });
  console.log(`локальное ядро ${pkg.version} скопировано из ${source}`);
}

if (fs.existsSync(marker)) {
  const installed = JSON.parse(fs.readFileSync(marker, "utf8")).version;
  if (wanted === "latest" || installed === wanted) {
    console.log(`operator ${installed} уже внутри — пропускаю загрузку`);
    if (process.env.OPERATOR_SOURCE) stageLocalSource();
    else applyCoreOverrides(path.dirname(marker));
    process.exit(0);
  }
}

fs.mkdirSync(root, { recursive: true });
if (!fs.existsSync(path.join(root, "package.json"))) {
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "operator-desk-vendor", private: true }, null, 2),
  );
}

console.log("загружаю operator в сборку…");
execFileSync("npm", ["install", `pzero-operator@${wanted}`, "--omit=dev", "--no-audit", "--no-fund"], {
  cwd: root,
  stdio: "inherit",
  // В Windows npm — это npm.cmd, а .cmd запускается только через оболочку.
  shell: process.platform === "win32",
});

const version = JSON.parse(fs.readFileSync(marker, "utf8")).version;
console.log(`operator ${version} готов к упаковке`);
if (process.env.OPERATOR_SOURCE) stageLocalSource();
else applyCoreOverrides(path.dirname(marker));
