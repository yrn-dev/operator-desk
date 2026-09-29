/**
 * Управление компьютером: агент видит экран и действует мышью и клавиатурой.
 *
 * Под каждую систему свой набор внешних программ, поэтому инструмент сначала
 * определяет, что доступно, и честно сообщает, чего не хватает, вместо того
 * чтобы молча ничего не делать.
 *
 *   Linux X11      скриншот import/scrot, ввод xdotool
 *   Linux Wayland  скриншот grim/spectacle, ввод ydotool (нужен запущенный ydotoold)
 *   macOS          скриншот screencapture, ввод osascript (System Events)
 *   Windows        скриншот и ввод через PowerShell и user32
 */
import { execFile, spawn } from "node:child_process";
import os_ from "node:os";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "typebox";

const IS_MAC = process.platform === "darwin";
const IS_WINDOWS = process.platform === "win32";
const IS_WAYLAND = !IS_MAC && !IS_WINDOWS && process.env.XDG_SESSION_TYPE === "wayland";
const SHOT_DIR = process.env.OPERATOR_DESK_SHOTS ?? "";

function has(command) {
  const dirs = (process.env.PATH ?? "").split(path.delimiter);
  return dirs.some((dir) => {
    try {
      fs.accessSync(path.join(dir, command), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 20_000, ...options }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: String(stdout ?? ""), err: String(stderr ?? error?.message ?? "") });
    });
  });
}

/** Что доступно в этой системе: список пробелов пригодится в сообщении об ошибке. */
export function inspectEnvironment() {
  if (IS_WINDOWS) {
    return { screenshot: ["powershell"], input: "powershell", missing: [] };
  }
  if (IS_MAC) {
    const missing = [];
    if (!has("screencapture")) missing.push("screencapture");
    if (!has("osascript")) missing.push("osascript");
    return { screenshot: ["screencapture"], input: "osascript", missing };
  }

  const order = IS_WAYLAND
    ? ["grim", "spectacle", "import"]
    : ["import", "scrot", "grim", "spectacle"];
  const screenshot = order.filter((tool) => has(tool));

  const input = IS_WAYLAND ? (has("ydotool") ? "ydotool" : null) : has("xdotool") ? "xdotool" : null;

  const missing = [];
  if (screenshot.length === 0) missing.push(IS_WAYLAND ? "grim или spectacle" : "imagemagick или scrot");
  if (!input) missing.push(IS_WAYLAND ? "ydotool (и запущенный ydotoold)" : "xdotool");

  return { screenshot, input, missing };
}

/** Снимок экрана в файл. */
async function capture(target, backend) {
  switch (backend) {
    case "grim":
      return run("grim", [target]);
    case "spectacle":
      return run("spectacle", ["-b", "-n", "-f", "-o", target], { timeout: 25_000 });
    case "import":
      return run("import", ["-window", "root", target]);
    case "scrot":
      return run("scrot", ["-o", target]);
    case "screencapture":
      return run("screencapture", ["-x", target]);
    case "powershell":
      return run("powershell", [
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
          `$b=[System.Windows.Forms.SystemInformation]::VirtualScreen; ` +
          `$img=New-Object System.Drawing.Bitmap $b.Width,$b.Height; ` +
          `$g=[System.Drawing.Graphics]::FromImage($img); ` +
          `$g.CopyFromScreen($b.Left,$b.Top,0,0,$img.Size); ` +
          `$img.Save('${target}');`,
      ]);
    default:
      return { ok: false, err: "нечем снять экран" };
  }
}

/**
 * Программа снимка пишет файл не мгновенно: если прочитать его сразу,
 * получится обрезанный PNG, и модель увидит пустоту. Ждём, пока файл
 * перестанет расти и появится завершающий блок IEND.
 */
