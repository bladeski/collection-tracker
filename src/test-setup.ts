// Vitest setup: polyfill IndexedDB in the Node test environment so the
// service under test (which uses the native `indexedDB` global) can run.
import 'fake-indexeddb/auto';
