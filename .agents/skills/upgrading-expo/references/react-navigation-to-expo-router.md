# React Navigation to Expo Router (SDK 56+)

Expo Router SDK 56 no longer expects app code to import `@react-navigation/*` packages directly. Import React Navigation integration points through Expo Router entry points instead, then remove direct `@react-navigation/*` dependencies that are no longer used.

## Codemod

Run the official codemod first:

```bash
npx expo-codemod sdk-56-expo-router-react-navigation-replace '**/*.{ts,tsx,js,jsx}'
```

Review the diff after the codemod because native-stack usage may need a manual route layout change.

## Import Mapping

| Old import | New import |
| --- | --- |
| `@react-navigation/native` | `expo-router/react-navigation` |
| `@react-navigation/core` | `expo-router/react-navigation` |
| `@react-navigation/elements` | `expo-router/react-navigation` |
| `@react-navigation/routers` | `expo-router/react-navigation` |
| `@react-navigation/stack` | `expo-router/js-stack` |
| `@react-navigation/bottom-tabs` | `expo-router/js-tabs` |
| `@react-navigation/material-top-tabs` | `expo-router/js-top-tabs` |

There is no direct `@react-navigation/native-stack` import replacement for app code. Prefer Expo Router route layouts with `Stack` from `expo-router` or `expo-router/stack`.

## Done Criteria

- No app code imports directly from `@react-navigation/*`.
- `package.json` does not list direct `@react-navigation/*` dependencies unless a package is still intentionally used outside Expo Router.
- Type-check and `npx expo install --check` both pass.

Reference: https://docs.expo.dev/router/migrate/sdk-55-to-56
