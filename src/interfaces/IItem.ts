import { ItemType } from "../enums";

export default interface IItem {
  id: string;
  itemType: ItemType;
  name: string;
  count: number;
}
