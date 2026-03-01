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

## Design System

- **Color palette**: Warm, paper-like HSL palette with yellowish/brownish tints (hue ~40-52). Shared with web (web's `index.css` is the source of truth; mobile uses the same HSL values).
- **Typography**: Sentient (Fontshare) — variable serif font used for both `--font-sans` and `--font-serif`. Bundled via `expo-font` plugin. Font files live in `assets/fonts/`.
- **Border radius**: 0.5rem base with derived sm/md/lg/xl/2xl/3xl/4xl scale (matches web).

## Key Difference: Web vs React Native

| Aspect | Web | React Native |
|--------|-----|--------------|
| CSS Variables | Cascade via `:root` and `.dark` in CSS | Uniwind resolves `@layer theme` + `@variant light/dark` |
| Theme switching | CSS class / app state | Uniwind runtime via `setTheme("light" \| "dark" \| "system")` |
| Navigation styling | CSS classes | Native props require explicit color values |
| Font loading | Fontshare CDN `@import` in CSS | `expo-font` plugin in `app.json` with bundled `.ttf` files |
| Shadows | CSS `box-shadow` tokens in `:root` / `.dark` | React Native `shadowOffset`/`shadowRadius`/`shadowColor` style props (no CSS shadow tokens) |

## Files

### `global.css`
- Tailwind v4 + Uniwind entry (`@import "tailwindcss"; @import "uniwind";`)
- `@theme` block defines radius scale (0.5rem base)
- Platform-specific font families via `@media ios` / `@media android`
- Theme variables defined in `@layer theme` using `@variant light` and `@variant dark`
- Semantic tokens (`--color-background`, `--color-foreground`, etc.) drive class names

### `lib/theme.ts` (NAV_THEME)
- `THEME` object with rounded HSL values for React Navigation
- `NAV_THEME` derives from `THEME` — headers, tab bars, and other native navigation elements
- Values are rounded approximations of the full-precision CSS values

### `lib/color-scheme-context.tsx`
- Wraps Uniwind theme state (`useUniwind` + `Uniwind.setTheme`)
- Persists preference in SecureStore
- Tracks `userPreference` for toggle UI ("light", "dark", "system")
- Resolves effective `colorScheme` for UI logic (`"light"` / `"dark"`)

### `theme/colors.ts`
- `Fonts` object maps platform-specific font family names (Sentient-Variable on native, 'Sentient' on web)
- `lightColors` / `darkColors` / `Colors` derive from `THEME` for imperative JS use via `useColor`

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

When changing theme colors:
1. Update web `apps/web/src/index.css` first (source of truth)
2. Copy HSL values to mobile `global.css` under both `@variant light` and `@variant dark`
3. Update `lib/theme.ts` `THEME` object with rounded HSL equivalents
4. `theme/colors.ts` auto-derives from `THEME` — no color changes needed there

When changing fonts:
1. Place `.ttf` files in `assets/fonts/`
2. List them in `app.json` under the `expo-font` plugin config
3. Update `global.css` `@media ios` / `@media android` font-family references
4. Update `theme/colors.ts` `Fonts` object

## References

- [Uniwind Theming Basics](https://docs.uniwind.dev/theming/basics)
- [Uniwind Global CSS](https://docs.uniwind.dev/theming/global-css)
- [Uniwind Style Based on Themes](https://docs.uniwind.dev/theming/style-based-on-themes)
- [Expo Color Themes](https://docs.expo.dev/develop/user-interface/color-themes/)
- [Fontshare Sentient](https://www.fontshare.com/fonts/sentient)