async function waitForCompleteImage(file, limit = 8000) {
  let previous = -1;
  for (let waited = 0; waited < limit; waited += 120) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }
    if (size === 0 || size !== previous) {
      previous = size;
      continue;
    }
    // Размер не меняется — проверяем, что PNG дописан до конца.
    try {
      const tail = Buffer.alloc(8);
      const handle = fs.openSync(file, "r");
      fs.readSync(handle, tail, 0, 8, Math.max(0, size - 8));
      fs.closeSync(handle);
      if (tail.includes("IEND")) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/** Размер PNG из заголовка IHDR — без внешних программ. */
function pngSize(file) {
  try {
    const head = Buffer.alloc(24);
    const fd = fs.openSync(file, "r");
    fs.readSync(fd, head, 0, 24, 0);
    fs.closeSync(fd);
    if (head.toString("latin1", 12, 16) !== "IHDR") return null;
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/**
 * Уменьшаем снимок: полноразмерный экран стоит слишком много токенов.
 * Ниже 2000px по ширине модель начинает путать мелкий текст интерфейса
 * (замер на скриншоте 2560×1600: 2000px — 40 строк таблицы из 40, 1280px — 18).
 */
async function shrink(file, width = 2000) {
  if (has("magick")) await run("magick", [file, "-resize", `${width}>`, file]);
  else if (has("convert")) await run("convert", [file, "-resize", `${width}>`, file]);
  else return;
  // После пересжатия файл переписывается заново — дожидаемся целого PNG.
  await waitForCompleteImage(file, 4000);
}

const POWERSHELL_INPUT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e);
}
"@
`;

async function pointer(action, params, backend) {
  const { button = "left", amount = 3 } = params;
  // Модель называет координаты по шкале 0–1000 — переводим их в точки экрана.
  const x = toScreen(params.x, "width");
  const y = toScreen(params.y, "height");

  if (backend === "xdotool") {
    if (action === "move") return run("xdotool", ["mousemove", String(x), String(y)]);
    if (action === "scroll") {
      const wheel = amount > 0 ? "5" : "4";
      return run("xdotool", ["mousemove", String(x), String(y), "click", "--repeat", String(Math.abs(amount)), wheel]);
    }
    const code = button === "right" ? "3" : button === "middle" ? "2" : "1";
    const args = ["mousemove", String(x), String(y), "click"];
    if (action === "double_click") args.push("--repeat", "2");
    args.push(code);
    return run("xdotool", args);
  }

  if (backend === "ydotool") {
    if (action === "move") return run("ydotool", ["mousemove", "--absolute", "-x", String(x), "-y", String(y)]);
    await run("ydotool", ["mousemove", "--absolute", "-x", String(x), "-y", String(y)]);
    if (action === "scroll") return run("ydotool", ["mousemove", "-w", "-y", String(amount)]);
    // 0xC0 — левая, 0xC1 — правая, 0xC2 — средняя (нажатие с отпусканием).
    const code = button === "right" ? "0xC1" : button === "middle" ? "0xC2" : "0xC0";
    const times = action === "double_click" ? 2 : 1;
    for (let i = 0; i < times; i++) await run("ydotool", ["click", code]);
    return { ok: true, out: "" };
  }

  if (backend === "osascript") {
    const clicks = action === "double_click" ? 2 : 1;
    const script =
      action === "move"
        ? `do shell script "cliclick m:${x},${y}"`
        : `do shell script "cliclick ${button === "right" ? "rc" : action === "double_click" ? "dc" : "c"}:${x},${y}"`;
    if (has("cliclick")) return run("osascript", ["-e", script]);
    // Без cliclick доступны только клавиатурные действия.
    return { ok: false, err: "для мыши на macOS нужен cliclick (brew install cliclick)" };
  }

  if (backend === "powershell") {
    const flags =
      action === "scroll"
        ? null
        : button === "right"
          ? ["0x0008", "0x0010"]
          : ["0x0002", "0x0004"];
    const clicks = action === "double_click" ? 2 : 1;
    const body =
      action === "move"
        ? `[Win]::SetCursorPos(${x},${y});`
        : action === "scroll"
          ? `[Win]::SetCursorPos(${x},${y}); [Win]::mouse_event(0x0800,0,0,[uint32](${amount} * -120),0);`
          : `[Win]::SetCursorPos(${x},${y}); ` +
            Array.from({ length: clicks })
              .map(() => `[Win]::mouse_event(${flags[0]},0,0,0,0); [Win]::mouse_event(${flags[1]},0,0,0,0);`)
              .join(" ");
    return run("powershell", ["-NoProfile", "-Command", POWERSHELL_INPUT + body]);
  }

  return { ok: false, err: "нечем управлять мышью" };
}

async function typeText(text, backend) {
  if (backend === "xdotool") return run("xdotool", ["type", "--delay", "12", text]);
  if (backend === "ydotool") return run("ydotool", ["type", text]);
  if (backend === "osascript")
    return run("osascript", ["-e", `tell application "System Events" to keystroke ${JSON.stringify(text)}`]);
  if (backend === "powershell")
    return run("powershell", [
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${JSON.stringify(text)})`,
    ]);
  return { ok: false, err: "нечем печатать" };
}

