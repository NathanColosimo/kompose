# Mobile Theme Implementation

How dark mode and theming works in the native app.

## Architecture Overview

```
NativeWind (colorScheme.set)  ←  User toggles theme
         ↓
  useColorScheme() hook       ←  Components subscribe
         ↓
  ┌──────────────────────────────────────────┐
  │  themeVars (CSS variables)               │  → Tailwind classes (bg-background, text-foreground)
  │  NAV_THEME (color objects)               │  → React Navigation (headers, tabs)
  └──────────────────────────────────────────┘
```

## Key Difference: Web vs React Native

| Aspect | Web | React Native |
|--------|-----|--------------|
| CSS Variables | Cascade via `:root` and `.dark` in CSS | Must be applied via `style` prop using `vars()` |
| Dark class | Add `.dark` to parent element | NativeWind handles internally via `setColorScheme()` |
| Navigation styling | CSS classes | Native props require explicit color values |

## Files

### `lib/color-scheme-context.tsx`
- Wraps NativeWind's `useColorScheme()` hook
- Adds persistence to SecureStore
- Tracks `userPreference` for toggle UI ("light", "dark", "system")
- **No provider needed** - uses NativeWind's internal state

### `lib/theme-vars.ts`
- CSS variable definitions using NativeWind's `vars()` function
- Light and dark variants matching `global.css`
- **Required for React Native** - no DOM cascade

### `lib/theme.ts` (NAV_THEME)
- Color objects for React Navigation's native components
- Headers and tab bars don't use Tailwind classes
- Must pass explicit color values

### `global.css`
- Tailwind CSS variable definitions (`:root` and `.dark`)
- Used by NativeWind to generate styles
- Variables must also be in `theme-vars.ts` for React Native

## Usage

### In components (Tailwind classes)
```tsx
<View className="bg-background">
  <Text className="text-foreground">Hello</Text>
</View>
```
Works automatically - NativeWind resolves CSS variables.

### In root layout
```tsx
function RootLayoutContent() {
  const { isDarkColorScheme } = useColorScheme();
  const cssVars = isDarkColorScheme ? themeVars.dark : themeVars.light;
  
  return (
    <View style={cssVars}>  {/* Apply CSS variables to subtree */}
      {children}
    </View>
  );
}
```

### Theme toggle
```tsx
const { userPreference, setColorScheme } = useColorScheme();

<Pressable onPress={() => setColorScheme("dark")}>
  <Text>Dark</Text>
</Pressable>
```

## Why No Provider?

NativeWind's `colorScheme.set()` updates internal state outside React's render cycle. Components using `useColorScheme()` subscribe to this state independently - no context cascade needed.

The `userPreference` state in the hook is local to each component instance, but they all read from the same persisted SecureStore value on mount.

## Keeping Things in Sync

When adding new CSS variables:
1. Add to `global.css` under both `:root` and `.dark`
2. Add to `lib/theme-vars.ts` in both `light` and `dark` objects
3. Add to `tailwind.config.ts` theme extension if using in classes

## References

- [NativeWind Dark Mode Docs](https://www.nativewind.dev/docs/core-concepts/dark-mode)
- [Expo Color Themes](https://docs.expo.dev/develop/user-interface/color-themes/)
