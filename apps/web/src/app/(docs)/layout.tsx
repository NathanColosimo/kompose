import { RootDocument, rootMetadata } from "@/components/root-document";
import "./docs.css";

export const metadata = rootMetadata;

// A root layout of its own, so docs.css only ever loads on /docs.
export default function DocsRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RootDocument>{children}</RootDocument>;
}
