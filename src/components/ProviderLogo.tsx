const brands: Record<string, { src: string; label: string; width: number; height: number; x: number; y: number; fullWidth: number; monochrome?: boolean }> = {
  "alem-ai": { src: new URL("../assets/providers/alem-plus.png", import.meta.url).href, label: "Alem Plus", width: 2133, height: 501, x: 0, y: 0, fullWidth: 2133 },
  // Display the complete visible mark; ignore only the transparent canvas padding.
  ollama: { src: new URL("../assets/providers/ollama.webp", import.meta.url).href, label: "Ollama", width: 469, height: 160, x: 24, y: 170, fullWidth: 500, monochrome: true },
};

export function hasProviderLogo(provider: string): boolean { return Object.hasOwn(brands, provider); }

/** Wordmarks retain their own aspect ratios; no square masks or stretched images. */
export function ProviderLogo({ provider, compact = false }: { provider: string; compact?: boolean }) {
  const brand = hasProviderLogo(provider) ? brands[provider] : undefined;
  if (!brand) return null;
  const width = compact ? provider === "ollama" ? 64 : 72 : provider === "ollama" ? 92 : 112;
  return <span data-provider-logo={provider} data-logo-size={compact ? "compact" : "normal"}
    role="img" aria-label={brand.label} title={brand.label}
    style={{ display: "inline-block", position: "relative", overflow: "hidden", flex: "none", width, height: width * brand.height / brand.width, verticalAlign: "middle" }}>
    <img src={brand.src} alt="" draggable={false} style={{ position: "absolute", display: "block",
      width: `${brand.fullWidth / brand.width * 100}%`, maxWidth: "none", height: "auto",
      left: `${-brand.x / brand.width * 100}%`, top: `${-brand.y / brand.height * 100}%`,
      filter: brand.monochrome ? "invert(1)" : undefined }} />
  </span>;
}
