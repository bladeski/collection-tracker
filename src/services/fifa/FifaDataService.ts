import stickerUrl from '../../data/fifa-stickers.json';
import teamsUrl from '../../data/fifa-teams.json';
import { IDataService } from '../../interfaces';
import { FifaSticker, FifaTeam } from '../../models/fifa';

export default class FifaDataService implements IDataService<FifaSticker> {
  private baseDataCache: FifaSticker[] | null = null;
  private teamsCache: FifaTeam[] | null = null;
  private cacheTimestamps: { baseData: number; teams: number } = {
    baseData: 0,
    teams: 0,
  };
  private readonly CACHE_TTL = 1000 * 60 * 60; // 1 hour in milliseconds

  async getBaseData(): Promise<FifaSticker[]> {
    // Return cached data if available and not expired
    if (
      this.baseDataCache &&
      Date.now() - this.cacheTimestamps.baseData < this.CACHE_TTL
    ) {
      return this.baseDataCache;
    }

    try {
      const response = await fetch(stickerUrl as unknown as string);
      if (!response.ok) {
        throw new Error(`Failed to fetch base data: ${response.statusText}`);
      }
      const data = await response.json();
      
      // Cache the result
      this.baseDataCache = data;
      this.cacheTimestamps.baseData = Date.now();
      
      return data;
    } catch (error) {
      // If fetch fails and we have stale cache, return it
      if (this.baseDataCache) {
        console.warn(
          'Failed to fetch fresh base data, returning cached version',
          error
        );
        return this.baseDataCache;
      }
      throw error;
    }
  }

  async getTeams(): Promise<FifaTeam[]> {
    // Return cached data if available and not expired
    if (
      this.teamsCache &&
      Date.now() - this.cacheTimestamps.teams < this.CACHE_TTL
    ) {
      return this.teamsCache;
    }

    try {
      const response = await fetch(teamsUrl as unknown as string);
      if (!response.ok) {
        throw new Error(`Failed to fetch teams: ${response.statusText}`);
      }
      const data = await response.json();
      
      // Cache the result
      this.teamsCache = data;
      this.cacheTimestamps.teams = Date.now();
      
      return data;
    } catch (error) {
      // If fetch fails and we have stale cache, return it
      if (this.teamsCache) {
        console.warn('Failed to fetch fresh teams, returning cached version', error);
        return this.teamsCache;
      }
      throw error;
    }
  }

  /**
   * Invalidate all caches. Useful for refreshing data.
   */
  invalidateCache(): void {
    this.baseDataCache = null;
    this.teamsCache = null;
    this.cacheTimestamps = { baseData: 0, teams: 0 };
  }

  /**
   * Invalidate specific cache by key
   */
  invalidateCacheKey(key: 'baseData' | 'teams'): void {
    if (key === 'baseData') {
      this.baseDataCache = null;
      this.cacheTimestamps.baseData = 0;
    } else if (key === 'teams') {
      this.teamsCache = null;
      this.cacheTimestamps.teams = 0;
    }
  }
}