import { describe, it, expect, beforeEach } from 'vitest';
import FifaCollection from './fifa-collection.model';
import { FifaSticker } from './fifa-sticker.model';
import { FifaTeam } from './fifaTeam.model';
import { FifaStickerType } from '../../enums';

const makeSticker = (id: string, teamId: string, overrides: Partial<FifaSticker> = {}): FifaSticker => ({
  id,
  name: `Sticker ${id}`,
  count: 1,
  teamId,
  type: FifaStickerType.Player,
  isShiny: false,
  ...overrides,
});

/**
 * Stub data services. They return promises that never resolve so the
 * `FifaCollection` constructor's auto-initialise
 * (`Promise.all([dataService.getBaseData(), dataStoreService.getAll()])`)
 * never flips `isInitialised` to true. Tests that need a populated
 * collection call `collection.initialise(...)` explicitly afterwards,
 * which sets the flag regardless of any pending constructor fetch.
 */
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
  storageKey: 'fifaCollection',
  saveAll: () => neverResolving<void>(),
}) as any;

describe('FifaCollection', () => {
  let collection: FifaCollection;

  const baseData: FifaSticker[] = [
    makeSticker('1', 'team-a'),
    makeSticker('2', 'team-a'),
    makeSticker('3', 'team-b'),
    makeSticker('4', 'team-b'),
  ];

  beforeEach(() => {
    collection = new FifaCollection(
      makeStubDataService(),
      makeStubDataStoreService()
    );
  });

  describe('constructor', () => {
    it('should set id and name correctly', () => {
      expect(collection.id).toBe('fifa-world-cup-2026');
      expect(collection.name).toBe('FIFA World Cup 2026');
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
      collection.initialise(baseData, [makeSticker('1', 'team-a'), makeSticker('2', 'team-a')]);
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
      collection.initialise(baseData, [
        makeSticker('3', 'team-b', { count: 5 }),
      ]);
      expect(collection.getTeamSpares('team-a')).toHaveLength(0);
    });

    it('should throw if collection is not initialised', () => {
      expect(() => collection.getTeamSpares('team-a')).toThrow('Collection is not initialised.');
    });
  });
});
