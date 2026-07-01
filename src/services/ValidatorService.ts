import { ItemType } from '../enums';
import IItemTypeDefinition from '../interfaces/IItemTypeDefinition';
import IItemTypeMap from '../interfaces/IItemTypeMap';
import { FifaSticker } from '../models/fifa';

export default class ValidatorService {
  static itemRegistry = {
    [ItemType.FIFA26]: {
      itemType: ItemType.FIFA26,
      validate: ValidatorService.isFifa26Sticker.bind(ValidatorService),
    },
    [ItemType.DEFAULT]: {
      itemType: ItemType.DEFAULT,
      validate: ValidatorService.isDefaultItem.bind(ValidatorService),
    },
  } satisfies {
    [key in keyof IItemTypeMap]: IItemTypeDefinition<IItemTypeMap[key]>;
  }

  static validateItem<T>(item: any, collectionType: ItemType): T {  
    if (!item || !item.id) {
      throw new Error('Item must have a non-empty id.');
    }
    
    if(item?.itemType !== collectionType) {
      throw new Error(`Item type mismatch: expected ${collectionType}, got ${item.itemType}`);
    }

    const validator = ValidatorService.itemRegistry[collectionType]?.validate;
    if (!validator) {
      throw new Error(`No validator registered for item type ${collectionType}`);
    }

    if (!validator(item)) {
      throw new Error(`Item does not conform to expected structure for type ${collectionType}`);
    }

    return item as T;
  }

  static validateItems<T>(items: any[], collectionType: ItemType): T[] {
    return items.map(item => ValidatorService.validateItem<T>(item, collectionType));
  }

  private static isFifa26Sticker(value: unknown): value is FifaSticker {
    if (typeof value !== 'object' || value === null) return false;

    const item = value as Partial<FifaSticker>;
    const hasValidProps = 
      'id' in item && typeof item.id === 'string'
      && 'name' in item && typeof item.name === 'string'
      && 'count' in item && typeof item.count === 'number'
      && 'teamId' in item && typeof item.teamId === 'string'
      && 'type' in item && typeof item.type === 'string'
      && 'isShiny' in item && typeof item.isShiny === 'boolean';

    return (
      item.itemType === ItemType.FIFA26
      && hasValidProps
    );
  }

  private static isDefaultItem(value: unknown): value is IItemTypeMap[ItemType.DEFAULT] {
    if (typeof value !== 'object' || value === null) return false;

    const item = value as Partial<IItemTypeMap[ItemType.DEFAULT]>;
    return item.itemType === ItemType.DEFAULT;
  }
}