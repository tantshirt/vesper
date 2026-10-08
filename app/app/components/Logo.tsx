// Vesper logo — the "Architectural V" mark (from the Brand Direction Brief) plus the
// Fraunces wordmark. Brand hexes live in the static SVGs under /public/brand (not in this
// file), so the token guard stays clean. Use `reversed` on dark/indigo fields.
import Image from "next/image";

type LogoProps = {
  /** "full" = mark + wordmark (default); "mark" = symbol only. */
  variant?: "full" | "mark";
  /** Use the light-on-dark mark for indigo/midnight/dark surfaces. */
  reversed?: boolean;
  /** Rendered mark height in px (mark is square; wordmark scales alongside). */
  size?: number;
  className?: string;
};

export function Logo({ variant = "full", reversed = false, size = 26, className }: LogoProps) {
  const src = reversed ? "/brand/mark-reversed.svg" : "/brand/mark.svg";
  return (
    <span className={`logo${className ? ` ${className}` : ""}`} aria-label="Vesper">
      <Image src={src} alt="" width={size} height={size} priority className="logo-mark" />
      {variant === "full" && <span className="logo-word">Vesper</span>}
    </span>
  );
}
