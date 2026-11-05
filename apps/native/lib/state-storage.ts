import type { StorageAdapter } from "@kompose/state/storage";
// biome-ignore lint/performance/noNamespaceImport: SecureStore is a namespace object
import * as SecureStore from "expo-secure-store";

export function createSecureStoreAdapter(): StorageAdapter {
  return {
    getItem: (key) => SecureStore.getItemAsync(key),
    removeItem: (key) => SecureStore.deleteItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
  };
}
