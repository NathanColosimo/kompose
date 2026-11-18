# Linting

Biome runs with Ultracite's core, Next.js, React, and TanStack presets.
`biome.json` is the source of truth for rules, exclusions, and scoped exceptions.
Versions live in the root `package.json`; upgrade Biome and Ultracite together.

## Commands

- `bunx biome ci .` checks lint and formatting, matching CI.
- `bun run fix` applies formatting and safe autofixes.

## Important configuration choices

- **TanStack option order:** keep `ultracite/biome/tanstack` in the presets.
  Without it, `useSortedKeys` reorders mutation options and breaks type inference.
- **Related Effect classes:** keep cohesive error and service declarations
  together. Six exact modules are exempt from `noExcessiveClassesPerFile`;
  the rule stays enabled elsewhere. The module list lives in `biome.json`.
- **Instance contracts:** scoped `ignoreMethods: ["publicError"]` preserves
  the error getters used by the API's public-error middleware. Required instance
  overrides use TypeScript's `override` modifier and `ignoreOverrideMethods`.
- **Native labels:** native tab labels are not HTML form labels. The native
  override removes Ultracite's custom `Label` mapping while keeping
  `noLabelWithoutControl` enabled. Web form labels must target their controls.
- **Native CSS:** the scoped duplicate-selector suppression in
  `apps/native/global.css` preserves separate Uniwind platform media blocks.
  Global CSS also permits duplicate custom properties for theme definitions.
- **Training code:** only `packages/task-parser/training/**` permits bitwise
  operations, awaits in loops, and higher cognitive complexity. Elsewhere,
  cognitive complexity remains a warning and the other checks retain their defaults.

## Routine fixes

Tailwind class sorting follows v4 ordering and is handled by the safe fixer.
Regexes use Unicode flags and named captures; use noncapturing groups when the
captured value is unnecessary. Preserve capture indices, backreferences, and
replacement callbacks when changing existing patterns.

Keep exceptions narrow and document their reason. Review preset changes when
upgrading the tools, then run lint, type checks, tests, and the affected builds.
