# Kompose

- `documents/` has a design note per feature (`ci-cd.md`, `caching.md`, `mobile.md`, `tag-system.md`, ...). Read the matching one before changing that area.
- Before changing `.github/workflows/`, read `documents/ci-cd.md`, including "Testing workflow changes".
- `biome.json` must extend `ultracite/biome/tanstack`, or `useSortedKeys` reorders TanStack mutation options and breaks type inference.
