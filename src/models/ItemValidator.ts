import { IItem } from "../interfaces";

type ItemValidator<T extends IItem> = (item: unknown) => item is T;

export default ItemValidator;