/** Имена клавиш приводим к тому, что понимает конкретная программа. */
function keyFor(backend, combo) {
  const parts = combo.split("+").map((part) => part.trim().toLowerCase());
  if (backend === "xdotool") {
    return parts
      .map((part) => ({ ctrl: "ctrl", alt: "alt", shift: "shift", meta: "super", enter: "Return", esc: "Escape", tab: "Tab", space: "space", backspace: "BackSpace", delete: "Delete" })[part] ?? part)
      .join("+");
  }
  if (backend === "ydotool") {
    const map = { ctrl: "29", shift: "42", alt: "56", meta: "125", enter: "28", esc: "1", tab: "15", space: "57", backspace: "14", delete: "111" };
    return parts.map((part) => map[part] ?? part).join("+");
  }
  return parts.join("+");
}

async function pressKey(combo, backend) {
  if (backend === "xdotool") return run("xdotool", ["key", keyFor("xdotool", combo)]);
  if (backend === "ydotool") {
    const codes = keyFor("ydotool", combo).split("+");
    const sequence = [...codes.map((code) => `${code}:1`), ...codes.reverse().map((code) => `${code}:0`)];
    return run("ydotool", ["key", ...sequence]);
  }
  if (backend === "osascript") {
    const modifiers = [];
    const parts = combo.split("+").map((p) => p.trim().toLowerCase());
    const key = parts.pop();
    for (const part of parts) {
      if (part === "ctrl") modifiers.push("control down");
      if (part === "alt") modifiers.push("option down");
      if (part === "shift") modifiers.push("shift down");
      if (part === "meta" || part === "cmd") modifiers.push("command down");
    }
    const using = modifiers.length ? ` using {${modifiers.join(", ")}}` : "";
    return run("osascript", ["-e", `tell application "System Events" to keystroke "${key}"${using}`]);
  }
  if (backend === "powershell") {
    const parts = combo.split("+").map((p) => p.trim().toLowerCase());
    const key = parts.pop();
    const prefix = parts.map((p) => ({ ctrl: "^", alt: "%", shift: "+" })[p] ?? "").join("");
    const named = { enter: "{ENTER}", esc: "{ESC}", tab: "{TAB}", backspace: "{BACKSPACE}", delete: "{DEL}" }[key] ?? key;
    return run("powershell", [
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${prefix}${named}')`,
    ]);
  }
  return { ok: false, err: "нечем нажимать клавиши" };
}

async function listWindows() {
  if (IS_WINDOWS) {
    const result = await run("powershell", [
      "-NoProfile",
      "-Command",
      "Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object -First 30 Id,MainWindowTitle | Format-Table -HideTableHeaders",
    ]);
    return result.out.trim();
  }
  if (IS_MAC) {
    const result = await run("osascript", [
      "-e",
      'tell application "System Events" to get name of every process whose visible is true',
    ]);
    return result.out.trim();
  }
  if (has("wmctrl")) {
    const result = await run("wmctrl", ["-l"]);
    if (result.out.trim()) return result.out.trim();
  }
  const result = await run("sh", ["-c", "ps -eo comm= | sort -u | head -40"]);
  return result.out.trim();
}

