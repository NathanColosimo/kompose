import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

// Fumadocs adds its docs context and navigation inside the root app providers.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RootProvider>
      <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
