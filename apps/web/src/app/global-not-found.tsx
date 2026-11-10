import type { Metadata } from "next";
import { NotFoundMessage } from "@/components/not-found-message";
import { RootDocument } from "@/components/root-document";

export const metadata: Metadata = {
  title: "404: This page could not be found.",
};

// With two root layouts (site and docs), no layout wraps an unmatched URL,
// so Next renders this page for it.
export default function GlobalNotFound() {
  return (
    <RootDocument>
      <NotFoundMessage />
    </RootDocument>
  );
}
