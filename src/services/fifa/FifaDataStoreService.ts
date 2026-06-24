import { FifaSticker } from '../../models/fifa';
import IndexedDbDataStoreService from '../IndexedDbDataStoreService';

export default class FifaDataStoreService extends IndexedDbDataStoreService<FifaSticker> {
  constructor() {
    super('fifaCollection');
  }
}