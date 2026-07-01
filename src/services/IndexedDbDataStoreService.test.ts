import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IItem } from '../interfaces';
import { ItemType } from '../enums';
import { IndexedDbDataStoreService } from '.';

interface TestItem extends IItem {
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

let collectionCounter = 0;
const uniqueCollectionId = (prefix = 'test') =>
  `${prefix}-${++collectionCounter}-${Date.now().toString(36)}`;

describe('IndexedDbDataStoreService', () => {
  let service: IndexedDbDataStoreService<TestItem>;
  let collectionId: string;

  beforeEach(async () => {
    collectionId = uniqueCollectionId();
    service = new IndexedDbDataStoreService<TestItem>(collectionId);
    // Eagerly initialize so the store is created before any test runs
    await service.init();
  });

  afterEach(async () => {
    // Await close() so the connection is released before the next test
    // opens the shared `collectors` database. fire-and-forget close()
    // would race with the next open and deadlock the polyfill.
    await service.close();
  });

  describe('constructor', () => {
    it('should accept a non-empty collectionId', () => {
      expect(() => new IndexedDbDataStoreService<TestItem>('my-collection')).not.toThrow();
    });

    it('should throw when collectionId is empty', () => {
      expect(() => new IndexedDbDataStoreService<TestItem>('')).toThrow(
        'IndexedDbDataStoreService requires a non-empty collectionId.'
      );
    });

    it('should scope operations to a per-collection store name', async () => {
      const otherId = uniqueCollectionId('other');
      const otherService = new IndexedDbDataStoreService<TestItem>(otherId);
      try {
        // Serialize the opens: fake-indexeddb can hang when two services
        // open the same shared DB in parallel before the first finishes
        // its upgrade.
        await service.init();
        await otherService.init();
        await service.add(makeItem('a'));
        await otherService.add(makeItem('b'));
        const ours = await service.getAll();
        const theirs = await otherService.getAll();
        expect(ours.map((i) => i.id)).toEqual(['a']);
        expect(theirs.map((i) => i.id)).toEqual(['b']);
      } finally {
        await otherService.close();
      }
    });
  });

  describe('init', () => {
    it('should resolve without error and be idempotent', async () => {
      await expect(service.init()).resolves.toBeUndefined();
      await expect(service.init()).resolves.toBeUndefined();
    });
  });

  describe('add', () => {
    it('should persist an item so getAll can read it back', async () => {
      const item = makeItem('1');
      await service.add(item);
      const all = await service.getAll();
      expect(all).toEqual([item]);
    });

    it('should preserve item fields through the round-trip', async () => {
      const item = makeItem('x', { name: 'Alpha', count: 7 });
      await service.add(item);
      const got = await service.getById('x');
      expect(got).toEqual(item);
    });

    it('should accept items whose shape extends IItem', async () => {
      interface Sticker extends IItem {
        itemType: ItemType.FIFA26;
        teamId: string;
        type: string;
      }
      const sticker: Sticker = {
        id: 's1',
        itemType: ItemType.FIFA26,
        teamId: 't1',
        type: 'shiny',
        name: 's1',
        count: 1,
      } as Sticker;
      const stickerService = new IndexedDbDataStoreService<Sticker>(uniqueCollectionId('sticker'));
      try {
        await stickerService.add(sticker);
        const got = await stickerService.getById('s1');
        expect(got).toEqual(sticker);
      } finally {
        await stickerService.close();
      }
    });

    it('should reject items without an id', async () => {
      await expect(
        service.add({ name: 'no id', count: 0 } as unknown as TestItem)
      ).rejects.toThrow('Item must have a non-empty id.');
    });

    it('should reject items with an empty id', async () => {
      await expect(
        service.add({ id: '', name: 'x', count: 1, itemType: ItemType.DEFAULT } as TestItem)
      ).rejects.toThrow('Item must have a non-empty id.');
    });

    it('should reject duplicate ids with a friendly ConstraintError message', async () => {
      await service.add(makeItem('dup'));
      await expect(service.add(makeItem('dup'))).rejects.toThrow(
        /already exists in collection/
      );
    });
  });

  describe('getById', () => {
    it('should return undefined for an unknown id', async () => {
      const got = await service.getById('nope');
      expect(got).toBeUndefined();
    });

    it('should return undefined on an empty store', async () => {
      const got = await service.getById('anything');
      expect(got).toBeUndefined();
    });

    it('should fetch an existing item by id', async () => {
      const a = makeItem('a');
      const b = makeItem('b', { name: 'Bravo', count: 2 });
      await service.add(a);
      await service.add(b);
      expect(await service.getById('a')).toEqual(a);
      expect(await service.getById('b')).toEqual(b);
    });
  });

  describe('getAll', () => {
    it('should return an empty array for a fresh store', async () => {
      const all = await service.getAll();
      expect(all).toEqual([]);
    });

    it('should return all persisted items', async () => {
      const items = [makeItem('1'), makeItem('2'), makeItem('3')];
      for (const i of items) await service.add(i);
      const all = await service.getAll();
      expect(all).toHaveLength(3);
      expect(all.map((i) => i.id).sort()).toEqual(['1', '2', '3']);
    });
  });

  describe('update', () => {
    it('should replace an existing item by id', async () => {
      const original = makeItem('u', { name: 'Old', count: 1 });
      const updated = makeItem('u', { name: 'New', count: 5 });
      await service.add(original);
      await service.update(updated);
      const got = await service.getById('u');
      expect(got).toEqual(updated);
      const all = await service.getAll();
      expect(all).toHaveLength(1);
    });

    it('should insert a new item when the id does not exist (put semantics)', async () => {
      const item = makeItem('brand-new');
      await service.update(item);
      expect(await service.getById('brand-new')).toEqual(item);
    });

    it('should reject items without an id', async () => {
      await expect(
        service.update({ name: 'x', count: 0 } as unknown as TestItem)
      ).rejects.toThrow('Item must have a non-empty id.');
    });
  });

  describe('delete', () => {
    it('should remove an existing item', async () => {
      await service.add(makeItem('1'));
      await service.add(makeItem('2'));
      await service.delete('1');
      const all = await service.getAll();
      expect(all.map((i) => i.id)).toEqual(['2']);
    });

    it('should be a no-op when the id does not exist', async () => {
      await service.add(makeItem('1'));
      await expect(service.delete('ghost')).resolves.toBeUndefined();
      const all = await service.getAll();
      expect(all.map((i) => i.id)).toEqual(['1']);
    });

    it('should reject when id is empty', async () => {
      await expect(service.delete('')).rejects.toThrow(
        'delete() requires a non-empty id.'
      );
    });
  });

  describe('close', () => {
    it('should be safe to call when the DB was never opened', async () => {
      await expect(service.close()).resolves.toBeUndefined();
    });

    it('should not break subsequent operations after reopen', async () => {
      await service.add(makeItem('1'));
      await service.close();
      // After close, the next call should lazily reopen and succeed.
      const all = await service.getAll();
      expect(all.map((i) => i.id)).toEqual(['1']);
      // And we should still be able to write.
      await service.add(makeItem('2'));
      const all2 = await service.getAll();
      expect(all2.map((i) => i.id).sort()).toEqual(['1', '2']);
    });
  });
});
