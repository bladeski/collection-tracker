import { IItem } from '.';

/**
 * Persistence boundary for a single collection's items.
 *
 * Implementations are scoped to one collection; the collection's
 * `itemType` is now resolved out-of-band (typically via
 * {@link ICollectionsRegistryService.get}) before items are validated.
 * Keeping it off this interface avoids a circular dependency between
 * the store and the registry.
 */
export default interface IDataStoreService<T extends IItem> {
  getAll(): Promise<T[]>;
  getById(id: string): Promise<T | undefined>;
  add(item: T): Promise<void>;
  update(item: T): Promise<void>;
  delete(id: string): Promise<void>;
}
