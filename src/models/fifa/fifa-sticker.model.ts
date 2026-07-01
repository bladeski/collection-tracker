import { FifaStickerType, ItemType } from '../../enums';
import { IItem } from '../../interfaces';

export class FifaSticker implements IItem {
  id: string;
  itemType: ItemType = ItemType.FIFA26;
  name: string;
  count: number;
  teamId: string;
  type: FifaStickerType;
  isShiny: boolean;

  constructor(id: string, name: string, count: number, teamId: string, type: FifaStickerType = FifaStickerType.Player, isShiny: boolean = false) {
    this.id = id;
    this.name = name;
    this.count = count;
    this.teamId = teamId;
    this.type = type;
    this.isShiny = isShiny;
  }
}