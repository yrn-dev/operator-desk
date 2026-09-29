/**
 * Подсветка кода загружается только тогда, когда в ленте появился первый
 * блок кода: целиком highlight.js весит больше, чем всё остальное
 * приложение, и держать его в основном бандле незачем.
 *
 * Набор языков ограничен теми, что встречаются в работе агента, — полный
 * common тянет сорок грамматик и большинство из них никогда не нужны.
 */
import type { HLJSApi } from "highlight.js";

let loading: Promise<HLJSApi> | null = null;

export function highlighter(): Promise<HLJSApi> {
  if (!loading) {
    loading = (async () => {
      const { default: hljs } = await import("highlight.js/lib/core");

      const languages = await Promise.all([
        import("highlight.js/lib/languages/typescript"),
        import("highlight.js/lib/languages/javascript"),
        import("highlight.js/lib/languages/python"),
        import("highlight.js/lib/languages/go"),
        import("highlight.js/lib/languages/rust"),
        import("highlight.js/lib/languages/bash"),
        import("highlight.js/lib/languages/json"),
        import("highlight.js/lib/languages/yaml"),
        import("highlight.js/lib/languages/xml"),
        import("highlight.js/lib/languages/css"),
        import("highlight.js/lib/languages/sql"),
        import("highlight.js/lib/languages/markdown"),
        import("highlight.js/lib/languages/diff"),
        import("highlight.js/lib/languages/ini"),
        import("highlight.js/lib/languages/dockerfile"),
      ]);

      const names = [
        "typescript",
        "javascript",
        "python",
        "go",
        "rust",
        "bash",
        "json",
        "yaml",
        "xml",
        "css",
        "sql",
        "markdown",
        "diff",
        "ini",
        "dockerfile",
      ];

      languages.forEach((module, index) => hljs.registerLanguage(names[index], module.default));
      // Привычные псевдонимы: агент помечает блоки и так, и так.
      hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
      hljs.registerAliases(["js", "jsx", "mjs", "cjs"], { languageName: "javascript" });
      hljs.registerAliases(["py"], { languageName: "python" });
      hljs.registerAliases(["sh", "zsh", "shell", "console"], { languageName: "bash" });
      hljs.registerAliases(["yml"], { languageName: "yaml" });
      hljs.registerAliases(["html", "svg"], { languageName: "xml" });
      hljs.registerAliases(["toml"], { languageName: "ini" });
      hljs.registerAliases(["patch"], { languageName: "diff" });

      return hljs;
    })();
  }
  return loading;
}
