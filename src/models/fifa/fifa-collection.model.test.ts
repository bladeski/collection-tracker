import { describe, it, expect, beforeEach } from 'vitest';
import { ItemType } from '../../enums';
import { ICollectionsRegistryService, ICollectionMetadata } from '../../interfaces';
import FifaCollection from './fifa-collection.model';
import { FifaSticker } from './fifa-sticker.model';
import { FifaTeam } from './fifaTeam.model';

const makeFifaMeta: (overrides?: Partial<ICollectionMetadata>) => ICollectionMetadata = (
  overrides = {}
) => ({
  id: 'fifa-test',
  name: 'FIFA Test',
  itemType: ItemType.FIFA26,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const makeSticker = (
  id: string,
  teamId: string,
  overrides: Partial<FifaSticker> = {}
): FifaSticker => ({
  id,
  name: `Sticker ${id}`,
  count: 1,
  itemType: ItemType.FIFA26,
  teamId,
  type: 'player',
  isShiny: false,
  ...overrides,
});

const neverResolving = <T>(): Promise<T> => new Promise<T>(() => undefined);

const makeStubDataService = () => ({
  getBaseData: () => neverResolving<FifaSticker[]>(),
  getTeams: () => neverResolving<FifaTeam[]>(),
}) as any;

const makeStubDataStoreService = () => ({
  getAll: () => neverResolving<FifaSticker[]>(),
  getById: () => neverResolving<FifaSticker | undefined>(),
  add: () => neverResolving<void>(),
  update: () => neverResolving<void>(),
  delete: () => neverResolving<void>(),
}) as any;

interface FakeRegistry {
  rows: Map<string, ICollectionMetadata>;
  get: (id: string) => Promise<ICollectionMetadata | undefined>;
  list: () => Promise<ICollectionMetadata[]>;
  create: (meta: Omit<ICollectionMetadata, 'createdAt' | 'updatedAt'>) => Promise<ICollectionMetadata>;
  rename: (id: string, name: string) => Promise<ICollectionMetadata>;
  remove: (id: string) => Promise<void>;
  createFromCatalog: (...args: any[]) => Promise<ICollectionMetadata>;
  init: () => Promise<void>;
}

const makeFakeRegistry = (): ICollectionsRegistryService => {
  const rows = new Map<string, ICollectionMetadata>();
  const fake: FakeRegistry = {
    rows,
    get: async (id) => rows.get(id),
    list: async () => Array.from(rows.values()),
    create: async (meta) => {
      const now = new Date().toISOString();
      const row: ICollectionMetadata = { ...meta, createdAt: now, updatedAt: now };
      rows.set(row.id, row);
      return row;
    },
    rename: async (id, name) => {
      const existing = rows.get(id);
      if (!existing) throw new Error('Not found');
      const updated = { ...existing, name };
      rows.set(id, updated);
      return updated;
    },
    remove: async (id) => {
      rows.delete(id);
    },
    createFromCatalog: async () => neverResolving(),
    init: async () => undefined,
  };
  return fake as unknown as ICollectionsRegistryService;
};

describe('FifaCollection', () => {
  let collection: FifaCollection;
  let registry: ICollectionsRegistryService;

  const baseData: FifaSticker[] = [
    makeSticker('1', 'team-a'),
    makeSticker('2', 'team-a'),
    makeSticker('3', 'team-b'),
    makeSticker('4', 'team-b'),
  ];

  beforeEach(async () => {
    registry = makeFakeRegistry();
    const fake = registry as unknown as FakeRegistry;
    await fake.create(makeFifaMeta());
    collection = new FifaCollection(
      'fifa-test',
      makeStubDataService(),
      makeStubDataStoreService(),
      registry
    );
  });

  describe('constructor', () => {
    it('should set id correctly and require a registry', () => {
      expect(collection.id).toBe('fifa-test');
      expect(() => new FifaCollection('fifa-test', undefined, undefined, undefined as any)).toThrow(
        'FifaCollection requires a CollectionsRegistryService'
      );
    });
  });

  describe('getTeamStickers', () => {
    it('should return stickers belonging to the given team', () => {
      collection.initialise(baseData, [makeSticker('1', 'team-a'), makeSticker('3', 'team-b')]);
      const result = collection.getTeamStickers('team-a');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('should return an empty array when the team has no collected stickers', () => {
      collection.initialise(baseData, [makeSticker('1', 'team-a')]);
      expect(collection.getTeamStickers('team-b')).toHaveLength(0);
    });

    it('should throw if collection is not initialised', () => {
      expect(() => collection.getTeamStickers('team-a')).toThrow('Collection is not initialised.');
    });

    it('should support includeMissing to fill in uncollected base stickers', () => {
      collection.initialise(baseData, [makeSticker('1', 'team-a')]);
      const result = collection.getTeamStickers('team-a', true);
      expect(result).toHaveLength(2);
      expect(result.map(s => s.id)).toEqual(expect.arrayContaining(['1', '2']));
    });
  });

  describe('getMissingTeamStickers', () => {
    it('should return base stickers not yet collected for the given team', () => {
      collection.initialise(baseData, [makeSticker('1', 'team-a')]);
      const missing = collection.getMissingTeamStickers('team-a');
      expect(missing).toHaveLength(1);
      expect(missing[0].id).toBe('2');
    });

    it('should return all team stickers when none are collected', () => {
      collection.initialise(baseData, []);
      const missing = collection.getMissingTeamStickers('team-b');
      expect(missing).toHaveLength(2);
      expect(missing.map(s => s.id)).toEqual(expect.arrayContaining(['3', '4']));
    });

    it('should return an empty array when all team stickers are collected', () => {
      collection.initialise(baseData, [
        makeSticker('1', 'team-a'),
        makeSticker('2', 'team-a'),
      ]);
      expect(collection.getMissingTeamStickers('team-a')).toHaveLength(0);
    });

    it('should throw if collection is not initialised', () => {
      expect(() => collection.getMissingTeamStickers('team-a')).toThrow('Collection is not initialised.');
    });
  });

  describe('getTeamSpares', () => {
    it('should return stickers for the given team with count greater than 1', () => {
      collection.initialise(baseData, [
        makeSticker('1', 'team-a', { count: 2 }),
        makeSticker('2', 'team-a', { count: 1 }),
        makeSticker('3', 'team-b', { count: 3 }),
      ]);
      const spares = collection.getTeamSpares('team-a');
      expect(spares).toHaveLength(1);
      expect(spares[0].id).toBe('1');
    });

    it('should return an empty array when no team stickers are spares', () => {
      collection.initialise(baseData, [makeSticker('1', 'team-a', { count: 1 })]);
      expect(collection.getTeamSpares('team-a')).toHaveLength(0);
    });

    it('should not include spares from other teams', () => {
      collection.initialise(baseData, [makeSticker('3', 'team-b', { count: 5 })]);
      expect(collection.getTeamSpares('team-a')).toHaveLength(0);
    });

    it('should throw if collection is not initialised', () => {
      expect(() => collection.getTeamSpares('team-a')).toThrow('Collection is not initialised.');
    });
  });
});
