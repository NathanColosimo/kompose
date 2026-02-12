# Mobile Theme Implementation

How dark mode and theming works in the native app.

## Architecture Overview

```
Uniwind (setTheme)            ←  User toggles theme
         ↓
  useColorScheme() hook       ←  Components subscribe
         ↓
  ┌──────────────────────────────────────────┐
  │  global.css theme variables              │  → Tailwind classes (bg-background, text-foreground)
  │  NAV_THEME (color objects)               │  → React Navigation (headers, tabs)
  └──────────────────────────────────────────┘
```

## Key Difference: Web vs React Native

| Aspect | Web | React Native |
|--------|-----|--------------|
| CSS Variables | Cascade via `:root` and `.dark` in CSS | Uniwind resolves `@layer theme` + `@variant light/dark` |
| Theme switching | CSS class / app state | Uniwind runtime via `setTheme("light" \| "dark" \| "system")` |
| Navigation styling | CSS classes | Native props require explicit color values |

## Files

### `lib/color-scheme-context.tsx`
- Wraps Uniwind theme state (`useUniwind` + `Uniwind.setTheme`)
- Persists preference in SecureStore
- Tracks `userPreference` for toggle UI ("light", "dark", "system")
- Resolves effective `colorScheme` for UI logic (`"light"` / `"dark"`)

### `lib/theme.ts` (NAV_THEME)
- Color objects for React Navigation's native components
- Headers and tab bars don't use Tailwind classes
- Must pass explicit color values

### `global.css`
- Tailwind v4 + Uniwind entry (`@import "tailwindcss"; @import "uniwind";`)
- Theme variables are defined in `@layer theme` using `@variant light` and `@variant dark`
- Semantic tokens (`--color-background`, `--color-foreground`, etc.) drive class names

## Usage

### In components (Tailwind classes)
```tsx
<View className="bg-background">
  <Text className="text-foreground">Hello</Text>
</View>
```
Works automatically - Uniwind resolves semantic tokens from `global.css`.

### Theme toggle
```tsx
const { userPreference, setColorScheme } = useColorScheme();

<Pressable onPress={() => setColorScheme("dark")}>
  <Text>Dark</Text>
</Pressable>
```

## Keeping Things in Sync

When adding new CSS variables:
1. Add to `global.css` under both `@variant light` and `@variant dark`
2. Keep variable keys identical between variants
3. Continue mapping React Navigation colors in `lib/theme.ts` when needed

## References

- [Uniwind Theming Basics](https://docs.uniwind.dev/theming/basics)
- [Uniwind Global CSS](https://docs.uniwind.dev/theming/global-css)
- [Uniwind Style Based on Themes](https://docs.uniwind.dev/theming/style-based-on-themes)
- [Expo Color Themes](https://docs.expo.dev/develop/user-interface/color-themes/)
