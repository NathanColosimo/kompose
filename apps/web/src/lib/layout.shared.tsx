import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

// Shared layout options used by both the docs layout and any future
// non-docs Fumadocs layouts (e.g. a home layout with nav).
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "Kompose",
    },
  };
}
