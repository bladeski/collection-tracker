import { ICollectionsRegistryService, IDataService, IDataStoreService, IItem } from '../interfaces';

/**
 * In-memory model of a single collection instance, backed by a
 * {@link IDataStoreService} for items and a
 * {@link ICollectionsRegistryService} for metadata.
 *
 * Construction is now registry-driven: pass the collection id and
 * the registry/store; the model pulls `name` and `itemType` from the
 * registry row and dispatches an `error` event if the id is unknown.
 */
export default class Collection<T extends IItem> extends EventTarget {
  protected readonly _id: string;
  protected _name: string = '';
  protected _itemType: T['itemType'] | undefined;
  protected _items: T[] = [];
  protected _baseData: T[] = [];
  protected isInitialised: boolean = false;
  protected readonly dataService: IDataService<T>;
  protected readonly dataStoreService: IDataStoreService<T>;
  protected readonly registry: ICollectionsRegistryService;

  get id() {
    return this._id;
  }

  get itemType() {
    return this._itemType;
  }

  get name() {
    return this._name;
  }

  get items() {
    return this._items;
  }

  constructor(
    id: string,
    dataService: IDataService<T>,
    dataStoreService: IDataStoreService<T>,
    registry: ICollectionsRegistryService
  ) {
    super();
    this._id = id;
    this.dataService = dataService;
    this.dataStoreService = dataStoreService;
    this.registry = registry;

    // Load metadata, base data, and stored items in parallel. The
    // metadata fetch is what tells us the collection even exists; if
    // it does not, we leave `isInitialised` false and dispatch an
    // `error` event so the UI can react.
    Promise.all([registry.get(id), dataService.getBaseData(), dataStoreService.getAll()])
      .then(([meta, baseData, collectionData]) => {
        if (!meta) {
          this.dispatchEvent(
            new CustomEvent('error', {
              detail: { id, reason: 'not-found' },
            })
          );
          return;
        }
        this._name = meta.name;
        this._itemType = meta.itemType as T['itemType'];
        this.initialise(baseData, collectionData);
      })
      .catch((error) => {
        console.error('Failed to initialise collection:', error);
        this.dispatchEvent(
          new CustomEvent('error', {
            detail: { id, reason: 'init-failed', error: error instanceof Error ? error.message : String(error) },
          })
        );
      });
  }

  initialise(baseData: T[], collectionData: T[] = []) {
    this._baseData = baseData;
    this._items = collectionData;
    this.isInitialised = true;
    this.dispatchInitialisedEvent();
  }

  private dispatchInitialisedEvent(): void {
    const event = new CustomEvent('initialised', {
      detail: {
        id: this._id,
        name: this._name,
        itemCount: this._items.length,
        baseDataCount: this._baseData.length,
      },
    });
    this.dispatchEvent(event);
  }

  /**
   * Renames the collection. The registry row is updated and a
   * `renamed` event is fired; in-memory state catches up immediately
   * for the same caller.
   */
  async rename(newName: string): Promise<void> {
    if (!this.isInitialised) {
      throw new Error('Collection is not initialised.');
    }
    if (!newName) {
      throw new Error('rename() requires a non-empty name.');
    }
    const updated = await this.registry.rename(this._id, newName);
    this._name = updated.name;
    this.dispatchEvent(
      new CustomEvent('renamed', {
        detail: { id: this._id, name: this._name },
      })
    );
  }

  /**
   * Deletes the collection instance and its items store via the
   * registry. The local model is marked uninitialised; consumers
   * should navigate away.
   */
  async delete(): Promise<void> {
    await this.registry.remove(this._id);
    this.isInitialised = false;
    this._items = [];
    this._baseData = [];
    this.dispatchEvent(
      new CustomEvent('deleted', {
        detail: { id: this._id },
      })
    );
  }

  async addItem(item: T): Promise<T[]> {
    if (!this.isInitialised) {
      throw new Error('Collection is not initialised.');
    }
    const existingItem = this._items.find(i => i.id === item.id);

    if (!existingItem) {
      await this.dataStoreService.add(item);
      this._items.push(item);
      return this._items;
    }

    const amountToAdd = Math.max(1, item.count || 0);
    const updatedItem = {
      ...existingItem,
      count: existingItem.count + amountToAdd,
    };
    await this.dataStoreService.update(updatedItem);
    existingItem.count = updatedItem.count;
    return this._items;
  }

  async addItems(items: T[]): Promise<T[]> {
    if (!this.isInitialised) {
      throw new Error('Collection is not initialised.');
    }
    for (const item of items) {
      await this.addItem(item);
    }
    return this._items;
  }

  async removeItem(item: T): Promise<T[]> {
    if (!this.isInitialised) {
      throw new Error('Collection is not initialised.');
    }
    const index = this._items.findIndex(i => i.id === item.id);
    if (index !== -1 && this._items[index].count > 1) {
      const updatedItem = {
        ...this._items[index],
        count: this._items[index].count - 1,
      };
      await this.dataStoreService.update(updatedItem);
      this._items[index].count = updatedItem.count;
    } else if (index !== -1) {
      await this.dataStoreService.delete(this._items[index].id);
      this._items.splice(index, 1);
    } else {
      throw new Error(`Item with id ${item.id} not found in collection.`);
    }
    return this._items;
  }

  async removeItems(items: T[]): Promise<T[]> {
    if (!this.isInitialised) {
      throw new Error('Collection is not initialised.');
    }
    for (const item of items) {
      await this.removeItem(item);
    }
    return this._items;
  }

  getItemById(id: string): T | undefined {
    if (!this.isInitialised) {
      throw new Error('Collection is not initialised.');
    }
    return this._items.find(i => i.id === id);
  }

  getItems(includeMissing: boolean = false): T[] {
    if (!this.isInitialised) {
      throw new Error('Collection is not initialised.');
    }
    if (includeMissing) {
      return this._baseData.map(baseItem => {
        const collected = this._items.find(i => i.id === baseItem.id);
        return collected || baseItem;
      });
    }
    return this._items;
  }

  getMissingItems(): T[] {
    if (!this.isInitialised) {
      throw new Error('Collection is not initialised.');
    }
    return this._baseData.filter(item => !this._items.some(i => i.id === item.id));
  }

  getItemsByIds(ids: string[]): T[] {
    if (!this.isInitialised) {
      throw new Error('Collection is not initialised.');
    }
    return this._items.filter(item => ids.includes(item.id));
  }

  getSpares(): T[] {
    if (!this.isInitialised) {
      throw new Error('Collection is not initialised.');
    }
    return this._items.filter(item => item.count > 1);
  }
}
