/**
 * Уведомление на рабочий стол.
 *
 * В каждой системе оно вызывается своей программой: notify-send в Linux,
 * osascript в macOS, всплывающее окно PowerShell в Windows. Плагин не тянет
 * зависимостей — только то, что уже есть в системе.
 */
import { spawn } from "node:child_process";

const IS_MAC = process.platform === "darwin";
const IS_WINDOWS = process.platform === "win32";

function show(title, text) {
  if (IS_MAC) {
    const script = `display notification ${JSON.stringify(text)} with title ${JSON.stringify(title)}`;
    return spawn("osascript", ["-e", script], { stdio: "ignore" });
  }
  if (IS_WINDOWS) {
    const script =
      "[reflection.assembly]::loadwithpartialname('System.Windows.Forms');" +
      "[reflection.assembly]::loadwithpartialname('System.Drawing');" +
      "$n=New-Object System.Windows.Forms.NotifyIcon;" +
      "$n.Icon=[System.Drawing.SystemIcons]::Information;" +
      `$n.BalloonTipTitle=${JSON.stringify(title)};` +
      `$n.BalloonTipText=${JSON.stringify(text)};` +
      "$n.Visible=$true;$n.ShowBalloonTip(6000);Start-Sleep -Seconds 7;$n.Dispose()";
    return spawn("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script], {
      stdio: "ignore",
      windowsHide: true,
    });
  }
  return spawn("notify-send", ["-a", "Operator", title, text], { stdio: "ignore" });
}

export default function notifyPlugin({ operator }) {
  operator.registerTool({
    name: "notify",
    label: "Уведомление",
    description:
      "Показывает уведомление на рабочем столе. Уместно, когда долгая работа закончена " +
      "или нужно решение пользователя, а он мог отойти от экрана.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: {
        title: { type: "string", description: "Заголовок, по умолчанию «Operator»" },
        text: { type: "string", description: "Текст уведомления" },
      },
    },
    async execute(_id, params) {
      try {
        show(params.title || "Operator", params.text);
        return { content: [{ type: "text", text: "Уведомление показано." }], details: {} };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Не удалось показать уведомление: ${String(error)}` }],
          isError: true,
          details: {},
        };
      }
    },
  });
}
