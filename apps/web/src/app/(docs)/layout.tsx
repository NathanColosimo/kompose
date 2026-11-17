import "./docs.css";
import { RootDocument, rootMetadata } from "@/components/root-document";

export const metadata = rootMetadata;

export default function DocsRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RootDocument>{children}</RootDocument>;
}
