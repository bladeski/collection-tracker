import { describe, it, expect, beforeEach } from 'vitest';
import Collection from './collection.model';
import { ItemType } from '../enums';
import { ICollectionsRegistryService, ICollectionMetadata } from '../interfaces';

interface TestItem {
  id: string;
  itemType: ItemType.DEFAULT;
  name: string;
  count: number;
}

const makeItem = (id: string, overrides: Partial<TestItem> = {}): TestItem => ({
  id,
  itemType: ItemType.DEFAULT,
  name: `Item ${id}`,
  count: 1,
  ...overrides,
});

/**
 * Stub data services. They return promises that never resolve so the
 * `Collection` constructor's auto-initialise never flips
 * `isInitialised` to true. Tests that need a populated collection
 * call `collection.initialise(...)` explicitly afterwards.
 */
const neverResolving = <T>(): Promise<T> => new Promise<T>(() => undefined);

const makeStubDataStoreService = () => ({
  getAll: () => neverResolving<TestItem[]>(),
  getById: async () => undefined,
  add: async () => undefined,
  update: async () => undefined,
  delete: async () => undefined,
}) as any;

const makeStubDataService = () => ({
  getBaseData: () => neverResolving<TestItem[]>(),
}) as any;

interface FakeRegistry {
  rows: Map<string, ICollectionMetadata>;
  renamed: Array<{ id: string; name: string }>;
  removed: string[];
  get: (id: string) => Promise<ICollectionMetadata | undefined>;
  rename: (id: string, name: string) => Promise<ICollectionMetadata>;
  remove: (id: string) => Promise<void>;
  list: () => Promise<ICollectionMetadata[]>;
  create: (meta: Omit<ICollectionMetadata, 'createdAt' | 'updatedAt'>) => Promise<ICollectionMetadata>;
  createFromCatalog: (...args: any[]) => Promise<ICollectionMetadata>;
  init: () => Promise<void>;
}

const makeFakeRegistry = (
  initial: ICollectionMetadata[] = []
): ICollectionsRegistryService => {
  const rows = new Map<string, ICollectionMetadata>();
  for (const r of initial) rows.set(r.id, r);
  const fake: FakeRegistry = {
    rows,
    renamed: [],
    removed: [],
    get: async (id) => rows.get(id),
    rename: async (id, name) => {
      const existing = rows.get(id);
      if (!existing) throw new Error(`No collection with id '${id}'`);
      const updated = { ...existing, name, updatedAt: new Date().toISOString() };
      rows.set(id, updated);
      fake.renamed.push({ id, name });
      return updated;
    },
    remove: async (id) => {
      rows.delete(id);
      fake.removed.push(id);
    },
    list: async () => Array.from(rows.values()),
    create: async (meta) => {
      const now = new Date().toISOString();
      const row: ICollectionMetadata = { ...meta, createdAt: now, updatedAt: now };
      rows.set(row.id, row);
      return row;
    },
    createFromCatalog: async (entry, options) => {
      const id = options?.instanceId ?? entry.id;
      return fake.create({
        id,
        name: entry.name,
        itemType: entry.itemType,
        sourceCatalogId: entry.id,
      });
    },
    init: async () => undefined,
  };
  return fake as unknown as ICollectionsRegistryService;
};

