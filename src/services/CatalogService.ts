import { ICollectionCatalogEntry } from '../interfaces';
import catalogDataUrl from '../data/collections.json';

console.log('[CatalogService] Raw import (URL):', catalogDataUrl);

/**
 * Read-only list of collection templates the user can instantiate.
 *
 * Shipped with the app via `src/data/collections.json`. Each entry is
 * an immutable template: the {@link CollectionsRegistryService}
 * materializes a row per instance when the user picks one.
 */
export default class CatalogService {
  private readonly entries: readonly ICollectionCatalogEntry[];

  constructor(entries?: readonly ICollectionCatalogEntry[]) {
    // If entries are provided (e.g., in tests), use them directly
    if (entries) {
      this.entries = Object.freeze(this.filterAndFreeze(entries));
      console.log('[CatalogService] Using provided entries:', this.entries);
      return;
    }

    // Otherwise, entries must be loaded async via loadEntries()
    // For now, initialize as empty; the page should await loadEntries()
    this.entries = Object.freeze([]);
    console.log('[CatalogService] Initialized empty; call loadEntries() to populate');
  }

  /**
   * Asynchronously loads entries from the bundled JSON asset URL.
   * Returns the loaded entries. Safe to call multiple times (caches result).
   */
  async loadEntries(): Promise<readonly ICollectionCatalogEntry[]> {
    if (this.entries.length > 0) {
      console.log('[CatalogService] Entries already loaded, returning cached:', this.entries);
      return this.entries;
    }

    try {
      console.log('[CatalogService] Loading from URL:', catalogDataUrl);
      const response = await fetch(catalogDataUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch catalog: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('[CatalogService] Fetched data:', data);

      if (!Array.isArray(data)) {
        console.error('[CatalogService] Catalog data is not an array:', data);
        throw new Error('Catalog data is not an array');
      }

      const filtered = this.filterAndFreeze(data);
      console.log('[CatalogService] After filtering:', filtered);

      // Update the private entries field (we need to work around the readonly)
      (this as any).entries = Object.freeze(filtered);
      console.log('[CatalogService] Entries updated, count:', this.entries.length);
      return this.entries;
    } catch (error) {
      console.error('[CatalogService] Failed to load entries:', error);
      return [];
    }
  }

  private filterAndFreeze(
    entries: readonly any[]
  ): readonly ICollectionCatalogEntry[] {
    return entries
      .filter((entry): entry is ICollectionCatalogEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.id === 'string' &&
        entry.id.length > 0 &&
        typeof entry.name === 'string' &&
        entry.name.length > 0 &&
        typeof entry.itemType === 'string'
      )
      .map((entry) => Object.freeze({ ...entry }));
  }

  /** Returns every catalog entry, in source order. */
  list(): readonly ICollectionCatalogEntry[] {
    return this.entries;
  }

  /** Looks up a single catalog entry by id, or `undefined`. */
  get(id: string): ICollectionCatalogEntry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }
}
