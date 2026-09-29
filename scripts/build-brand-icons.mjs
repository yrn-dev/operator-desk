/**
 * Собирает набор официальных знаков для плагинов из пакета simple-icons.
 *
 * На выходе один JSON вида { slug: [название, цвет, контур] } — его читает
 * главный процесс, когда подбирает логотип плагину. В рендерер набор целиком
 * не попадает: туда уходят только контуры найденных знаков.
 *
 * Запуск: node scripts/build-brand-icons.mjs <куда записать>
 * Сборка вызывает его сама, когда набора ещё нет или пакет обновился.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function buildBrandIcons(target) {
  const source = path.join(root, "node_modules", "simple-icons");
  const iconsDir = path.join(source, "icons");
  if (!fs.existsSync(iconsDir)) return { ok: false, reason: "simple-icons не установлен" };

  const meta = JSON.parse(fs.readFileSync(path.join(source, "data", "simple-icons.json"), "utf8"));
  const colors = new Map((Array.isArray(meta) ? meta : meta.icons).map((item) => [item.title, item.hex]));

  const icons = {};
  for (const file of fs.readdirSync(iconsDir)) {
    if (!file.endsWith(".svg")) continue;
    const svg = fs.readFileSync(path.join(iconsDir, file), "utf8");
    const shape = svg.match(/ d="([^"]+)"/);
    const title = svg.match(/<title>([^<]+)<\/title>/)?.[1] ?? file.slice(0, -4);
    if (!shape) continue;
    icons[file.slice(0, -4)] = [title, colors.get(title) ?? "888888", shape[1]];
  }

  const version = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8")).version;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ version, icons }));
  return { ok: true, count: Object.keys(icons).length, version };
}

/** Нужно ли пересобирать: набора нет или он от другой версии пакета. */
export function brandIconsOutdated(target) {
  try {
    const current = JSON.parse(
      fs.readFileSync(path.join(root, "node_modules", "simple-icons", "package.json"), "utf8"),
    ).version;
    const head = fs.readFileSync(target, "utf8").slice(0, 60);
    return !head.includes(`"version":"${current}"`);
  } catch {
    return true;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const target = process.argv[2] ?? path.join(root, "dist-electron", "brand-icons.json");
  const result = buildBrandIcons(target);
  console.log(result.ok ? `знаков: ${result.count} (simple-icons ${result.version})` : result.reason);
}
