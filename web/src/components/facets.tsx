import type { ReactNode } from "react";

/** A row of toggles that narrow a list. One group per dimension. */
export function Facets({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="facets">
      <legend className="sr-only">{label}</legend>
      {children}
    </fieldset>
  );
}

export function Facet({
  pressed,
  count,
  onClick,
  children,
}: {
  pressed: boolean;
  count?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="facet"
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
      {count !== undefined && <span className="facet-count">{count}</span>}
    </button>
  );
}
