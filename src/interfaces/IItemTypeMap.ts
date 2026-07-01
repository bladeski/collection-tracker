import { ItemType } from "../enums";
import { FifaSticker } from "../models/fifa";
import IItem from "./IItem";

export default interface IItemTypeMap {
  [ItemType.FIFA26]: FifaSticker;
  [ItemType.DEFAULT]: IItem;
}