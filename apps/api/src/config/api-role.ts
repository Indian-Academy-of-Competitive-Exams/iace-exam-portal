/**
 * Which half of the platform a container is. One image, three services: the sitting is the only
 * thing that scales with a hall, so it runs alone and is never slowed by an import or a rollup.
 * Read from `process.env` rather than the config service because a module's decorator is evaluated
 * while the file loads, long before Nest has a container to ask.
 */
import { Logger } from '@nestjs/common';

export const API_ROLES = {
  /** Everything, which is what local development and every test run. */
  ALL: 'all',
  /** The live sitting: starting, autosaving, submitting, and the board a candidate watches. */
  EXAM: 'exam',
  /** Signing in, the catalog, results, notifications and the whole admin side. */
  CORE: 'core',
  /** No routes but health and metrics: the queues, their schedulers and the outbox relay. */
  WORKER: 'worker',
} as const;

export type ApiRole = (typeof API_ROLES)[keyof typeof API_ROLES];

const ROLES: readonly string[] = Object.values(API_ROLES);

export function roleNamed(named: string | undefined): ApiRole {
  named = (named ?? '').trim().toLowerCase();
  if (named === '') return API_ROLES.ALL;
  if (ROLES.includes(named)) return named as ApiRole;

  Logger.warn(`API_ROLE=${named} is not a role; serving everything instead`, 'ApiRole');
  return API_ROLES.ALL;
}

export const apiRole: ApiRole = roleNamed(process.env.API_ROLE);

/** ALL is every role at once, which is what one container in development has always been. */
export const rolePlays = (role: ApiRole, wanted: readonly ApiRole[]): boolean =>
  role === API_ROLES.ALL || wanted.includes(role);

export const servesRole = (...roles: readonly ApiRole[]): boolean => rolePlays(apiRole, roles);

/** What a module registers, kept only where this container is one of the roles that needs it. */
export const onRole = <T>(roles: readonly ApiRole[], registered: readonly T[]): T[] =>
  servesRole(...roles) ? [...registered] : [];
