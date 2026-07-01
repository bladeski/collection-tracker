import { IItem } from ".";
import { ItemValidator } from "../models";

export default interface IItemTypeDefinition<T extends IItem> {
  itemType: T['itemType'];
  validate: ItemValidator<T>;
}