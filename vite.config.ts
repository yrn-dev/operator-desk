import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron/simple";
import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brandIconsOutdated, buildBrandIcons } from "./scripts/build-brand-icons.mjs";

/**
 * Мост и плагины не проходят через сборщик: их грузит отдельный процесс
 * агента, поэтому они кладутся в dist как есть.
 */
function copyRuntimeFiles() {
  const copy = () => {
    for (const folder of ["bridge", "plugins"]) {
      mkdirSync(`dist-electron/${folder}`, { recursive: true });
      cpSync(`electron/${folder}`, `dist-electron/${folder}`, { recursive: true });
    }
  };
  // Набор знаков для плагинов собирается из simple-icons один раз на версию пакета.
  const brands = () => {
    const target = "dist-electron/brand-icons.json";
    if (brandIconsOutdated(target)) buildBrandIcons(target);
  };
  return {
    name: "copy-desk-runtime",
    buildStart: () => {
      copy();
      brands();
    },
    closeBundle: () => {
      copy();
      brands();
    },
  };
}

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  base: "./",
  build: {
    // Шрифты не встраиваем в CSS: политика безопасности запрещает data:,
    // да и отдельным файлом они кешируются, а не разбухают в стилях.
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
  },
  plugins: [
    tailwindcss(),
    copyRuntimeFiles(),
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: { define: { __OPERATOR_SERVICE_URL__: JSON.stringify(process.env.OPERATOR_SERVICE_URL ?? "") } },
      },
      preload: {
        input: "electron/preload.ts",
        vite: {
          build: {
            rollupOptions: {
              output: { format: "cjs", entryFileNames: "preload.cjs" },
            },
          },
        },
      },
    }),
  ],
});
