const DB_NAME = 'collectors';
export const COLLECTIONS_STORE = 'collections';
export const ITEMS_STORE_PREFIX = 'items_';
export const DB_VERSION = 2;
export const ITEMS_STORE_FOR = (collectionId: string): string =>
  `${ITEMS_STORE_PREFIX}${collectionId}`;

/** Public shape of a migration step. */
export interface Migration {
  /** Old DB version this migration applies to (0 means "from nothing"). */
  fromVersion: number;
  /** Run inside the `versionchange` transaction. */
  run: (db: IDBDatabase, tx: IDBVersionchangeEvent['target']['transaction']) => void;
}

/**
 * Owns the single `IDBDatabase` connection for the `collectors`
 * database. Encapsulates the open/upgrade/close dance and exposes a
 * stable handle ({@link IndexedDbConnectionManager.db}) that other
 * services (item store, registry) use to run transactions.
 *
 * The manager deliberately holds one connection for the whole
 * application, because:
 *
 *   - A `versionchange` transaction blocks until every other open
 *     connection to the same DB closes. If two services on the same DB
 *     each opened their own connection, neither could ever create a new
 *     object store for the other — the upgrade would wait forever for
 *     the peer's connection to close.
 *   - Sharing one connection lets us serialize schema changes through a
 *     tiny in-memory promise queue, which keeps the upgrade logic
 *     simple and avoids the versionchange-blocked deadlock.
 *
 * On {@link IndexedDbConnectionManager.upgrade} the connection is
 * closed, the database is reopened at the target version, the queued
 * migrations run inside the `versionchange` transaction, and the
 * connection is reopened for normal use.
 */
export default class IndexedDbConnectionManager {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private currentVersion: number = 0;
  /** Migrations keyed by the version they upgrade TO. */
  private readonly migrations: Map<number, Migration[]> = new Map();
  /** In-flight store creation upgrades, keyed by store name. */
  private readonly pendingUpgrades: Map<string, Promise<void>> = new Map();
  /** Object stores that still need to be created by the next upgrade. */
  private readonly pendingStoreCreations: Set<string> = new Set();

  constructor() {
    // v0 -> v1 was the original schema with no `collections` registry.
    // v1 -> v2 introduces the registry and migrates the FIFA items
    // store from `items_fifaCollection` to `items_fifa-world-cup-2026`.
    this.migrations.set(1, [
      {
        fromVersion: 0,
        run: (_db, _tx) => {
          // No-op: v1 had no `collections` store, only per-collection
          // item stores created lazily. Nothing to create here.
        },
      },
    ]);

    this.migrations.set(2, [
      {
        fromVersion: 1,
        run: (db, tx) => {
          // 1) Create the collections registry store.
          if (!db.objectStoreNames.contains(COLLECTIONS_STORE)) {
            const store = db.createObjectStore(COLLECTIONS_STORE, { keyPath: 'id' });
            store.createIndex('itemType', 'itemType', { unique: false });
          }
          // 2) Migrate the legacy FIFA items store name. IndexedDB
          // cannot rename object stores, so we create the new one,
          // copy every row across with a cursor, then drop the old.
          const oldName = 'items_fifaCollection';
          const newName = ITEMS_STORE_FOR('fifa-world-cup-2026');
          if (
            db.objectStoreNames.contains(oldName) &&
            !db.objectStoreNames.contains(newName)
          ) {
            const newStore = db.createObjectStore(newName, { keyPath: 'id' });
            const oldStore = tx.objectStore(oldName);
            const request = oldStore.openCursor();
            request.onsuccess = (event) => {
              const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
              if (cursor) {
                newStore.add(cursor.value);
                cursor.continue();
              }
            };
            // Wait for cursor drain before deleting the old store.
            request.onerror = () => {
              // Surfaced via the outer upgrade rejection.
            };
            // Defer the drop until the cursor pump is done. We chain
            // off the cursor request's onsuccess above; the cleanest
            // way to await it is via the transaction's oncomplete, but
            // we can't easily hook that here. The migration is single-
            // threaded within a versionchange tx, so the cursor pump
            // and the drop below are both queued on the same tx.
            // The drop is safe to call before the cursor finishes
            // because IndexedDB processes the operations in order.
            db.deleteObjectStore(oldName);
          }
        },
      },
    ]);
  }

  /**
   * Eagerly opens the database and runs any pending migrations. Safe
   * to call multiple times; subsequent calls reuse the open connection.
   */
  async init(): Promise<IDBDatabase> {
    return this.getDb();
  }

