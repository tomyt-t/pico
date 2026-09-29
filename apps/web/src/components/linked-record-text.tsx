import { Children, cloneElement, isValidElement, type ReactNode } from "react";

export type RecordLinks = Record<string, { href: string; title: string }>;
const uuid =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export function LinkedRecordText({
  children,
  links = {},
}: {
  children: ReactNode;
  links?: RecordLinks;
}) {
  return (
    <>
      {Children.map(children, (child) => {
        if (typeof child === "string") {
          const parts = child.split(uuid);
          const ids = child.match(uuid) ?? [];
          return parts.map((part, index) => {
            const id = ids[index];
            const link = id && links[id];
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: The index identifies a fixed segment of this immutable text.
              <span key={`${index}-${part.slice(0, 20)}`}>
                {part}
                {id &&
                  (link ? (
                    <a
                      href={link.href}
                      title={`${link.title} · ${id}`}
                      className="id-chip"
                    >
                      {id.slice(0, 8)}
                    </a>
                  ) : (
                    id
                  ))}
              </span>
            );
          });
        }
        if (
          isValidElement<{ children?: ReactNode; node?: { tagName?: string } }>(
            child,
          ) &&
          child.type !== "a" &&
          child.type !== "code" &&
          !["a", "code", "pre"].includes(child.props.node?.tagName ?? "") &&
          child.props.children
        )
          return cloneElement(
            child,
            {},
            <LinkedRecordText links={links}>
              {child.props.children}
            </LinkedRecordText>,
          );
        return child;
      })}
    </>
  );
}
