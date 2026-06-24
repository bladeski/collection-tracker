import { IDataStoreService, IItem } from '../interfaces';

const DB_NAME = 'collectors';
const STORE_PREFIX = 'items_';

/**
 * Module-level state shared across every `IndexedDbDataStoreService`
 * instance. We deliberately use a single IDBDatabase connection per
 * process instead of opening one connection per service instance, because:
 *
 *   - A `versionchange` transaction blocks until every other open
 *     connection to the same DB closes. If two services on the same DB
 *     each opened their own connection, neither could ever create a new
 *     object store for the other — the upgrade would wait forever for
 *     the peer's connection to close.
 *   - Sharing one connection lets us serialize store-creation through a
 *     tiny in-memory promise queue, which keeps the upgrade logic simple
 *     and avoids the versionchange-blocked deadlock.
 *
 * The single connection is closed and reopened as needed whenever a new
 * object store has to be added; everything else goes through the live
 * connection.
 */
let sharedDb: { db: IDBDatabase; version: number } | null = null;
let sharedDbOpenPromise: Promise<{ db: IDBDatabase; version: number }> | null =
  null;
/** In-flight store-creation upgrades, keyed by storeName. */
const pendingStores = new Map<string, Promise<void>>();

/**
 * IndexedDB-backed implementation of {@link IDataStoreService}.
 *
 * Each instance is scoped to a single collection, identified by the
 * `collectionId` passed to the constructor. Items for that collection are
 * stored in their own object store (named `items_<collectionId>`) inside a
 * shared `collectors` database, so multiple collections can coexist in one
 * database without interfering with each other.
 *
 * The database is opened lazily the first time any operation is performed
 * (or eagerly via the public {@link IndexedDbDataStoreService.init}
 * method). Object stores are created lazily on first use via a serialized
 * `versionchange` transaction.
 */
export default class IndexedDbDataStoreService<T extends IItem>
  implements IDataStoreService<T>
{
  private readonly collectionId: string;
  private readonly storeName: string;

  constructor(collectionId: string) {
    if (!collectionId) {
      throw new Error('IndexedDbDataStoreService requires a non-empty collectionId.');
    }
    this.collectionId = collectionId;
    this.storeName = `${STORE_PREFIX}${collectionId}`;
  }

  /**
   * Eagerly opens the database and ensures the object store for this
   * collection exists. Safe to call multiple times; subsequent calls reuse
   * the existing connection.
   */
  async init(): Promise<void> {
    await ensureStoreFor(this.storeName);
  }

  async getAll(): Promise<T[]> {
    const db = await ensureStoreFor(this.storeName);
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error ?? new Error('Failed to getAll.'));
    });
  }

  async getById(id: string): Promise<T | undefined> {
    const db = await ensureStoreFor(this.storeName);
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error ?? new Error('Failed to getById.'));
    });
  }

  async add(item: T): Promise<void> {
    assertItem(item);
    const db = await ensureStoreFor(this.storeName);
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
    assertItem(item);
    const db = await ensureStoreFor(this.storeName);
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
    const db = await ensureStoreFor(this.storeName);
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
   * Closes the shared database connection. After calling this, the next
   * operation will lazily reopen the database. Useful in tests and when
   * tearing down a collection.
   *
   * Returns a promise that resolves once the connection has actually been
   * closed.
   */
  async close(): Promise<void> {
    // Drain any pending store creations so we don't close the DB out
    // from under them.
    await Promise.all(Array.from(pendingStores.values()));
    const current = sharedDb;
    sharedDb = null;
    sharedDbOpenPromise = null;
    if (current) {
      current.db.close();
    }
  }
}

function assertItem(item: IItem | undefined | null): void {
  if (!item || !item.id) {
    throw new Error('Item must have a non-empty id.');
  }
}

/**
 * Returns an open DB connection that contains `storeName`, opening the
 * database and/or running a `versionchange` upgrade to create the store
 * if necessary.
 *
 * Concurrent calls for the same storeName share a single in-flight
 * upgrade; concurrent calls for different stores serialize through the
 * shared DB connection's open/close/reopen cycle.
 */
async function ensureStoreFor(storeName: string): Promise<IDBDatabase> {
  const current = await getOrOpenSharedDb();
  if (current.db.objectStoreNames.contains(storeName)) {
    return current.db;
  }
  // Ensure only one upgrade per storeName is in flight at a time.
  let pending = pendingStores.get(storeName);
  if (!pending) {
    pending = createStore(storeName);
    pendingStores.set(storeName, pending);
  }
  try {
    await pending;
  } finally {
    pendingStores.delete(storeName);
  }
  const after = await getOrOpenSharedDb();
  if (!after.db.objectStoreNames.contains(storeName)) {
    throw new Error(
      `Object store '${storeName}' was not present after upgrade.`
    );
  }
  return after.db;
}

/**
 * Returns the live shared DB, opening it on first call. If a reopen is
 * in progress (because of a recent upgrade), returns the new connection
 * once it's available.
 */
function getOrOpenSharedDb(): Promise<{ db: IDBDatabase; version: number }> {
  if (sharedDb) {
    return Promise.resolve(sharedDb);
  }
  if (sharedDbOpenPromise) {
    return sharedDbOpenPromise;
  }
  sharedDbOpenPromise = openSharedDb();
  sharedDbOpenPromise.then((conn) => {
    sharedDb = conn;
    sharedDbOpenPromise = null;
  }).catch(() => {
    sharedDbOpenPromise = null;
  });
  return sharedDbOpenPromise;
}

/**
 * Closes the current shared connection and reopens the DB at a higher
 * version, creating `storeName` (and any other stores already requested
 * via pendingStores) inside the `versionchange` transaction.
 */
async function createStore(storeName: string): Promise<void> {
  // Wait for any in-flight initial open to settle so we know the current
  // on-disk version before deciding what to upgrade to.
  if (sharedDbOpenPromise) {
    try {
      const settled = await sharedDbOpenPromise;
      if (!sharedDb) {
        sharedDb = settled;
      }
    } catch {
      // ignore — we'll reopen anyway
    }
  }
  // Capture the current on-disk version BEFORE we null out sharedDb, so
  // we know what version to upgrade from.
  const baseVersion = sharedDb?.version ?? 1;
  // Close the current shared connection so the upgrade isn't blocked by us.
  if (sharedDb) {
    try {
      sharedDb.db.close();
    } catch {
      // ignore
    }
    sharedDb = null;
    sharedDbOpenPromise = null;
  }
  const targetVersion = baseVersion + 1;
  const request = indexedDB.open(DB_NAME, targetVersion);
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () => {
        const upgradeDb = request.result;
        if (!upgradeDb.objectStoreNames.contains(storeName)) {
          upgradeDb.createObjectStore(storeName, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to upgrade IndexedDB database.'));
      request.onblocked = () =>
        reject(
          new Error(
            'IndexedDB upgrade is blocked by another connection. Close other tabs and retry.'
          )
        );
    });
    sharedDb = { db, version: db.version };
  } catch (err) {
    sharedDb = null;
    throw err;
  }
}

function openSharedDb(): Promise<{ db: IDBDatabase; version: number }> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => {
      // Fresh DB: nothing to create here; stores are added lazily.
    };
    request.onsuccess = () =>
      resolve({ db: request.result, version: request.result.version });
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open IndexedDB database.'));
    request.onblocked = () =>
      reject(
        new Error(
          'IndexedDB open is blocked by another connection. Close other tabs and retry.'
        )
      );
  });
}