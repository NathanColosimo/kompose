import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service for Kompose.",
};

// Read the source legal doc at build time so the public page stays in sync.
const termsSource = readFileSync(
  join(process.cwd(), "..", "..", "documents", "terms-of-service.md"),
  "utf8"
);

const termsBlocks = termsSource
  .split(/\n\s*\n/)
  .map((block) => block.trim())
  .filter(Boolean);

const updatedAt =
  termsBlocks[1]?.replace(/^Last Updated:\s*/, "") ?? "2026-03-16";
const contentBlocks = termsBlocks.slice(2);
const sectionHeadingPattern = /^\d+\.\s/;

function normalizeBlockText(block: string) {
  return block.replace(/^\s+/gm, "").trim();
}

export default function TermsPage() {
  return (
    <LegalShell
      summary="These terms govern access to and use of Kompose."
      title="Terms of Service"
      updatedAt={updatedAt}
    >
      {contentBlocks.map((block) => {
        const text = normalizeBlockText(block);
        const isHeading = sectionHeadingPattern.test(text);

        if (isHeading) {
          return (
            <section className="space-y-3" key={text}>
              <h2 className="font-serif text-2xl">{text}</h2>
            </section>
          );
        }

        return (
          <section className="space-y-3" key={text}>
            <p>{text}</p>
          </section>
        );
      })}
    </LegalShell>
  );
}