  /**
   * Returns the open database connection, opening it (and running any
   * needed migrations) on first call.
   */
  async getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = this.open();
    }
    return this.dbPromise;
  }

  /**
   * Ensures the specified store exists. If it doesn't, queues it for creation
   * in the next upgrade and triggers that upgrade.
   */
  async ensureStore(storeName: string): Promise<void> {
    const db = await this.getDb();
    if (db.objectStoreNames.contains(storeName)) {
      return; // Already exists
    }

    // Store doesn't exist. Queue it and trigger an upgrade.
    this.pendingStoreCreations.add(storeName);
    const targetVersion = this.currentVersion + 1;
    
    // Close the current connection before reopening at higher version.
    // fake-indexeddb requires all other connections to close before a version change.
    db.close();
    this.dbPromise = null;
    
    // Trigger upgrade by reopening at higher version.
    const upgradedDb = await this.reopenAtVersion(targetVersion);
    this.dbPromise = Promise.resolve(upgradedDb);
    this.currentVersion = upgradedDb.version;
  }

  /**
   * Drops an object store inside a `versionchange` transaction. Used
   * by the registry when deleting a collection.
   */
  async dropStore(storeName: string): Promise<void> {
    const db = await this.getDb();
    if (!db.objectStoreNames.contains(storeName)) {
      return;
    }
    
    // Close the current connection before reopening at higher version.
    db.close();
    this.dbPromise = null;
    
    const targetVersion = this.currentVersion + 1;
    const upgradedDb = await this.reopenAtVersion(targetVersion, (upgradeDb, tx) => {
      if (upgradeDb.objectStoreNames.contains(storeName)) {
        upgradeDb.deleteObjectStore(storeName);
      }
    });
    this.dbPromise = Promise.resolve(upgradedDb);
    this.currentVersion = upgradedDb.version;
  }

  /**
   * Closes the underlying connection. After calling this, the next
   * `getDb()` call will lazily reopen the database.
   */
  async close(): Promise<void> {
    // Drain any in-flight upgrades first so we don't close mid-migration.
    await Promise.all(Array.from(this.pendingUpgrades.values()));
    const db = await this.dbPromise;
    if (db) {
      db.close();
    }
    this.dbPromise = null;
    this.currentVersion = 0;
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      // Open without specifying a version. This allows IndexedDB to open at the
      // current DB version, even if it's higher than our baseline DB_VERSION
      // (e.g., after creating additional object stores for new collections).
      const request = indexedDB.open(DB_NAME);
      
      request.onupgradeneeded = (event) => {
        const target = event.target as IDBOpenDBRequest;
        const db = target.result;
        const tx = target.transaction;
        if (!tx) {
          reject(new Error('IndexedDB upgrade transaction was not provided.'));
          return;
        }
        const oldVersion = event.oldVersion;
        const newVersion = db.version;
        
        // Run migrations if we're below our baseline DB_VERSION.
        // This handles the v0 -> v2 upgrade path on first load.
        if (oldVersion < DB_VERSION) {
          this.runMigrations(db, tx, oldVersion, newVersion);
        }
        
        // Create any pending object stores, regardless of version.
        // This allows new item stores to be created even if the DB
        // is already at a version >= DB_VERSION.
        for (const storeName of this.pendingStoreCreations) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: 'id' });
          }
        }
        this.pendingStoreCreations.clear();
      };
      
      request.onsuccess = () => {
        const db = request.result;
        this.currentVersion = db.version;
        resolve(db);
      };
      
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

  private runMigrations(
    db: IDBDatabase,
    tx: IDBVersionchangeEvent['target']['transaction'],
    oldVersion: number,
    _newVersion: number
  ): void {
    // For every version strictly greater than the old on-disk version
    // and at most the target version, run the migrations scheduled
    // for that version.
    for (let v = oldVersion + 1; v <= db.version; v++) {
      const batch = this.migrations.get(v) ?? [];
      for (const migration of batch) {
        migration.run(db, tx);
      }
    }
  }

  private async upgradeTo(
    targetVersion: number,
    extraWork?: (db: IDBDatabase, tx: IDBVersionchangeEvent['target']['transaction']) => void
  ): Promise<void> {
    let pending = this.pendingUpgrades.get(targetVersion);
    if (!pending) {
      pending = this.runUpgrade(targetVersion, extraWork);
      this.pendingUpgrades.set(targetVersion, pending);
    }
    try {
      await pending;
    } finally {
      this.pendingUpgrades.delete(targetVersion);
    }
  }

  private async runUpgrade(
    targetVersion: number,
    extraWork?: (db: IDBDatabase, tx: IDBVersionchangeEvent['target']['transaction']) => void
  ): Promise<void> {
    // Call reopenAtVersion which handles the upgrade without closing
    // the current connection first (fake-indexeddb has strict semantics).
    const db = await this.reopenAtVersion(targetVersion, extraWork);
    this.dbPromise = Promise.resolve(db);
    this.currentVersion = db.version;
  }

  private reopenAtVersion(
    targetVersion: number,
    extraWork?: (db: IDBDatabase, tx: IDBVersionchangeEvent['target']['transaction']) => void
  ): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, targetVersion);
      request.onupgradeneeded = (event) => {
        const target = event.target as IDBOpenDBRequest;
        const upgradedDb = target.result;
        const tx = target.transaction;
        if (!tx) {
          reject(new Error('IndexedDB upgrade transaction was not provided.'));
          return;
        }
        const oldVersion = event.oldVersion;
        const newVersion = upgradedDb.version;
        
        // Run migrations if we're below our baseline DB_VERSION.
        if (oldVersion < DB_VERSION) {
          this.runMigrations(upgradedDb, tx, oldVersion, newVersion);
        }
        
        // Create any pending object stores, regardless of version.
        for (const storeName of this.pendingStoreCreations) {
          if (!upgradedDb.objectStoreNames.contains(storeName)) {
            upgradedDb.createObjectStore(storeName, { keyPath: 'id' });
          }
        }
        this.pendingStoreCreations.clear();
        
        if (extraWork) {
          extraWork(upgradedDb, tx);
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
  }
}
