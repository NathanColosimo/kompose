import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy policy for Kompose.",
};

const SECTION_HEADING_LINE_REGEX = /\n(?=\d+\.\s)/g;

// Read the source legal doc at build time so the public page stays in sync.
const privacySource = readFileSync(
  join(process.cwd(), "..", "..", "documents", "privacy-policy.md"),
  "utf8"
);

const updatedAt =
  privacySource.match(/^Last Updated:\s*(.+)$/m)?.[1] ?? "2026-03-16";

const privacyContent = privacySource
  .replace(/^KOMPOSE PRIVACY POLICY\s*\n\s*\n/, "")
  .replace(/^Last Updated:.*\n/, "")
  .replace(/^Effective Date:.*\n/, "")
  .replace(SECTION_HEADING_LINE_REGEX, "\n\n")
  .trim();

const privacyBlocks = privacyContent
  .split(/\n\s*\n/)
  .map((block) => block.trim())
  .filter(Boolean);

const sectionHeadingPattern = /^\d+\.\s/;

function normalizeBlockText(block: string) {
  return block.replace(/^\s+/gm, "").trim();
}

function getParagraphLines(block: string) {
  return normalizeBlockText(block)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function PrivacyPage() {
  return (
    <LegalShell
      summary={"This page contains the current Kompose privacy policy."}
      title={"Privacy Policy"}
      updatedAt={updatedAt}
    >
      {privacyBlocks.map((block) => {
        const text = normalizeBlockText(block);
        const isHeading = sectionHeadingPattern.test(text);

        if (isHeading) {
          return (
            <section className="space-y-3" key={text}>
              <h2 className="font-serif text-2xl">{text}</h2>
            </section>
          );
        }

        const lines = getParagraphLines(block);

        return (
          <section className="space-y-3" key={text}>
            {lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </section>
        );
      })}
    </LegalShell>
  );
}
