import { IItem } from '.';

export default interface IDataService<T extends IItem> {
  getBaseData(): Promise<T[]>;
}