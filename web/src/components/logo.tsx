import type { CSSProperties } from "react";

/** Pico's mark: a flask on the accent tile. */
export function Logo({ size = 28 }: { size?: number }) {
  const inner = Math.round(size * 0.62);
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.round(size / 4),
  };
  return (
    <span className="pico-mark" style={style} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        width={inner}
        height={inner}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        role="img"
        aria-label="Pico"
      >
        <title>Pico</title>
        <path d="M10 2v6.3a2 2 0 0 1-.25 1L4.7 18.2A2 2 0 0 0 6.45 21h11.1a2 2 0 0 0 1.75-2.8L14.25 9.3a2 2 0 0 1-.25-1V2" />
        <path d="M8.5 2h7M6.5 15h11" />
      </svg>
    </span>
  );
}
