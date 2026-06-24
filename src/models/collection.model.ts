import { IDataService, IDataStoreService, IItem } from '../interfaces';

export default class Collection<T extends IItem> extends EventTarget {
  protected _id: string;
  protected _name: string;
  protected _items: T[] = [];
  protected _baseData: T[] = [];
  protected isInitialised: boolean = false;
  protected dataService: IDataService<T>;
  protected dataStoreService: IDataStoreService<T>;

  get id() {
    return this._id;
  }

  get name() {
    return this._name;
  }

  get items() {
    return this._items;
  }

  constructor(
    id: string,
    name: string,
    dataService: IDataService<T>,
    dataStoreService: IDataStoreService<T>
  ) {
    super();
    this._id = id;
    this._name = name;
    this.dataService = dataService;
    this.dataStoreService = dataStoreService;
    
    Promise.all([dataService.getBaseData(), dataStoreService.getAll()])
      .then(([baseData, collectionData]) => {
        this.initialise(baseData, collectionData);
      }).catch(error => {
        console.error('Failed to initialise collection with base data:', error);
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