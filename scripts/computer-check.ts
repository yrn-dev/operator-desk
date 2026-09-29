/** Проверка окружения и снимка экрана. */
import { inspectEnvironment, createComputerTool } from "../electron/bridge/computer.mjs";

const env = inspectEnvironment();
console.log("снимок экрана:", env.screenshot ?? "нет");
console.log("ввод:", env.input ?? "нет");
console.log("не хватает:", env.missing.length ? env.missing.join(", ") : "ничего");

const tool = createComputerTool(() => true);
const shot: any = await tool.execute("t", { action: "screenshot" } as any);
const image = shot.content.find((c: any) => c.type === "image");
console.log(`\nснимок сделан: ${image ? `да, ${Math.round(image.data.length / 1024)} КБ base64` : "нет"}`);
if (!image) console.log(shot.content.map((c: any) => c.text).join(" "));

const windows: any = await tool.execute("t", { action: "windows" } as any);
console.log("\nокна:\n" + windows.content[0].text.split("\n").slice(0, 5).join("\n"));

process.exit(image ? 0 : 1);
