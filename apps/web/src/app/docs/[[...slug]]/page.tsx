import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { source } from "@/lib/source";
import { getMDXComponents } from "@/mdx-components";

// Catch-all route that renders individual doc pages.
// Fumadocs' DocsPage provides TOC, breadcrumbs, and prev/next pagination.
export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) {
    notFound();
  }

  const MDX = page.data.body;

  return (
    <DocsPage full={page.data.full} toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // Fumadocs currently narrows `source.resolveHref` too aggressively in this generic.
            // Runtime behavior is correct, so we widen to the helper's expected type here.
            a: createRelativeLink(
              source as unknown as Parameters<typeof createRelativeLink>[0],
              page as unknown as Parameters<typeof createRelativeLink>[1]
            ),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

// Pre-render all doc pages at build time for static export compatibility.
export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) {
    notFound();
  }
  return { title: page.data.title, description: page.data.description };
}
