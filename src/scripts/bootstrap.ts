/**
 * Shared bootstrap initialization for the app.
 * Centralizes the database connection and registry setup so both
 * index.pug and collection.pug can reuse the same instances.
 */
import IndexedDbConnectionManager from '../services/IndexedDbConnectionManager';
import CollectionsRegistryService from '../services/CollectionsRegistryService';
import CatalogService from '../services/CatalogService';

export interface BootstrapServices {
  manager: IndexedDbConnectionManager;
  registry: CollectionsRegistryService;
  catalog: CatalogService;
}

/**
 * Initializes the database connection, registry, and catalog.
 * Safe to call multiple times; subsequent calls return cached instances.
 */
let bootstrapPromise: Promise<BootstrapServices> | null = null;

export async function initializeBootstrap(): Promise<BootstrapServices> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      console.log('[Bootstrap] Starting initialization...');
      const manager = new IndexedDbConnectionManager();
      const registry = new CollectionsRegistryService(manager);
      const catalog = new CatalogService();

      console.log('[Bootstrap] Initializing manager...');
      await manager.init();
      
      console.log('[Bootstrap] Initializing registry...');
      await registry.init();
      
      console.log('[Bootstrap] Loading catalog entries...');
      await catalog.loadEntries();
      console.log('[Bootstrap] Catalog has', catalog.list().length, 'entries after load');

      console.log('[Bootstrap] Initialization complete');
      return { manager, registry, catalog };
    })();
  }
  return bootstrapPromise;
}
