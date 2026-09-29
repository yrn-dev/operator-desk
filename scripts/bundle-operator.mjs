/**
 * Кладёт operator внутрь приложения, чтобы пользователю не требовалось
 * ставить его отдельно. Запускается перед сборкой дистрибутивов.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("vendor");
const marker = path.join(root, "node_modules", "pzero-operator", "package.json");

const wanted = process.env.OPERATOR_VERSION ?? "latest";

if (fs.existsSync(marker) && wanted === "latest") {
  const installed = JSON.parse(fs.readFileSync(marker, "utf8")).version;
  console.log(`operator ${installed} уже внутри — пропускаю загрузку`);
  process.exit(0);
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
});

const version = JSON.parse(fs.readFileSync(marker, "utf8")).version;
console.log(`operator ${version} готов к упаковке`);
