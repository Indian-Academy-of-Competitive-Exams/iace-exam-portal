import { tabIdFrom } from '@iace/app-kit';
import { browserSessionStorage } from '@iace/app-kit/browser';
import { STORAGE_KEYS } from './constants';

/** Per tab, surviving a reload: which tab is answering, as the server is told. */
export const tabId = (): string =>
  tabIdFrom(browserSessionStorage, STORAGE_KEYS.TAB, () => crypto.randomUUID());
