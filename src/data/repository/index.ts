import { appConfig } from '../../config';
import { createHttpRepository } from './http';
import { createLocalRepository } from './local';
import type { LeadRepository } from './types';

/**
 * The active data source. With VITE_API_URL set (for example /api), leads go to the Express
 * server in server/ and the app asks you to sign in; otherwise they stay in this browser.
 */
export const repository: LeadRepository = appConfig.apiUrl
  ? createHttpRepository(appConfig.apiUrl)
  : createLocalRepository();

export type { LeadRepository } from './types';
