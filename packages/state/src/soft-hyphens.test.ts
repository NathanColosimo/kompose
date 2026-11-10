import { expect, test } from "bun:test";
import { withSoftHyphens } from "./soft-hyphens";

test("allows breaks inside long words, three letters from each end", () => {
  expect(withSoftHyphens("Roadmap review")).toBe(
    "Roa\u00ADd\u00ADmap rev\u00ADiew"
  );
  expect(withSoftHyphens("1:1 with Priya")).toBe("1:1 with Priya");
});
