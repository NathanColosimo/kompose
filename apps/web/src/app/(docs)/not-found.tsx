import type { Metadata } from "next";
import { NotFoundMessage } from "@/components/not-found-message";

export const metadata: Metadata = {
  title: "404: This page could not be found.",
};

// Missing docs pages render here, inside the docs root layout but above the
// docs sidebar, as Next's built-in 404 did with one root layout.
export default function DocsNotFound() {
  return <NotFoundMessage />;
}
