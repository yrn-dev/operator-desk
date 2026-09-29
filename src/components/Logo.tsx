import logoMarkup from "../assets/logo.svg?raw";

/**
 * Знак ProjectZero: голова в профиль одной линией с атомом.
 * Рисунок обрезан до квадрата вокруг головы и вставляется прямо в разметку,
 * чтобы линия наследовала цвет текста через currentColor.
 */
const sized = (size: number) =>
  logoMarkup
    .replace(/\s(width|height)="[^"]*"/g, "")
    .replace("<svg", `<svg width="${size}" height="${size}"`);

export function Logo({ size = 20, opacity = 1 }: { size?: number; opacity?: number }) {
  return (
    <span
      style={{ display: "inline-flex", opacity, flex: "none", lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: sized(size) }}
    />
  );
}
