import { IItem } from '.';

export default interface IDataStoreService<T extends IItem> {
  getAll(): Promise<T[]>;
  getById(id: string): Promise<T | undefined>;
  add(item: T): Promise<void>;
  update(item: T): Promise<void>;
  delete(id: string): Promise<void>;
}