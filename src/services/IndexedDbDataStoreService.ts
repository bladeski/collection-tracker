import { ItemType } from '../enums';
import { IDataStoreService, IItem, IItemTypeMap } from '../interfaces';
import ValidatorService from './ValidatorService';
import IndexedDbConnectionManager, { ITEMS_STORE_FOR } from './IndexedDbConnectionManager';

/**
 * IndexedDB-backed implementation of {@link IDataStoreService} for a
 * single collection's items.
 *
 * The actual schema management (open/close/upgrade) lives in
 * {@link IndexedDbConnectionManager}. This service is a thin
 * transactional layer that opens `readwrite`/`readonly` transactions
 * on a known store name and adapts the request/event API to
 * promises.
 *
 * Two construction paths:
 *
 *   - **Standalone** — pass just a `collectionId`. A private
 *     {@link IndexedDbConnectionManager} is created for you. Useful
 *     for tests and quick scripts.
 *   - **Shared** — pass a connection manager. Multiple services
 *     sharing one manager share one `IDBDatabase` connection, which is
 *     the only safe way to run `versionchange` upgrades.
 */
export default class IndexedDbDataStoreService<T extends IItem>
  implements IDataStoreService<T>
{
  private readonly collectionId: string;
  private readonly storeName: string;
  private readonly ownsManager: boolean;
  private readonly manager: IndexedDbConnectionManager;
  private readonly validationItemType?: T['itemType'];

  constructor(collectionId: string, manager?: IndexedDbConnectionManager, itemType?: T['itemType']) {
    if (!collectionId) {
      throw new Error('IndexedDbDataStoreService requires a non-empty collectionId.');
    }
    this.collectionId = collectionId;
    this.storeName = ITEMS_STORE_FOR(collectionId);
    this.validationItemType = itemType;
    if (manager) {
      this.manager = manager;
      this.ownsManager = false;
    } else {
      this.manager = new IndexedDbConnectionManager();
      this.ownsManager = true;
    }
  }

  /**
   * Eagerly opens the database and ensures this collection's object
   * store is created.
   */
  async init(): Promise<void> {
    await this.manager.init();
    await this.manager.ensureStore(this.storeName);
  }

  /**
   * Exposes the underlying connection manager. Other services that
   * need to share this connection (e.g. the collections registry) can
   * obtain it from any `IndexedDbDataStoreService` instance.
   */
  get connectionManager(): IndexedDbConnectionManager {
    return this.manager;
  }

  /**
   * Exposes the object store name. Useful for the registry when it
   * needs to drop the store on collection delete.
   */
  get itemsStoreName(): string {
    return this.storeName;
  }

  async getAll(): Promise<T[]> {
    const db = await this.manager.getDb();
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () =>
        resolve(
          request.result
            ? ValidatorService.validateItems<T>(request.result, this.itemTypeForValidation)
            : []
        );
      request.onerror = () => reject(request.error ?? new Error('Failed to getAll.'));
    });
  }

  async getById(id: string): Promise<T | undefined> {
    const db = await this.manager.getDb();
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.get(id);
      request.onsuccess = () =>
        resolve(
          request.result
            ? ValidatorService.validateItem<T>(request.result, this.itemTypeForValidation)
            : undefined
        );
      request.onerror = () => reject(request.error ?? new Error('Failed to getById.'));
    });
  }

  async add(item: T): Promise<void> {
    ValidatorService.validateItem(item, this.itemTypeForValidation);
    const db = await this.manager.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.add(item);
      request.onsuccess = () => resolve();
      request.onerror = () => {
        if (request.error?.name === 'ConstraintError') {
          reject(
            new Error(
              `Item with id '${item.id}' already exists in collection '${this.collectionId}'.`
            )
          );
        } else {
          reject(request.error ?? new Error('Failed to add item.'));
        }
      };
    });
  }

  async update(item: T): Promise<void> {
    ValidatorService.validateItem(item, this.itemTypeForValidation);
    const db = await this.manager.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.put(item);
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to update item.'));
    });
  }

  async delete(id: string): Promise<void> {
    if (!id) {
      throw new Error('delete() requires a non-empty id.');
    }
    const db = await this.manager.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to delete item.'));
    });
  }

  /**
   * Closes the underlying connection. If this service owns its
   * connection manager, the manager is closed and discarded;
   * otherwise the call is a no-op.
   */
  async close(): Promise<void> {
    if (this.ownsManager) {
      await this.manager.close();
    }
  }

  /**
   * The item type used for validation.
   *
   * If provided at construction time, uses that value. Otherwise defaults
   * to ItemType.DEFAULT for backward compatibility. This allows callers
   * to pass the correct item type (e.g., 'fifa26') when creating the service
   * so that validation is strict.
   */
  private get itemTypeForValidation(): T['itemType'] {
    return this.validationItemType ?? (ItemType.DEFAULT as T['itemType']);
  }
}