async function openApp(target) {
  if (IS_WINDOWS) return run("powershell", ["-NoProfile", "-Command", `Start-Process ${JSON.stringify(target)}`]);
  if (IS_MAC) return run("open", ["-a", target].slice(target.startsWith("/") ? 1 : 0));
  // На Linux запускаем отдельно от агента, иначе окно закроется вместе с сессией.
  const child = spawn("sh", ["-c", `setsid ${target} >/dev/null 2>&1 &`], { detached: true, stdio: "ignore" });
  child.unref();
  return { ok: true, out: `запущено: ${target}` };
}

const parameters = Type.Object(
  {
    action: Type.Union(
      [
        Type.Literal("screenshot"),
        Type.Literal("click"),
        Type.Literal("double_click"),
        Type.Literal("right_click"),
        Type.Literal("move"),
        Type.Literal("scroll"),
        Type.Literal("type"),
        Type.Literal("key"),
        Type.Literal("open"),
        Type.Literal("windows"),
        Type.Literal("wait"),
      ],
      { description: "Что сделать на экране" },
    ),
    x: Type.Optional(Type.Number({ description: "Координата X по шкале 0–1000 от левого края снимка к правому" })),
    y: Type.Optional(Type.Number({ description: "Координата Y по шкале 0–1000 от верхнего края снимка к нижнему" })),
    text: Type.Optional(Type.String({ description: "Текст для action=type" })),
    keys: Type.Optional(Type.String({ description: "Комбинация для action=key, например ctrl+s или alt+tab" })),
    app: Type.Optional(Type.String({ description: "Команда или имя приложения для action=open" })),
    amount: Type.Optional(Type.Number({ description: "Величина прокрутки: положительная — вниз" })),
    seconds: Type.Optional(Type.Number({ description: "Пауза для action=wait" })),
  },
  { additionalProperties: false },
);

/**
 * Снимок нельзя вернуть прямо в результате инструмента: в Chat Completions
 * сообщение роли tool несёт только текст, и картинка до модели не доходит.
 * Поэтому изображение отправляется отдельным сообщением пользователя.
 */
/**
 * Координаты модель называет по шкале 0–1000, а не в пикселях: так обучены
 * модели Qwen-VL. Замер на qwen3-8: в пикселях — 0 попаданий в кнопки из 16
 * (координаты даже выходят за край снимка), в шкале 0–1000 — 16 из 16.
 * Храним размер последнего снимка в точках ввода, чтобы перевести клик на экран.
 */
let shotSize = null;

function toScreen(value, axis) {
  const v = Math.min(1000, Math.max(0, value ?? 0));
  return shotSize ? Math.round((v / 1000) * shotSize[axis]) : Math.round(v);
}

/**
 * Разбор снимка отдельным процессом operator. У модели предел в одну картинку
 * на диалог, поэтому смотреть экран в основной сессии нельзя: каждый снимок
 * уходит в чистый одноразовый процесс, а сюда возвращается текстовый разбор.
 */
