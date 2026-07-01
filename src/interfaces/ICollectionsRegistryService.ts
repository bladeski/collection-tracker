import ICollectionMetadata from './ICollectionMetadata';
import { IItemTypeMap } from './IItemTypeMap';

/**
 * Catalog entry the user can instantiate a collection from.
 * Mirrors a row in `src/data/collections.json`.
 */
export interface ICollectionCatalogEntry {
  id: string;
  name: string;
  itemType: keyof IItemTypeMap;
}

/**
 * Owns the `collections` object store in the `collectors` IndexedDB
 * database. Each registered row represents one *instance* of a
 * collection the user has started; the actual items for that instance
 * live in a separate `items_<id>` object store managed by
 * {@link IndexedDbDataStoreService}.
 */
export default interface ICollectionsRegistryService {
  /**
   * Eagerly opens the database and ensures the `collections` store
   * exists. Safe to call multiple times.
   */
  init(): Promise<void>;

  /** Lists every collection instance, ordered by name (case-insensitive). */
  list(): Promise<ICollectionMetadata[]>;

  /** Fetches a single collection instance by id, or `undefined`. */
  get(id: string): Promise<ICollectionMetadata | undefined>;

  /**
   * Instantiates a collection from a catalog entry. The instance id
   * defaults to the catalog id; pass `instanceId` to start multiple
   * instances from the same catalog entry.
   */
  createFromCatalog(
    catalogEntry: ICollectionCatalogEntry,
    options?: { instanceId?: string }
  ): Promise<ICollectionMetadata>;

  /**
   * Creates a collection instance directly, without going through the
   * catalog. Useful for tests and for future user-defined collections.
   */
  create(meta: Omit<ICollectionMetadata, 'createdAt' | 'updatedAt'>): Promise<ICollectionMetadata>;

  /** Updates the display name; returns the updated row. */
  rename(id: string, name: string): Promise<ICollectionMetadata>;

  /**
   * Deletes the collection instance and drops its `items_<id>` object
   * store. Atomic from the user's perspective: the registry row and
   * the items store are removed together inside a `versionchange` tx.
   */
  remove(id: string): Promise<void>;
}
