import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The setup file polyfills `globalThis.indexedDB` from `fake-indexeddb/auto`
    // so the IndexedDbDataStoreService can be exercised under Node.
    setupFiles: ["./src/test-setup.ts"],
  },
});
