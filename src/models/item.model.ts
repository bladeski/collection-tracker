import { IItemTypeMap } from "../interfaces";

export type Item = IItemTypeMap[keyof IItemTypeMap];

export default Item;