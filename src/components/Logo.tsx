import intro from "../assets/oneline-head-intro.svg?url";
import still from "../assets/oneline-head-still.svg?url";

/** Логотип одной линией: быстро рисуется при открытии, остаётся видимым. */
export function Logo({ size = 360, opacity = 1 }: { size?: number; opacity?: number }) {
  return (
    <picture className="hello-logo" style={{ width: size, opacity }}>
      <source media="(prefers-reduced-motion: reduce)" srcSet={still} />
      <img src={intro} width="569" height="350" alt="Operator" draggable={false} />
    </picture>
  );
}
