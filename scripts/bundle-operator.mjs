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

if (fs.existsSync(marker)) {
  const installed = JSON.parse(fs.readFileSync(marker, "utf8")).version;
  if (wanted === "latest" || installed === wanted) {
    console.log(`operator ${installed} уже внутри — пропускаю загрузку`);
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
