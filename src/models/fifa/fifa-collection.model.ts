import { Collection } from '..';
import { ItemType } from '../../enums';
import { IDataService, IDataStoreService, ICollectionsRegistryService } from '../../interfaces';
import { FifaDataService } from '../../services/fifa';
import { FifaSticker } from './fifa-sticker.model';
import { FifaTeam } from './fifaTeam.model';

/**
 * FIFA-flavored {@link Collection} that adds team-aware lookups.
 *
 * Construction is registry-driven: pass the collection id and the
 * registry/store; the base {@link Collection} constructor pulls
 * `name`/`itemType` from the registry row. Hard-coded ids/names are
 * gone — they lived in the registry, not the model.
 */
export default class FifaCollection extends Collection<FifaSticker> {
  private fifaDataService: FifaDataService;

  constructor(
    id: string,
    dataService?: IDataService<FifaSticker>,
    dataStoreService?: IDataStoreService<FifaSticker>,
    registry?: ICollectionsRegistryService
  ) {
    dataService = dataService || new FifaDataService();
    if (!registry) {
      throw new Error(
        'FifaCollection requires a CollectionsRegistryService to look up collection metadata.'
      );
    }
    super(id, dataService, dataStoreService as IDataStoreService<FifaSticker>, registry);
    this.fifaDataService = dataService as FifaDataService;
  }

  async getTeams(): Promise<FifaTeam[]> {
    if (!this.isInitialised) {
      throw new Error('Collection is not initialised.');
    }
    if (this.itemType !== ItemType.FIFA26) {
      throw new Error(
        `FifaCollection expects itemType '${ItemType.FIFA26}', got '${this.itemType}'.`
      );
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
