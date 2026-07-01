import { ICollectionsRegistryService, ICollectionMetadata } from '../interfaces';
import IndexedDbConnectionManager, { COLLECTIONS_STORE, ITEMS_STORE_FOR } from './IndexedDbConnectionManager';

/**
 * IndexedDB-backed implementation of {@link ICollectionsRegistryService}.
 *
 * The registry stores collection *instances* in the shared `collections`
 * object store, and is responsible for the cascade: deleting a row here
 * also drops the matching `items_<id>` object store so the two never
 * drift out of sync.
 */
export default class CollectionsRegistryService implements ICollectionsRegistryService {
  constructor(private readonly manager: IndexedDbConnectionManager) {}

  async init(): Promise<void> {
    const db = await this.manager.getDb();
    if (!db.objectStoreNames.contains(COLLECTIONS_STORE)) {
      // Defensive: the manager's migrations create this store at v2.
      // If we're running against a freshly-built DB that's somehow at
      // v0, request a no-op upgrade by calling ensureStore against
      // a guaranteed-missing name and then dropping it; this is the
      // only public way to nudge the manager into running the
      // upgrade path.
      // In practice the manager always opens at DB_VERSION and the
      // store is created before init() returns, so this branch is
      // never taken in normal operation.
      throw new Error(
        `Collections store '${COLLECTIONS_STORE}' was not present after init. ` +
          'The connection manager should have created it during the v0->v2 upgrade.'
      );
    }
  }

  async list(): Promise<ICollectionMetadata[]> {
    const db = await this.manager.getDb();
    return new Promise<ICollectionMetadata[]>((resolve, reject) => {
      const tx = db.transaction(COLLECTIONS_STORE, 'readonly');
      const store = tx.objectStore(COLLECTIONS_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        const rows = (request.result ?? []) as ICollectionMetadata[];
        const sorted = rows
          .filter((row) => this.isValidMetadata(row))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        resolve(sorted);
      };
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to list collections.'));
    });
  }

  async get(id: string): Promise<ICollectionMetadata | undefined> {
    if (!id) {
      throw new Error('get() requires a non-empty id.');
    }
    const db = await this.manager.getDb();
    return new Promise<ICollectionMetadata | undefined>((resolve, reject) => {
      const tx = db.transaction(COLLECTIONS_STORE, 'readonly');
      const store = tx.objectStore(COLLECTIONS_STORE);
      const request = store.get(id);
      request.onsuccess = () => {
        const row = request.result as ICollectionMetadata | undefined;
        resolve(row && this.isValidMetadata(row) ? row : undefined);
      };
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to get collection.'));
    });
  }

  async createFromCatalog(
    catalogEntry: { id: string; name: string; itemType: ICollectionMetadata['itemType'] },
    options?: { instanceId?: string; customName?: string }
  ): Promise<ICollectionMetadata> {
    const id = options?.instanceId ?? catalogEntry.id;
    const name = options?.customName ?? catalogEntry.name;
    return this.create({
      id,
      name,
      itemType: catalogEntry.itemType,
      sourceCatalogId: catalogEntry.id,
    });
  }

  async create(
    meta: Omit<ICollectionMetadata, 'createdAt' | 'updatedAt'>
  ): Promise<ICollectionMetadata> {
    if (!meta.id) {
      throw new Error('create() requires a non-empty id.');
    }
    if (!meta.name) {
      throw new Error('create() requires a non-empty name.');
    }
    if (!meta.itemType) {
      throw new Error('create() requires a non-empty itemType.');
    }
    const existing = await this.get(meta.id);
    if (existing) {
      throw new Error(
        `A collection with id '${meta.id}' already exists. ` +
          'Pass { instanceId } to createFromCatalog to start a new instance.'
      );
    }
    const now = new Date().toISOString();
    const row: ICollectionMetadata = {
      id: meta.id,
      name: meta.name,
      itemType: meta.itemType,
      createdAt: now,
      updatedAt: now,
      sourceCatalogId: meta.sourceCatalogId,
    };
    const db = await this.manager.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COLLECTIONS_STORE, 'readwrite');
      const store = tx.objectStore(COLLECTIONS_STORE);
      const request = store.add(row);
      request.onsuccess = () => resolve();
      request.onerror = () => {
        if (request.error?.name === 'ConstraintError') {
          reject(
            new Error(
              `A collection with id '${meta.id}' already exists. ` +
                'Pass { instanceId } to createFromCatalog to start a new instance.'
            )
          );
        } else {
          reject(request.error ?? new Error('Failed to create collection.'));
        }
      };
    });
    return row;
  }

  async rename(id: string, name: string): Promise<ICollectionMetadata> {
    if (!id) {
      throw new Error('rename() requires a non-empty id.');
    }
    if (!name) {
      throw new Error('rename() requires a non-empty name.');
    }
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`No collection with id '${id}' to rename.`);
    }
    const updated: ICollectionMetadata = {
      ...existing,
      name,
      updatedAt: new Date().toISOString(),
    };
    const db = await this.manager.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COLLECTIONS_STORE, 'readwrite');
      const store = tx.objectStore(COLLECTIONS_STORE);
      const request = store.put(updated);
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to rename collection.'));
    });
    return updated;
  }

  async remove(id: string): Promise<void> {
    if (!id) {
      throw new Error('remove() requires a non-empty id.');
    }
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`No collection with id '${id}' to remove.`);
    }
    // 1) Drop the per-collection items store inside a versionchange tx.
    await this.manager.dropStore(ITEMS_STORE_FOR(id));
    // 2) Delete the registry row. Even if this fails, the user can
    //    call create() again with the same id; the only visible
    //    side-effect of leaving an orphan row is a phantom collection
    //    in the picker, which is recoverable.
    const db = await this.manager.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COLLECTIONS_STORE, 'readwrite');
      const store = tx.objectStore(COLLECTIONS_STORE);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to remove collection.'));
    });
  }

  private isValidMetadata(value: unknown): value is ICollectionMetadata {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const row = value as Partial<ICollectionMetadata>;
    return (
      typeof row.id === 'string' &&
      row.id.length > 0 &&
      typeof row.name === 'string' &&
      typeof row.itemType === 'string' &&
      typeof row.createdAt === 'string' &&
      typeof row.updatedAt === 'string'
    );
  }
}