async function describeScreen(file, model) {
  const entry = process.argv[1] ?? "";
  const viaElectron = entry.endsWith("cli.js") && process.execPath;
  const command = viaElectron ? process.execPath : process.env.OPERATOR_DESK_BIN || "opr";
  const prefix = viaElectron ? [entry] : [];

  const ask =
    "Это снимок экрана. Ответь строго по делу, без вступлений:\n" +
    "1) Одно предложение: что сейчас на экране (какое окно активно, что в нём).\n" +
    "2) Список видимых элементов, с которыми можно взаимодействовать — кнопки, поля ввода, " +
    "вкладки, пункты меню, ссылки. Для каждого: «подпись — (x, y)», где x и y — центр элемента " +
    "по шкале от 0 до 1000: x от левого края изображения (0) к правому (1000), y от верхнего (0) к нижнему (1000).\n" +
    "3) Важный текст на экране — заголовки, сообщения, ошибки, содержимое полей — дословно.\n" +
    "Перечисляй только то, что действительно видно.";

  // Без инструментов: зритель должен смотреть на снимок, а не исследовать систему.
  const args = [...prefix, "--print", "--no-session", "--no-tools"];
  if (model?.provider) args.push("--provider", model.provider);
  if (model?.id) args.push("--model", model.id);
  args.push(`@${file}`, ask);

  const devNull = fs.openSync(os_.devNull, "r");
  const child = spawn(command, args, {
    env: { ...process.env, NO_COLOR: "1", ...(viaElectron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
    stdio: [devNull, "pipe", "pipe"],
  });

  let out = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (out += chunk));

  const stop = setTimeout(() => child.kill(), 180_000);
  const code = await new Promise((resolve) => {
    child.on("error", () => resolve(-1));
    child.on("close", (value) => resolve(value ?? -1));
  });
  clearTimeout(stop);
  try {
    fs.closeSync(devNull);
  } catch {
    // Уже закрыт.
  }

  return code === 0 ? out.trim() : "";
}

/** Готовит ответ по снимку: считает масштаб и просит зрителя описать экран. */
async function analyse(file, ctx) {
  const env = inspectEnvironment();

  if (!seesImages(ctx?.model)) {
    return {
      content: [
        {
          type: "text",
          text:
            `Снимок сделан, но модель ${ctx?.model?.id ?? "?"} не умеет смотреть картинки. ` +
            "Попроси пользователя выбрать модель со зрением — например qwen3-8.",
        },
      ],
      isError: true,
      details: env,
    };
  }

  const description = await describeScreen(file, ctx?.model);
  if (!description) {
    return {
      content: [{ type: "text", text: "Снимок сделан, но разобрать его не удалось." }],
      isError: true,
      details: env,
    };
  }

  return {
    content: [
      {
        type: "text",
        text:
          `${description}\n\n` +
          "Координаты выше даны по шкале 0–1000 — передавай их в click и move как есть, " +
          "инструмент сам приведёт их к экрану.",
      },
    ],
    details: { ...env, size: shotSize },
  };
}

/** Модель без поддержки картинок снимок просто не увидит — предупреждаем сразу. */
function seesImages(model) {
  const input = model?.input;
  return !Array.isArray(input) || input.includes("image");
}

/** Приложение кладёт рядом со снимком размер экрана в точках ввода. */
function readCaptureSize(file) {
  try {
    const size = JSON.parse(fs.readFileSync(`${file}.json`, "utf8"));
    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

/**
 * Снимок просит сделать само приложение: у Electron это работает без внешних
 * программ и одинаково во всех системах. Ждём появления файла с ответом.
 */
async function captureViaApp(requestCapture) {
  if (!SHOT_DIR || !requestCapture) return null;
  const id = `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const file = path.join(SHOT_DIR, `${id}.png`);

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  requestCapture(id);

  for (let waited = 0; waited < 5000; waited += 150) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) {
        return (await waitForCompleteImage(file, 3000)) ? file : null;
      }
    } catch {
      // Файл ещё пишется.
    }
  }
  return null;
}

export function createComputerTool(isEnabled, sendImage, requestCapture) {
  return {
    name: "computer",
    label: "Экран",
    description:
      "Управление компьютером: снимок экрана, клики, ввод текста, горячие клавиши, запуск приложений. " +
      "Работай циклом: сделай screenshot, найди на нём нужный элемент, кликни по его координатам, снова screenshot — " +
      "и убедись, что получилось. Координаты бери прямо со снимка, который тебе вернули. " +
      "Если задачу можно решить через bash или API приложения — делай так, это надёжнее.",
    promptSnippet: "computer — снимок экрана, клики и ввод: управление компьютером как человек",
    parameters,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!isEnabled()) {
        return {
          content: [
            {
              type: "text",
              text: "Управление экраном выключено. Пользователь включает его кнопкой «Автопилот» рядом с полем ввода.",
            },
          ],
          isError: true,
          details: {},
        };
      }

      const env = inspectEnvironment();

      if (params.action === "wait") {
        await new Promise((resolve) => setTimeout(resolve, Math.min(params.seconds ?? 1, 30) * 1000));
        return { content: [{ type: "text", text: "жду" }], details: {} };
      }

      if (params.action === "windows") {
        const text = await listWindows();
        return { content: [{ type: "text", text: text || "окон не видно" }], details: {} };
      }

      if (params.action === "open") {
        if (!params.app) {
          return { content: [{ type: "text", text: "не указано приложение" }], isError: true, details: {} };
        }
        const result = await openApp(params.app);
        return {
          content: [{ type: "text", text: result.ok ? `Открываю ${params.app}` : `Не вышло: ${result.err}` }],
          isError: !result.ok,
          details: {},
        };
      }

      if (params.action === "screenshot") {
        // Сначала просим снимок у приложения — это не требует ничего ставить.
        const viaApp = await captureViaApp(requestCapture);
        if (viaApp) {
          shotSize = readCaptureSize(viaApp) ?? pngSize(viaApp);
          fs.rmSync(`${viaApp}.json`, { force: true });
          await shrink(viaApp);
          const text = await analyse(viaApp, ctx);
          fs.rmSync(viaApp, { force: true });
          return text;
        }

        if (env.screenshot.length === 0) {
          return {
            content: [{ type: "text", text: `Снимок экрана недоступен: не хватает ${env.missing.join(", ")}` }],
            isError: true,
            details: env,
          };
        }
        const file = path.join(os.tmpdir(), `desk-shot-${Date.now()}.png`);
        let taken = false;
        let lastError = "";
        for (const backend of env.screenshot) {
          fs.rmSync(file, { force: true });
          const result = await capture(file, backend);
          // Программа может завершиться успешно, но файл не создать или не дописать.
          if (result.ok && fs.existsSync(file) && (await waitForCompleteImage(file))) {
            taken = true;
            break;
          }
          lastError = result.err || `${backend} не дал целого снимка`;
        }
        if (!taken) {
          return {
            content: [{ type: "text", text: `Снимок не получился: ${lastError.slice(0, 200)}` }],
            isError: true,
            details: env,
          };
        }
        // Внешняя программа снимает в физических пикселях — в них же работает ввод.
        shotSize = pngSize(file);
        await shrink(file);
        const analysed = await analyse(file, ctx);
        fs.rmSync(file, { force: true });
        return analysed;
      }

      // Дальше всё требует ввода.
      if (!env.input) {
        const hint = IS_WAYLAND
          ? "В сеансе Wayland ввод делает ydotool: установите его и запустите службу ydotoold."
          : "Нужна программа ввода для вашей системы.";
        return {
          content: [{ type: "text", text: `Управление мышью и клавиатурой недоступно: не хватает ${env.missing.join(", ")}. ${hint}` }],
          isError: true,
          details: env,
        };
      }

      let result;
      switch (params.action) {
        case "type":
          result = await typeText(params.text ?? "", env.input);
          break;
        case "key":
          result = await pressKey(params.keys ?? "", env.input);
          break;
        case "right_click":
          result = await pointer("click", { ...params, button: "right" }, env.input);
          break;
        default:
          result = await pointer(params.action, params, env.input);
      }

      return {
        content: [
          {
            type: "text",
            text: result.ok
              ? `Сделано: ${params.action}${params.x !== undefined ? ` в (${params.x}, ${params.y})` : ""}. Сделай screenshot, чтобы проверить результат.`
              : `Не вышло: ${result.err.slice(0, 200)}`,
          },
        ],
        isError: !result.ok,
        details: env,
      };
    },
  };
}