const fifaMeta: ICollectionMetadata = {
  id: 'test-id',
  name: 'Test Collection',
  itemType: ItemType.DEFAULT,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('Collection', () => {
  let collection: Collection<TestItem>;
  let registry: ICollectionsRegistryService;

  const baseData: TestItem[] = [
    makeItem('1'),
    makeItem('2'),
    makeItem('3'),
  ];

  beforeEach(() => {
    registry = makeFakeRegistry([fifaMeta]);
    collection = new Collection<TestItem>(
      'test-id',
      makeStubDataService(),
      makeStubDataStoreService(),
      registry
    );
  });

  describe('constructor', () => {
    it('should initialize with correct id and retrieve name from registry', async () => {
      expect(collection.id).toBe('test-id');
      // The registry row is already created in beforeEach, so metadata
      // will be fetched on next tick. Give it a chance to load.
      await new Promise((r) => setTimeout(r, 10));
      expect(collection.name).toBe('Test Collection');
      expect(collection.items).toHaveLength(0);
    });
  });

  describe('initialise', () => {
    it('should set base data and items', () => {
      const items = [makeItem('1')];
      collection.initialise(baseData, items);
      expect(collection.items).toHaveLength(1);
      expect(collection.items[0].id).toBe('1');
    });

    it('should default items to an empty array when not provided', () => {
      collection.initialise(baseData);
      expect(collection.items).toHaveLength(0);
    });
  });

  describe('addItem', () => {
    it('should add an item to the collection', async () => {
      collection.initialise(baseData);
      const item = makeItem('1');
      await collection.addItem(item);
      expect(collection.items).toHaveLength(1);
      expect(collection.items[0]).toBe(item);
    });

    it('should increment count when adding an item with a duplicate id', async () => {
      collection.initialise(baseData, [makeItem('1')]);
      await collection.addItem(makeItem('1'));
      expect(collection.items).toHaveLength(1);
      expect(collection.items[0].count).toBe(2);
    });

    it('should throw if collection is not initialised', async () => {
      await expect(collection.addItem(makeItem('1'))).rejects.toThrow('Collection is not initialised.');
    });
  });

  describe('addItems', () => {
    it('should add multiple items to the collection', async () => {
      collection.initialise(baseData);
      await collection.addItems([makeItem('1'), makeItem('2'), makeItem('3')]);
      expect(collection.items).toHaveLength(3);
    });

    it('should increment count for duplicate ids when adding multiple items', async () => {
      collection.initialise(baseData, [makeItem('1')]);
      await collection.addItems([makeItem('1'), makeItem('2')]);
      expect(collection.items).toHaveLength(2);
      expect(collection.getItemById('1')?.count).toBe(2);
    });

    it('should throw if collection is not initialised', async () => {
      await expect(collection.addItems([makeItem('1')])).rejects.toThrow('Collection is not initialised.');
    });
  });

  describe('removeItem', () => {
    it('should remove an item with count of 1 from the collection', async () => {
      collection.initialise(baseData, [makeItem('1'), makeItem('2')]);
      await collection.removeItem(makeItem('1'));
      expect(collection.items).toHaveLength(1);
      expect(collection.items[0].id).toBe('2');
    });

    it('should decrement count instead of removing when count is greater than 1', async () => {
      collection.initialise(baseData, [makeItem('1', { count: 3 })]);
      await collection.removeItem(makeItem('1'));
      expect(collection.items).toHaveLength(1);
      expect(collection.items[0].count).toBe(2);
    });

    it('should throw when removing an item not in the collection', async () => {
      collection.initialise(baseData, []);
      await expect(collection.removeItem(makeItem('1'))).rejects.toThrow('Item with id 1 not found in collection.');
    });

    it('should throw if collection is not initialised', async () => {
      await expect(collection.removeItem(makeItem('1'))).rejects.toThrow('Collection is not initialised.');
    });
  });

  describe('removeItems', () => {
    it('should remove multiple items from the collection', async () => {
      collection.initialise(baseData, [makeItem('1'), makeItem('2'), makeItem('3')]);
      await collection.removeItems([makeItem('1'), makeItem('3')]);
      expect(collection.items).toHaveLength(1);
      expect(collection.items[0].id).toBe('2');
    });

    it('should throw if collection is not initialised', async () => {
      await expect(collection.removeItems([makeItem('1')])).rejects.toThrow('Collection is not initialised.');
    });
  });

  describe('getItemById', () => {
    it('should return the item with the given id', () => {
      const item = makeItem('2');
      collection.initialise(baseData, [makeItem('1'), item]);
      expect(collection.getItemById('2')).toBe(item);
    });

    it('should return undefined when no item matches the id', () => {
      collection.initialise(baseData, [makeItem('1')]);
      expect(collection.getItemById('99')).toBeUndefined();
    });

    it('should throw if collection is not initialised', () => {
      expect(() => collection.getItemById('1')).toThrow('Collection is not initialised.');
    });
  });

  describe('getMissingItems', () => {
    it('should return base items not present in the collection', () => {
      collection.initialise(baseData, [makeItem('1')]);
      const missing = collection.getMissingItems();
      expect(missing).toHaveLength(2);
      expect(missing.map(i => i.id)).toEqual(expect.arrayContaining(['2', '3']));
    });

    it('should return all base items when collection has no items', () => {
      collection.initialise(baseData, []);
      expect(collection.getMissingItems()).toHaveLength(3);
    });

    it('should return an empty array when all base items are collected', () => {
      collection.initialise(baseData, [makeItem('1'), makeItem('2'), makeItem('3')]);
      expect(collection.getMissingItems()).toHaveLength(0);
    });

    it('should throw if collection is not initialised', () => {
      expect(() => collection.getMissingItems()).toThrow('Collection is not initialised.');
    });
  });

  describe('getItemsByIds', () => {
    it('should return items matching the provided ids', () => {
      collection.initialise(baseData, [makeItem('1'), makeItem('2'), makeItem('3')]);
      const result = collection.getItemsByIds(['1', '3']);
      expect(result).toHaveLength(2);
      expect(result.map(i => i.id)).toEqual(expect.arrayContaining(['1', '3']));
    });

    it('should return an empty array when no items match', () => {
      collection.initialise(baseData, [makeItem('1')]);
      expect(collection.getItemsByIds(['99', '100'])).toHaveLength(0);
    });

    it('should throw if collection is not initialised', () => {
      expect(() => collection.getItemsByIds(['1'])).toThrow('Collection is not initialised.');
    });
  });

  describe('getSpares', () => {
    it('should return items with count greater than 1', () => {
      collection.initialise(baseData, [makeItem('1', { count: 2 }), makeItem('2', { count: 1 })]);
      const spares = collection.getSpares();
      expect(spares).toHaveLength(1);
      expect(spares[0].id).toBe('1');
    });

    it('should return an empty array when no items are spares', () => {
      collection.initialise(baseData, [makeItem('1', { count: 1 })]);
      expect(collection.getSpares()).toHaveLength(0);
    });

    it('should throw if collection is not initialised', () => {
      expect(() => collection.getSpares()).toThrow('Collection is not initialised.');
    });
  });

  describe('rename', () => {
    it('should update the registry and the in-memory name', async () => {
      collection.initialise(baseData);
      await collection.rename('Renamed');
      expect(collection.name).toBe('Renamed');
      const fake = registry as unknown as FakeRegistry;
      expect(fake.renamed).toEqual([{ id: 'test-id', name: 'Renamed' }]);
    });

    it('should throw if collection is not initialised', async () => {
      await expect(collection.rename('x')).rejects.toThrow('Collection is not initialised.');
    });
  });

  describe('delete', () => {
    it('should remove the collection from the registry', async () => {
      collection.initialise(baseData);
      await collection.delete();
      const fake = registry as unknown as FakeRegistry;
      expect(fake.removed).toEqual(['test-id']);
      expect(collection.isInitialised).toBe(false);
    });
  });
});
