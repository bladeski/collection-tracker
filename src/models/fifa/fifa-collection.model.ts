import { Collection } from '..';
import { FifaDataService, FifaDataStoreService } from '../../services/fifa';
import { FifaSticker } from './fifa-sticker.model';
import { FifaTeam } from './fifaTeam.model';

export default class FifaCollection extends Collection<FifaSticker> {
  private fifaDataService: FifaDataService;

  constructor(
    dataService?: FifaDataService,
    dataStoreService?: FifaDataStoreService
  ) {
    dataService = dataService || new FifaDataService();
    dataStoreService = dataStoreService || new FifaDataStoreService();
    super(
      'fifa-world-cup-2026',
      'FIFA World Cup 2026',
      dataService,
      dataStoreService
    );
    this.fifaDataService = dataService;
  }

  async getTeams(): Promise<FifaTeam[]> {
    if (!this.isInitialised) {
      throw new Error('Collection is not initialised.');
    }
    return this.fifaDataService.getTeams();
  }

  getTeamStickers(teamId: string, includeMissing: boolean = false): FifaSticker[] {
    if (!this.isInitialised) {
      throw new Error('Collection is not initialised.');
    }
    const teamStickers = this._items.filter(sticker => sticker.teamId === teamId);
    if (includeMissing) {
      const baseTeamStickers = this._baseData.filter(sticker => sticker.teamId === teamId);
      return baseTeamStickers.map(baseItem => {
        const collected = this._items.find(i => i.id === baseItem.id);
        return collected || baseItem;
      });
    }
    return teamStickers;
  }

  getMissingTeamStickers(teamId: string): FifaSticker[] {
    if (!this.isInitialised) {
      throw new Error('Collection is not initialised.');
    }
    return this._baseData.filter(sticker => 
      sticker.teamId === teamId 
      && !this._items.some(i => i.id === sticker.id)
    );
  }

  getTeamSpares(teamId: string): FifaSticker[] {
    if (!this.isInitialised) {
      throw new Error('Collection is not initialised.');
    }
    return this._items.filter(sticker => sticker.teamId === teamId && sticker.count > 1);
  }
}