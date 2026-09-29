/** Снимок экрана средствами Electron, без внешних программ. */
import { app, desktopCapturer, screen } from "electron";

await app.whenReady();
const display = screen.getPrimaryDisplay();
const scale = Math.min(1, 1280 / display.size.width);
const sources = await desktopCapturer.getSources({
  types: ["screen"],
  thumbnailSize: {
    width: Math.round(display.size.width * scale),
    height: Math.round(display.size.height * scale),
  },
});
const source = sources[0];
const png = source?.thumbnail.toPNG();
console.log(`экранов: ${sources.length} · снимок: ${png && png.length > 0 ? `${Math.round(png.length / 1024)} КБ` : "пусто"}`);
app.quit();
