import { IItemTypeMap } from './IItemTypeMap';

/**
 * Metadata for a single collection *instance* that the user has started.
 *
 * Stored in the `collections` object store. The companion `items_<id>`
 * object store holds the items for this instance. The id is a stable
 * slug chosen by the user (or auto-generated from a catalog entry) and
 * is the key for both object stores.
 */
export default interface ICollectionMetadata {
  /** Stable slug used as the key in the registry and in `items_<id>`. */
  id: string;
  /** Display name, editable at runtime. */
  name: string;
  /** Discriminator that decides which item type/validator applies. */
  itemType: keyof IItemTypeMap;
  /** ISO 8601 timestamp the instance was first created. */
  createdAt: string;
  /** ISO 8601 timestamp of the most recent metadata change. */
  updatedAt: string;
  /**
   * Optional id of the catalog entry this instance was created from.
   * Lets the UI show "based on FIFA World Cup 2026" even after the user
   * renames the instance. Catalog entries are read-only at runtime.
   */
  sourceCatalogId?: string;
}
