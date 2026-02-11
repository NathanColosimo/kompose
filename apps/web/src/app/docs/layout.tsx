import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

// Self-contained layout for /docs/* routes.
// Uses Fumadocs' own RootProvider (includes theme) and DocsLayout (sidebar + nav)
// so the docs route is fully isolated from the main app's provider stack.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RootProvider>
      <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
