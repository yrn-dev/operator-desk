/**
 * Кладёт operator внутрь приложения, чтобы пользователю не требовалось
 * ставить его отдельно. Запускается перед сборкой дистрибутивов.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("vendor");
const marker = path.join(root, "node_modules", "pzero-operator", "package.json");

// Версия ядра закреплена: сборки на разных машинах должны быть одинаковыми.
const PINNED = "1.2.3";
const wanted = process.env.OPERATOR_VERSION ?? PINNED;

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
    stageLocalSource();
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
stageLocalSource();
